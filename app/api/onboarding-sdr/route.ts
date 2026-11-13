import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { appUrl, currentViewer, isEditor } from "@/lib/onboardingSdr/server/access";
import { createOnboarding, getByEmail, listLeaders, loadCatalog, loadTeam } from "@/lib/onboardingSdr/server/store";
import { loadOnboardingCalendar, suggestIngreso } from "@/lib/onboardingSdr/server/calendar";

export const dynamic = "force-dynamic";

// Onboarding SDR (ver CLAUDE.md → "Onboarding SDR").
//   GET  → { viewer, mine, suggestedIngreso, team? y leaders? (solo editoras), catalog }
//   POST { email?, name?, ingreso?, clientes? } → crea un onboarding. Sin email
//        = el propio; para otra persona hace falta ser editora.
export async function GET(request: NextRequest) {
  try {
    const viewer = await currentViewer();
    if (!viewer) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const db = supabaseAdmin();
    const editor = isEditor(viewer);
    const archived = request.nextUrl.searchParams.get("archived") === "1";
    const [mine, catalog] = await Promise.all([getByEmail(db, viewer.email), loadCatalog(db, appUrl())]);
    const [team, leaders] = editor ? await Promise.all([loadTeam(db, catalog, archived), listLeaders()]) : [undefined, undefined];
    // Sin onboarding propio: se sugiere la fecha de ingreso desde el evento
    // "Bienvenida" de su calendario.
    let suggestedIngreso: string | null = null;
    if (!mine && !editor) suggestedIngreso = suggestIngreso(await loadOnboardingCalendar(viewer.email, null));
    return NextResponse.json({
      viewer: { email: viewer.email, editorRoles: viewer.editorRoles, admin: viewer.admin, editor },
      mine: mine ? { id: mine.id, active: mine.is_active } : null,
      suggestedIngreso,
      team,
      leaders,
      catalog: catalog.filter((c) => !c.off).map((c) => ({ id: c.id, n: c.n })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const viewer = await currentViewer();
    if (!viewer) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const email = String(body?.email || viewer.email).trim().toLowerCase();
    if (email !== viewer.email && !isEditor(viewer)) return NextResponse.json({ error: "Solo la líder, RRHH o la habilitadora crean el onboarding de otra persona" }, { status: 403 });
    const clientes = email !== viewer.email && Array.isArray(body?.clientes) ? body.clientes.map(String) : [];
    const row = await createOnboarding(supabaseAdmin(), { email, name: body?.name ?? null, leader: email !== viewer.email ? body?.leader ?? null : null, ingreso: body?.ingreso ?? null, clientes, by: viewer.email });
    return NextResponse.json({ id: row.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
