import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { identifySdr } from "@/lib/academiaSdr/server/progress";

export const dynamic = "force-dynamic";

// Formulario de registro de reuniones de los SDR (el mismo de GitHub Pages
// del repo Hubspot-y-SDR-Dashboard, docs/index.html, que escribe por Apps
// Script en la planilla de reuniones). Se toma la versión publicada para no
// tener dos copias desalineadas; si GitHub Pages no responde se usa la copia
// del repo (content/formulario-reunion/index.html). Ver CLAUDE.md →
// "Formulario de reuniones".
const LIVE_URL = "https://bullseye-automate.github.io/Hubspot-y-SDR-Dashboard/";
const LIVE_TIMEOUT_MS = 5000;

async function loadLive(): Promise<string | null> {
  try {
    const res = await fetch(LIVE_URL, {
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Resguardo: que sea realmente el formulario (y no una página de error).
    return html.includes("SCRIPT_URL") && html.includes('id="form"') ? html : null;
  } catch {
    return null;
  }
}

export async function GET() {
  let raw = await loadLive();
  const source = raw ? "live" : "local";
  if (!raw) {
    try {
      raw = await fs.readFile(path.join(process.cwd(), "content/formulario-reunion/index.html"), "utf8");
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message || "No se encontró el formulario" }, { status: 500 });
    }
  }
  // El logo es relativo a GitHub Pages: dentro del portal se usa el de la marca.
  const html = raw.replace(/(["'])\.\/logo-white\.png\1/g, '"/brand/bullseye-logo-white.png"');

  // SDR de la sesión (correo → Maestra) para dejarlo elegido en el formulario.
  const email = await currentUserEmail();
  const sdrName = email ? (await identifySdr(email).catch(() => ({ sdrName: null }))).sdrName : null;

  return NextResponse.json({ html, source, sdrName }, { headers: { "Cache-Control": "no-store" } });
}
