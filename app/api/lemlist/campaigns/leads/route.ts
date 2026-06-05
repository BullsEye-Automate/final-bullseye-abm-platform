import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Extrae un string de múltiples posibles claves en un objeto
function pick(obj: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (v && typeof v === "string") return v.trim();
  }
  return "";
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");

  if (!clientId) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });
  }

  const db = supabaseAdmin();
  const { data: config, error: configError } = await db
    .from("client_configs")
    .select("lemlist_campaign_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (configError) {
    return NextResponse.json({ error: configError.message }, { status: 500 });
  }

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json(
      { error: "No hay campaña configurada en Config. cliente" },
      { status: 400 }
    );
  }

  const credentials = Buffer.from(`:${apiKey}`).toString("base64");

  // ── 1. Traer leads de la campaña ──────────────────────────────────────────
  let lemRes: Response;
  try {
    lemRes = await fetch(
      `https://api.lemlist.com/api/campaigns/${config.lemlist_campaign_id}/leads?limit=500`,
      { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error de red: ${err?.message ?? "desconocido"}` },
      { status: 502 }
    );
  }

  if (!lemRes.ok) {
    const text = await lemRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Lemlist respondió ${lemRes.status}: ${text.slice(0, 200)}` },
      { status: 400 }
    );
  }

  const leadsData = await lemRes.json();
  const rawLeads: any[] = Array.isArray(leadsData) ? leadsData : (leadsData.leads ?? leadsData.list ?? []);

  // ── 2. Normalizar cada lead ───────────────────────────────────────────────
  // Lemlist guarda las variables custom bajo `vars` (a veces `fields`).
  // Email SÍ viene en el root del lead.
  const leads = rawLeads.map((l: any) => {
    const vars = l.vars ?? l.fields ?? {};

    // Nombre: root > vars > fullName
    let firstName = pick(l, "firstName", "first_name") || pick(vars, "firstName", "first_name");
    let lastName  = pick(l, "lastName",  "last_name")  || pick(vars, "lastName",  "last_name");

    const rawFull = pick(l, "fullName", "full_name") || pick(vars, "fullName", "full_name");
    if (!firstName && !lastName && rawFull) {
      const parts = rawFull.split(/\s+/);
      firstName = parts[0] ?? "";
      lastName  = parts.slice(1).join(" ");
    }

    return {
      _id:         l._id ?? l.id ?? "",
      contactId:   l.contactId ?? null,
      email:       pick(l, "email"),
      firstName,
      lastName,
      companyName: pick(l, "companyName", "company_name", "company") || pick(vars, "companyName", "company_name"),
      jobTitle:    pick(l, "jobTitle", "job_title", "title")         || pick(vars, "jobTitle", "job_title"),
      linkedinUrl: pick(l, "linkedinUrl", "linkedin_url", "linkedin")|| pick(vars, "linkedinUrl", "linkedin_url"),
      isPaused:    l.isPaused    ?? l.is_paused    ?? false,
      isFinished:  l.isFinished  ?? l.is_finished  ?? false,
      completed:   l.completed   ?? null,
      addedAt:     l.addedAt     ?? l.added_at     ?? l.createdAt ?? null,
    };
  });

  // ── 3. Enriquecer leads sin datos completos via contactId de Lemlist ──────
  // Solo los que no tienen email o nombre — así evitamos fetch innecesarios.
  const incomplete = leads.filter(
    (lead) => !lead.email || (!lead.firstName && !lead.lastName)
  );

  if (incomplete.length > 0) {
    // Recopilar contactIds únicos
    const contactIds = [...new Set(
      incomplete.map((l) => l.contactId).filter(Boolean) as string[]
    )];

    const BATCH = 5;
    const contactMap = new Map<string, any>();

    for (let i = 0; i < contactIds.length; i += BATCH) {
      const batch = contactIds.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (cid) => {
          try {
            const r = await fetch(
              `https://api.lemlist.com/api/contacts/${cid}`,
              { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" }
            );
            if (!r.ok) return null;
            const j = await r.json().catch(() => null);
            return j ? { ...j, _cid: cid } : null;
          } catch { return null; }
        })
      );
      for (const c of results) {
        if (c) contactMap.set(c._cid, c);
      }
      // Pequeña pausa para no saturar Lemlist
      if (i + BATCH < contactIds.length) await new Promise((r) => setTimeout(r, 80));
    }

    for (const lead of incomplete) {
      if (!lead.contactId) continue;
      const c = contactMap.get(lead.contactId);
      if (!c) continue;

      if (!lead.email && c.email)                lead.email       = c.email.trim().toLowerCase();
      if (!lead.linkedinUrl && c.linkedinUrl)  lead.linkedinUrl = c.linkedinUrl;

      // Nombre: intentar fullName, luego firstName/lastName separados del contacto
      if (!lead.firstName && !lead.lastName) {
        const cFull = (c.fullName ?? "").trim();
        if (cFull) {
          const parts = cFull.split(/\s+/);
          lead.firstName = parts[0] ?? "";
          lead.lastName  = parts.slice(1).join(" ");
        } else {
          // Lemlist a veces devuelve firstName/lastName por separado en el contacto
          const cf2 = c.vars ?? c.fields ?? {};
          lead.firstName = pick(c, "firstName", "first_name") || pick(cf2, "firstName", "first_name");
          lead.lastName  = pick(c, "lastName",  "last_name")  || pick(cf2, "lastName",  "last_name");
        }
      }

      // Empresa y cargo desde fields del contacto
      const cf = c.vars ?? c.fields ?? {};
      if (!lead.companyName) lead.companyName = pick(c, "companyName", "company") || pick(cf, "companyName", "company_name");
      if (!lead.jobTitle)    lead.jobTitle    = pick(c, "jobTitle")                || pick(cf, "jobTitle", "job_title");
    }
  }

  // ── 4. Enriquecer con datos de Supabase donde haya email ─────────────────
  const emailsToLookup = leads
    .filter((l) => l.email && (!l.firstName || !l.companyName))
    .map((l) => l.email);

  if (emailsToLookup.length > 0) {
    const { data: dbContacts } = await db
      .from("contacts")
      .select("email, first_name, last_name, company_name, job_title, linkedin_url")
      .eq("client_id", clientId)
      .in("email", emailsToLookup);

    const dbMap = new Map((dbContacts ?? []).map((c) => [c.email?.toLowerCase(), c]));

    for (const lead of leads) {
      if (!lead.email) continue;
      const dbC = dbMap.get(lead.email);
      if (!dbC) continue;
      if (!lead.firstName   && dbC.first_name)   lead.firstName   = dbC.first_name;
      if (!lead.lastName    && dbC.last_name)    lead.lastName    = dbC.last_name;
      if (!lead.companyName && dbC.company_name) lead.companyName = dbC.company_name;
      if (!lead.jobTitle    && dbC.job_title)    lead.jobTitle    = dbC.job_title;
      if (!lead.linkedinUrl && dbC.linkedin_url) lead.linkedinUrl = dbC.linkedin_url;
    }
  }

  // Limpiar campo interno antes de responder
  const response = leads.map(({ contactId: _c, ...rest }) => rest);

  return NextResponse.json({ leads: response });
}
