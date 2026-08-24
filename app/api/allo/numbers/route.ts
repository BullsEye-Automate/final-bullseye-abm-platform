import { NextResponse } from "next/server";
import { listAlloNumbers } from "@/lib/allo";

export const dynamic = "force-dynamic";

// Lista en vivo los números de Allo del workspace, para el buscador de
// "config cliente". No se cachea en Supabase: son pocos números y deben
// reflejar siempre lo que existe en Allo.
export async function GET() {
  try {
    const numbers = await listAlloNumbers();
    return NextResponse.json({ numbers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Error consultando Allo" }, { status: 500 });
  }
}
