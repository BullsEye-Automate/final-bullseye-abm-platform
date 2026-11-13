import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { appUrl, currentViewer, isEditor, rolesOn } from "@/lib/onboardingSdr/server/access";
import { OpError, applyOp, getById, loadAcademies, loadCatalog, setActive, stateOf, updateMeta, type Op } from "@/lib/onboardingSdr/server/store";
import { loadOnboardingCalendar } from "@/lib/onboardingSdr/server/calendar";
import { HAB_NAME, HITOS, STAGES, type Role } from "@/lib/onboardingSdr/plan";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  const viewer = await currentViewer();
  if (!viewer) return { error: NextResponse.json({ error: "Sin sesión" }, { status: 401 }) };
  if (!UUID_RE.test(id)) return { error: NextResponse.json({ error: "Onboarding no encontrado" }, { status: 404 }) };
  const db = supabaseAdmin();
  const row = await getById(db, id);
  if (!row) return { error: NextResponse.json({ error: "Onboarding no encontrado" }, { status: 404 }) };
  const roles = rolesOn(viewer, row);
  if (!roles.length) return { error: NextResponse.json({ error: "Solo puedes ver tu propio onboarding" }, { status: 403 }) };
  return { viewer, db, row, roles };
}

// GET ?fresh=1 → todo lo que necesita la página: plan, avance, roles con los
// que actúa quien mira, clientes, entrenamientos y calendario del SDR.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const r = await load(params.id);
    if ("error" in r) return r.error;
    const { viewer, db, row, roles } = r;
    const fresh = request.nextUrl.searchParams.get("fresh") === "1";
    const [catalog, acad, cal] = await Promise.all([
      loadCatalog(db, appUrl()),
      loadAcademies(db, [row.sdr_email]),
      loadOnboardingCalendar(row.sdr_email, row.ingreso, fresh),
    ]);
    return NextResponse.json({
      onb: {
        stages: STAGES,
        hitos: HITOS,
        hab: HAB_NAME,
        state: stateOf(row),
        academias: acad.get(row.sdr_email) ?? {},
        catalog,
        cal,
        roles,
        viewer: viewer.email,
        own: row.sdr_email === viewer.email,
        sdrName: row.sdr_name || row.sdr_email,
      },
      meta: { id: row.id, email: row.sdr_email, name: row.sdr_name, leader: row.leader_name, active: row.is_active },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

// PATCH { role, op } → aplica un cambio y devuelve el estado oficial.
// PATCH { active: boolean } → archivar / reactivar (solo editoras).
// PATCH { meta: { name?, leader?, ingreso? } } → corregir datos del SDR (solo editoras).
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const r = await load(params.id);
    if ("error" in r) return r.error;
    const { viewer, db, row, roles } = r;
    const body = await request.json().catch(() => null);
    if (typeof body?.active === "boolean") {
      if (!isEditor(viewer)) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
      await setActive(db, row.id, body.active);
      return NextResponse.json({ ok: true });
    }
    if (body?.meta && typeof body.meta === "object") {
      if (!isEditor(viewer)) return NextResponse.json({ error: "Solo la líder, RRHH o una administradora corrigen estos datos" }, { status: 403 });
      const { name, leader, ingreso } = body.meta as { name?: string; leader?: string; ingreso?: string };
      await updateMeta(db, row.id, { name, leader, ingreso }, viewer.email, viewer.admin ? "admin" : viewer.editorRoles[0] ?? "editor");
      return NextResponse.json({ ok: true });
    }
    const role = body?.role as Role;
    if (!roles.includes(role)) return NextResponse.json({ error: "No tienes ese rol en este onboarding" }, { status: 403 });
    const op = body?.op as Op;
    if (!op || typeof op !== "object") return NextResponse.json({ error: "Operación inválida" }, { status: 400 });
    const saved = await applyOp(db, row.id, op, role, viewer.email, appUrl());
    const acad = await loadAcademies(db, [saved.sdr_email]);
    return NextResponse.json({ state: stateOf(saved), academias: acad.get(saved.sdr_email) ?? {} });
  } catch (err) {
    if (err instanceof OpError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
