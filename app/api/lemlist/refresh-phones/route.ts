import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({ refreshed: 0, message: "Phone refresh pendiente de implementación" });
}
