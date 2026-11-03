import { NextResponse } from "next/server";
import { requireCentroUser, isCentroOwner } from "@/lib/centroProspeccion/access";
import { resolveMyId } from "@/lib/centroProspeccion/people";

export const dynamic = "force-dynamic";

// Quién está mirando el Centro de prospección (equivale a user.me() del artifact).
export async function GET() {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  try {
    const id = await resolveMyId(u.email);
    return NextResponse.json({ id, email: u.email, name: u.name, isOwner: isCentroOwner(u.email), canWrite: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
