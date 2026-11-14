import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// Página HTML del onboarding (diseño original). La página de la plataforma
// le inyecta el plan y el avance del SDR (lib/onboardingSdr/bridge.ts).
export async function GET() {
  try {
    const html = await fs.readFile(path.join(process.cwd(), "content/onboarding-sdr/onboarding.html"), "utf8");
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "No se encontró la página del onboarding" }, { status: 500 });
  }
}
