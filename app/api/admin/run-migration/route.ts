import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Endpoint temporal para ejecutar la migración de company_review_sessions.
// Borrar este archivo una vez ejecutado con éxito.
export async function GET() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return NextResponse.json({ error: "Env vars faltantes" }, { status: 500 });
  }

  const statements = [
    `ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_status_check`,
    `ALTER TABLE companies ADD CONSTRAINT companies_status_check
       CHECK (status IN ('pending','approved','rejected','client_approved','client_rejected'))`,
    `CREATE TABLE IF NOT EXISTS company_review_sessions (
       id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
       client_id   uuid REFERENCES clients(id) NOT NULL,
       token       text NOT NULL UNIQUE,
       label       text,
       expires_at  timestamptz NOT NULL,
       created_at  timestamptz DEFAULT now(),
       created_by  text
     )`,
    `CREATE TABLE IF NOT EXISTS company_review_session_items (
       id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
       session_id  uuid REFERENCES company_review_sessions(id) ON DELETE CASCADE NOT NULL,
       company_id  uuid REFERENCES companies(id) NOT NULL,
       created_at  timestamptz DEFAULT now(),
       UNIQUE(session_id, company_id)
     )`,
  ];

  const results: { sql: string; ok: boolean; error?: string }[] = [];

  for (const sql of statements) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/exec_migration`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
          "apikey": key,
        },
        body: JSON.stringify({ query: sql }),
      });

      if (!res.ok) {
        // Fallback: intentar vía pg_meta
        const res2 = await fetch(`${url}/pg/query`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`,
          },
          body: JSON.stringify({ query: sql }),
        });
        if (!res2.ok) {
          const errText = await res2.text().catch(() => res2.statusText);
          results.push({ sql: sql.slice(0, 60), ok: false, error: errText });
        } else {
          results.push({ sql: sql.slice(0, 60), ok: true });
        }
      } else {
        results.push({ sql: sql.slice(0, 60), ok: true });
      }
    } catch (e: unknown) {
      results.push({ sql: sql.slice(0, 60), ok: false, error: String(e) });
    }
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ allOk, results }, { status: allOk ? 200 : 500 });
}
