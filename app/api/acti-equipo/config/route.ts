import { NextRequest, NextResponse } from "next/server";
import { loadActiConfig, requireInternalUser, saveActiConfig } from "@/lib/acti/server";
import { canEditPlans } from "@/lib/acti/permissions";

export const dynamic = "force-dynamic";

// Configuración de planes ACTI. La ve todo el equipo; la editan solo
// las personas de PLAN_EDITORS (lib/acti/permissions.ts).
export async function GET() {
  const auth = await requireInternalUser();
  if (auth.response) return auth.response;
  return NextResponse.json({ config: await loadActiConfig(), canEdit: canEditPlans(auth.email) });
}

export async function PUT(req: NextRequest) {
  const auth = await requireInternalUser();
  if (auth.response) return auth.response;
  if (!canEditPlans(auth.email)) {
    return NextResponse.json({ error: "No tienes permiso para editar los planes ACTI" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.config) return NextResponse.json({ error: "Falta config" }, { status: 400 });
  try {
    return NextResponse.json({ config: await saveActiConfig(body.config, auth.email) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: /acti_config|does not exist|relation/i.test(msg) ? "Falta correr la migración supabase/20261127_acti_fase1_migration.sql" : msg }, { status: 500 });
  }
}
