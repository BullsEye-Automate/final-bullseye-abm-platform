import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_ACCESS_TOKEN no configurado" }, { status: 500 });

  // Verificar a qué portal pertenece el token
  const whoami = await fetch("https://api.hubapi.com/oauth/v1/access-tokens/" + token, {
    headers: { "Content-Type": "application/json" },
  });
  const whoamiData = whoami.ok ? await whoami.json() : null;

  // Intentar crear un contacto de prueba
  const testRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        firstname: "TEST_BULLSEYE",
        lastname:  "DELETE_ME",
        email:     `test-bullseye-${Date.now()}@deleteme.com`,
      },
    }),
  });

  const testBody = await testRes.text();

  return NextResponse.json({
    token_preview:  token.slice(0, 8) + "...",
    portal:         whoamiData,
    test_status:    testRes.status,
    test_response:  testBody.slice(0, 500),
  });
}
