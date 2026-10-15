import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Base de empresas con señales de valor (tecnología que usan, proveedores
// actuales, fechas de apertura de presupuesto, etc.), agregadas desde TODAS
// las llamadas de Allo analizadas — sin importar qué cliente de BullsEye la
// originó, porque el objetivo es poder prospectar esa empresa desde
// cualquier cliente cuyo servicio calce con la señal detectada. Por diseño
// NO se filtra por cliente seleccionado en el sidebar.
export async function GET(_req: NextRequest) {
  const db = supabaseAdmin();

  const [{ data: rows, error }, { data: clients }] = await Promise.all([
    db
      .from("allo_call_signals")
      .select("*")
      .not("contact_company", "is", null)
      .not("top_relevance", "is", null)
      .order("call_date", { ascending: false })
      .limit(2000),
    db.from("clients").select("id, name"),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clientNameById = new Map((clients ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));

  type Row = {
    id: string;
    client_id: string;
    contact_company: string;
    contact_name: string | null;
    contact_job_title: string | null;
    contact_number: string | null;
    industry: string | null;
    call_date: string | null;
    signals: any[];
    mentioned_companies: any[];
    mentioned_technologies: any[];
    top_relevance: "alta" | "media" | "baja";
    reviewed: boolean;
  };

  const RELEVANCE_RANK: Record<string, number> = { alta: 3, media: 2, baja: 1 };

  type CompanyGroup = {
    company_key: string;
    company_name: string;
    industry: string | null;
    top_relevance: "alta" | "media" | "baja";
    call_count: number;
    pending_count: number;
    technologies: string[];
    vendors: { nombre: string; tipo: string }[];
    contacts: { name: string | null; job_title: string | null; contact_number: string | null }[];
    clients_involved: { client_id: string; client_name: string }[];
    signals: {
      id: string;
      categoria: string;
      evidencia: string;
      tipo_senal: string;
      periodo: string;
      certeza: string;
      relevancia: string;
      relevancia_motivo: string;
      call_date: string | null;
      client_id: string;
      client_name: string;
      reviewed: boolean;
    }[];
  };

  const groups = new Map<string, CompanyGroup>();

  for (const row of (rows ?? []) as Row[]) {
    const key = row.contact_company.trim().toLowerCase();
    if (!key) continue;

    let group = groups.get(key);
    if (!group) {
      group = {
        company_key: key,
        company_name: row.contact_company.trim(),
        industry: row.industry,
        top_relevance: row.top_relevance,
        call_count: 0,
        pending_count: 0,
        technologies: [],
        vendors: [],
        contacts: [],
        clients_involved: [],
        signals: [],
      };
      groups.set(key, group);
    }

    group.call_count++;
    if (!row.reviewed) group.pending_count++;
    if (!group.industry && row.industry) group.industry = row.industry;
    if ((RELEVANCE_RANK[row.top_relevance] ?? 0) > (RELEVANCE_RANK[group.top_relevance] ?? 0)) {
      group.top_relevance = row.top_relevance;
    }

    const clientName = clientNameById.get(row.client_id) ?? "Cliente desconocido";
    if (!group.clients_involved.some((c) => c.client_id === row.client_id)) {
      group.clients_involved.push({ client_id: row.client_id, client_name: clientName });
    }

    if (row.contact_name || row.contact_job_title || row.contact_number) {
      const exists = group.contacts.some(
        (c) => c.contact_number === row.contact_number && c.name === row.contact_name
      );
      if (!exists) {
        group.contacts.push({ name: row.contact_name, job_title: row.contact_job_title, contact_number: row.contact_number });
      }
    }

    for (const t of row.mentioned_technologies ?? []) {
      if (t?.nombre && !group.technologies.includes(t.nombre)) group.technologies.push(t.nombre);
    }

    for (const c of row.mentioned_companies ?? []) {
      if (c?.nombre && (c.tipo === "proveedor_actual" || c.tipo === "competidor")) {
        const exists = group.vendors.some((v) => v.nombre.toLowerCase() === c.nombre.toLowerCase());
        if (!exists) group.vendors.push({ nombre: c.nombre, tipo: c.tipo });
      }
    }

    for (const sig of row.signals ?? []) {
      group.signals.push({
        id: row.id,
        categoria: sig.categoria,
        evidencia: sig.evidencia,
        tipo_senal: sig.tipo_senal,
        periodo: sig.periodo,
        certeza: sig.certeza,
        relevancia: sig.relevancia,
        relevancia_motivo: sig.relevancia_motivo,
        call_date: row.call_date,
        client_id: row.client_id,
        client_name: clientName,
        reviewed: row.reviewed,
      });
    }
  }

  const result = Array.from(groups.values()).sort((a, b) => {
    const ra = RELEVANCE_RANK[a.top_relevance] ?? 0;
    const rb = RELEVANCE_RANK[b.top_relevance] ?? 0;
    if (ra !== rb) return rb - ra;
    return b.call_count - a.call_count;
  });

  return NextResponse.json({ companies: result });
}

// Marca como revisadas todas las llamadas (allo_call_signals.id) de una
// empresa de una sola vez, para no tener que hacerlo llamada por llamada.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { signal_ids, reviewed } = body as { signal_ids?: string[]; reviewed?: boolean };
  if (!Array.isArray(signal_ids) || signal_ids.length === 0) {
    return NextResponse.json({ error: "Se requiere signal_ids" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("allo_call_signals")
    .update({ reviewed: reviewed ?? true })
    .in("id", signal_ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
