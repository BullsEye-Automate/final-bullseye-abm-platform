import { NextRequest, NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { canMarkComisionable, getComisionableEditors, setComisionableEditors } from "@/lib/dashboardSdr/billing";

export const dynamic = "force-dynamic";

// Quién valida las «Reuniones comisionables» del Dashboard SDR
// (lib/dashboardSdr/billing.ts). GET: la lista. PUT { emails }: guarda la
// parte editable. Solo personas que ya están en la lista.
export async function GET() {
  if (!(await canMarkComisionable(await currentUserEmail()))) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  return NextResponse.json(await getComisionableEditors());
}

export async function PUT(req: NextRequest) {
  try {
    const email = await currentUserEmail();
    if (!email || !(await canMarkComisionable(email))) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    const b = await req.json().catch(() => null);
    return NextResponse.json(await setComisionableEditors(b?.emails, email));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
