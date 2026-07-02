import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Endpoint temporal para ejecutar la migración de company_review_sessions.
// Uso: GET /api/admin/run-migration?pat=TU_TOKEN_PERSONAL_SUPABASE
// Obtén el token en: https://supabase.com/dashboard/account/tokens
// Borrar este archivo una vez ejecutado con éxito.
export async function GET(req: NextRequest) {
  const pat = req.nextUrl.searchParams.get("pat");
  if (!pat) {
    return NextResponse.json(
      {
        error: "Falta el parámetro ?pat=",
        instrucciones: [
          "1. Ve a https://supabase.com/dashboard/account/tokens",
          "2. Crea un nuevo token personal",
          "3. Visita esta URL con ?pat=TU_TOKEN",
        ],
      },
      { status: 400 }
    );
  }

  // Ref del proyecto extraído de la URL de Supabase
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (!match) {
    return NextResponse.json({ error: "No se pudo extraer el project ref de SUPABASE_URL" }, { status: 500 });
  }
  const projectRef = match[1];

  const statements = [
    `ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_status_check`,
    `ALTER TABLE companies ADD CONSTRAINT companies_status_check CHECK (status IN ('pending','approved','rejected','client_approved','client_rejected'))`,
    `CREATE TABLE IF NOT EXISTS company_review_sessions (
      id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      client_id  uuid REFERENCES clients(id) NOT NULL,
      token      text NOT NULL UNIQUE,
      label      text,
      expires_at timestamptz NOT NULL,
      created_at timestamptz DEFAULT now(),
      created_by text
    )`,
    `CREATE TABLE IF NOT EXISTS company_review_session_items (
      id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      session_id uuid REFERENCES company_review_sessions(id) ON DELETE CASCADE NOT NULL,
      company_id uuid REFERENCES companies(id) NOT NULL,
      created_at timestamptz DEFAULT now(),
      UNIQUE(session_id, company_id)
    )`,
  ];

  const results: { sql: string; ok: boolean; error?: string }[] = [];

  for (const sql of statements) {
    try {
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${pat}`,
          },
          body: JSON.stringify({ query: sql }),
        }
      );
      if (!res.ok) {
        const body = await res.text().catch(() => res.statusText);
        results.push({ sql: sql.slice(0, 80), ok: false, error: body });
      } else {
        results.push({ sql: sql.slice(0, 80), ok: true });
      }
    } catch (e: unknown) {
      results.push({ sql: sql.slice(0, 80), ok: false, error: String(e) });
    }
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ allOk, results }, { status: allOk ? 200 : 207 });
}
