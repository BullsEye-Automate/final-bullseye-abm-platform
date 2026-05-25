import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "HUBSPOT_ACCESS_TOKEN no configurado" },
      { status: 500 }
    );
  }

  const res = await fetch(
    "https://api.hubapi.com/crm/v3/owners?limit=100&archived=false",
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `HubSpot respondió ${res.status}: ${text.slice(0, 200)}` },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json({ owners: data.results ?? [] });
}
