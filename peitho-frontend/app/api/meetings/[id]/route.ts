import { NextResponse } from "next/server";

// Proxy server-side hacia peitho-backend — lo usa ResearchButton (client
// component) para chequear pre_brief_status mientras hace polling. Un client
// component no puede llamar a peitho-backend directo (otro origen, CORS);
// esta ruta corre en el servidor de Next.js, igual que los Server Components.
function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${backendUrl()}/meetings/${params.id}`, { cache: "no-store" });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
