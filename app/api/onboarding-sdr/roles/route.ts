import { NextRequest, NextResponse } from "next/server";
import { currentViewer, isEditor } from "@/lib/onboardingSdr/server/access";
import { getRoleLists, setRoleLists } from "@/lib/onboardingSdr/server/roles";
import { serviceAccountInfo, testCalendar } from "@/lib/onboardingSdr/server/calendar";

export const dynamic = "force-dynamic";

// Quién es líder, RRHH, habilitadora o administradora del Onboarding SDR.
// GET: editoras. PUT { lider?, rrhh?, hab?, admin? }: solo administradoras.
export async function GET(request: NextRequest) {
  const v = await currentViewer();
  if (!v || !isEditor(v)) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  // Datos para autorizar el calendario (solo administradoras) y prueba con
  // el calendario de quien mira (?test=1).
  const calendar = v.admin ? serviceAccountInfo() : null;
  const test = v.admin && new URL(request.url).searchParams.get("test") === "1" ? await testCalendar(v.email) : null;
  return NextResponse.json({ roles: await getRoleLists(), admin: v.admin, calendar, test });
}

export async function PUT(request: NextRequest) {
  try {
    const v = await currentViewer();
    if (!v?.admin) return NextResponse.json({ error: "Solo una administradora cambia los roles" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ roles: await setRoleLists(body ?? {}, v.email) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
