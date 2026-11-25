import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { loadClientLinks } from "@/lib/centroProspeccion/portalLink";
import { readDoc, writeDoc } from "@/lib/centroProspeccion/store";
import type { IntelResult } from "@/lib/centroProspeccion/intel/analyze";
import { queueIcpValidation } from "@/lib/centroProspeccion/intel/automations";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Aprobar o descartar una propuesta de la Inteligencia de la semana.
// La inteligencia NO cambia el ICP del cliente (pedido de BullsEye,
// 25-nov-2026): aprobada = queda guardada como sugerencia para presentar al
// cliente (centro_intel, se lista en la ficha en «Sugerencias para presentar
// al cliente») y no se anota en los campos de criterio de la ficha. Solo los
// «Próximos pasos» (operativos) se anotan en la ficha. Si toca el ICP, se
// avisa al KAM para conversarlo con el cliente; el ICP cambia solo si se
// acuerda formalmente y se modifica en el proyecto de Claude del cliente.
// Body: { client_id, semana, propuesta, decision: "aprobada"|"descartada", ficha_id?, texto? }

// Único campo de la ficha donde se anota una propuesta aprobada (operativo, no ICP)
const LABEL: Record<string, string> = { proximos: "Próximos pasos" };

export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const b = await req.json().catch(() => ({}));
  const { client_id, semana, propuesta, decision } = b as Record<string, string>;
  if (!client_id || !semana || !propuesta || !["aprobada", "descartada"].includes(decision)) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data: row } = await db.from("centro_intel").select("id, result").eq("client_id", client_id).eq("semana", semana).maybeSingle();
  if (!row) return NextResponse.json({ error: "No existe la inteligencia de esa semana" }, { status: 404 });
  const result = row.result as IntelResult;
  const p = result.propuestas?.find((x) => x.id === propuesta);
  if (!p) return NextResponse.json({ error: "Propuesta no encontrada" }, { status: 404 });
  if (p.estado && p.estado !== "pendiente") return NextResponse.json({ error: `Ya fue ${p.estado}`, propuesta: p }, { status: 409 });

  const texto = String(b.texto ?? p.texto).trim().slice(0, 600) || p.texto;
  let fichaNombre: string | null = null;
  if (decision === "aprobada" && LABEL[p.campo]) {
    const links = await loadClientLinks();
    const fichas = links.fichasByClient.get(client_id) ?? [];
    const target = fichas.find((f) => f.id === b.ficha_id) ?? fichas.find((f) => f.data.estado !== "pausado") ?? fichas[0];
    if (!target) return NextResponse.json({ error: "El cliente no tiene ficha en el Centro" }, { status: 400 });
    // Escritura con versión: si alguien editó la ficha entre medio, se reintenta con la nueva
    for (let i = 0; i < 3; i++) {
      const doc = await readDoc("clientes", target.id);
      if (!doc) return NextResponse.json({ error: "Ficha no encontrada" }, { status: 404 });
      const prev = String(doc.data[p.campo] ?? "").trim();
      const line = `• ${texto} (inteligencia semana ${semana}, aprobado por ${u.name || u.email})`;
      const next = prev && !/^sin definir\.?$/i.test(prev) ? `${prev}\n${line}` : line;
      const r = await writeDoc({ collection: "clientes", docId: target.id, data: { [p.campo]: next }, mode: "update", ifVersion: doc.version, by: u.email, source: "portal" });
      if (r.status === "ok") break;
      if (i === 2) return NextResponse.json({ error: "La ficha cambió mientras se guardaba; vuelve a intentar" }, { status: 409 });
    }
    fichaNombre = String(target.data.nombre || target.id);
  }

  Object.assign(p, { estado: decision, texto, decidido_por: u.email, decidido_at: new Date().toISOString() });
  await db.from("centro_intel").update({ result, updated_at: new Date().toISOString(), updated_by: u.email }).eq("id", row.id);

  // Cambio de ICP: lo valida el KAM con el cliente. No se envía en el momento:
  // queda en cola y sale en un solo correo a las 8:30 del día hábil siguiente.
  if (decision === "aprobada" && p.toca_icp) {
    const { data: c } = await db.from("clients").select("name").eq("id", client_id).maybeSingle();
    const cliente = (c as { name?: string } | null)?.name ?? "";
    await queueIcpValidation({ client_id, cliente, campo: p.campo, texto, evidencia: String(p.evidencia ?? ""), casos: Number(p.casos ?? 0), by: u.email, at: new Date().toISOString() })
      .catch((e) => console.warn("[centro-intel] cola ICP:", (e as Error).message));
  }
  return NextResponse.json({ ok: true, propuesta: p, ficha: fichaNombre });
}
