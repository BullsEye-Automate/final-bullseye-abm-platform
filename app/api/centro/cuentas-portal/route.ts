import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser, isCentroOwner } from "@/lib/centroProspeccion/access";
import { loadClientLinks } from "@/lib/centroProspeccion/portalLink";
import { readDocs } from "@/lib/centroProspeccion/store";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeDomain } from "@/lib/hubspotPool";
import { pushWishlistItemToLemlist } from "@/lib/wishlistLemlist";
import { getClientExclusions, isExcluded } from "@/lib/wishlist";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Un solo universo de empresas (fase 2): las cuentas que el cliente aprobó en
// el Centro de prospección (colección "cuentas", respuesta «Sí») que nadie
// ha trabajado aún (no están en el universo de HubSpot del Pulso ABM ni en la
// exclusión del cliente) pasan a la
// wishlist del portal del cliente con el mismo flujo de un listado subido por
// el cliente: origin client, status new (aprobada para prospectar), source
// manual, envío a su Lemlist y luego el cron de contactos las toma.
//   GET  ?clienteId=  vista previa (cuántas ya están en la wishlist y cuántas faltan)
//   POST { clienteId } pasa la siguiente tanda (solo administrador del Centro);
//        el navegador repite hasta remaining = 0.
// No modifica las cuentas del Centro ni lo que ya está en la wishlist.

const BATCH = 20;
const CONCURRENCY = 4;
const norm = (s: string) => s.trim().toLowerCase();

type Cuenta = { id: string; empresa: string; web: string | null; linkedin: string | null; data: Record<string, unknown> };

async function load(fichaId: string) {
  const links = await loadClientLinks();
  const client = links.byFicha.get(fichaId) ?? null;
  const docs = (await readDocs(["cuentas"])).filter((d) => d.data?.clienteId === fichaId);
  const aprobadas: Cuenta[] = docs
    .filter((d) => String(d.data?.respuesta ?? "").trim().toLowerCase().startsWith("s"))
    .map((d) => ({
      id: d.doc_id,
      empresa: String(d.data.empresa ?? "").trim(),
      web: typeof d.data.web === "string" ? d.data.web : null,
      linkedin: typeof d.data.linkedin === "string" && /linkedin\.com\//i.test(d.data.linkedin) ? d.data.linkedin : null,
      data: d.data,
    }))
    .filter((c) => c.empresa);
  if (!client) return { client: null, total: docs.length, aprobadas, pending: [] as Cuenta[], worked: [] as Cuenta[], inWishlist: 0 };

  const { data: existing, error } = await supabaseAdmin()
    .from("client_wishlist").select("company_name, domain").eq("client_id", client.id);
  if (error) throw new Error(error.message);
  const domains = new Set((existing ?? []).map((e) => e.domain).filter(Boolean));
  const names = new Set((existing ?? []).map((e) => norm(e.company_name)));
  const isIn = (c: Cuenta) => {
    const d = normalizeDomain(c.web);
    return (d && domains.has(d)) || names.has(norm(c.empresa));
  };
  const missing = aprobadas.filter((c) => !isIn(c));
  // Las que BullsEye ya trabaja con el cliente en HubSpot (universo del último
  // sync de Pulso ABM) o que el cliente excluyó no se pasan: siguen su gestión
  // en HubSpot. Solo pasan las que nadie ha tocado.
  const ex = await getClientExclusions(supabaseAdmin(), client.id, { cuentas: false });
  const worked = missing.filter((c) => isExcluded(ex, c.empresa, normalizeDomain(c.web)));
  const pending = missing.filter((c) => !isExcluded(ex, c.empresa, normalizeDomain(c.web)));
  return { client, total: docs.length, aprobadas, pending, worked, inWishlist: aprobadas.length - missing.length };
}

export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const fichaId = req.nextUrl.searchParams.get("clienteId") ?? "";
  if (!fichaId) return NextResponse.json({ error: "clienteId requerido" }, { status: 400 });
  try {
    const r = await load(fichaId);
    return NextResponse.json({
      linked: !!r.client,
      cliente: r.client?.name ?? null,
      cuentas: r.total,
      aprobadas: r.aprobadas.length,
      enWishlist: r.inWishlist,
      enHubspot: r.worked.length,
      enHubspotEjemplos: r.worked.slice(0, 12).map((c) => c.empresa),
      faltan: r.pending.length,
      puedePasar: isCentroOwner(u.email),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  if (!isCentroOwner(u.email)) return NextResponse.json({ error: "Solo el administrador del Centro puede pasar cuentas al portal" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const fichaId = typeof body?.clienteId === "string" ? body.clienteId : "";
  if (!fichaId) return NextResponse.json({ error: "clienteId requerido" }, { status: 400 });

  try {
    const r = await load(fichaId);
    if (!r.client) return NextResponse.json({ error: "La ficha no está vinculada a un cliente del portal" }, { status: 409 });
    const db = supabaseAdmin();
    const batch = r.pending.slice(0, BATCH);
    const ids: string[] = [];
    const errors: string[] = [];
    for (const c of batch) {
      const facts = [
        { label: "Origen", value: "Cuenta aprobada por el cliente en el Centro de prospección" },
        ...(c.data.lista ? [{ label: "Lista", value: String(c.data.lista) }] : []),
        ...(c.data.prioridad ? [{ label: "Prioridad", value: String(c.data.prioridad) }] : []),
        ...(c.data.industria ? [{ label: "Industria", value: String(c.data.industria) }] : []),
        ...(c.data.tamano ? [{ label: "Tamaño", value: String(c.data.tamano) }] : []),
      ];
      const { data, error } = await db
        .from("client_wishlist")
        .insert({
          client_id: r.client.id,
          company_name: c.empresa.slice(0, 200),
          domain: normalizeDomain(c.web),
          linkedin_url: c.linkedin,
          source: "manual",
          source_ref: `centro:${c.id}`,
          mode: "manual",
          snapshot: { facts, centro: { cuentaId: c.id, motivos: String(c.data.motivos ?? "").slice(0, 1500) } },
          status: "new",
          origin: "client",
          lemlist_status: "pendiente",
          internal_note: c.data.comentarioCliente ? String(c.data.comentarioCliente).slice(0, 500) : null,
          requested_by_email: u.email,
          client_decision_at: typeof c.data.fechaRespuesta === "string" ? c.data.fechaRespuesta : new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) {
        if (error.code !== "23505") errors.push(`${c.empresa}: ${error.message}`);
        continue;
      }
      ids.push(data.id);
    }
    // Mismo flujo que un listado subido por el cliente: envío a su Lemlist
    // (si falla, queda aprobada y se reintenta desde el Dashboard)
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      await Promise.all(ids.slice(i, i + CONCURRENCY).map((id) => pushWishlistItemToLemlist(db, id).catch(() => null)));
    }
    return NextResponse.json({ added: ids.length, errors, remaining: Math.max(0, r.pending.length - batch.length) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
