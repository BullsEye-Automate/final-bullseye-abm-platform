import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("excluded_companies")
    .select("id, company_name, company_website, added_at")
    .eq("client_id", params.id)
    .order("company_name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ excluded: data ?? [] });
}

export async function POST(req: NextRequest, { params }: Params) {
  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Se requiere un archivo Excel" }, { status: 400 });

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No se encontró el archivo" }, { status: 400 });

  const buffer   = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];
  const rows     = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  // Acepta cualquier columna que contenga "name", "empresa" o "company" (case-insensitive)
  const names: string[] = [];
  for (const row of rows) {
    const key = Object.keys(row).find((k) =>
      /name|empresa|company/i.test(k)
    );
    const val = key ? String(row[key]).trim() : "";
    if (val) names.push(val);
  }

  if (names.length === 0) {
    return NextResponse.json(
      { error: "No se encontraron nombres de empresa. Asegúrate de que la columna se llame 'Company', 'Name' o 'Empresa'." },
      { status: 400 }
    );
  }

  const db   = supabaseAdmin();
  const rows2 = names.map((n) => ({ client_id: params.id, company_name: n }));

  // upsert para ignorar duplicados (índice único en client_id + lower(company_name))
  const { data, error } = await db
    .from("excluded_companies")
    .upsert(rows2, { onConflict: "client_id,company_name", ignoreDuplicates: true })
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ inserted: data?.length ?? 0, total: names.length });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const body = await req.json().catch(() => null);
  const ids: string[] = body?.ids ?? [];
  if (!ids.length) return NextResponse.json({ error: "Se requieren ids" }, { status: 400 });

  const db = supabaseAdmin();
  const { error } = await db
    .from("excluded_companies")
    .delete()
    .eq("client_id", params.id)
    .in("id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: ids.length });
}
