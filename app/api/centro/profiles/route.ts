import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { profilesFor } from "@/lib/centroProspeccion/people";

export const dynamic = "force-dynamic";

// Nombre y color de cada persona (equivale a user.profiles() del artifact).
export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string" && x.length <= 200) : [];
  try {
    return NextResponse.json({ profiles: await profilesFor(ids) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
