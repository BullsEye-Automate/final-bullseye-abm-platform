import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!
);

// Normaliza encabezados del CSV (case insensitive, espacios, tildes)
function normalizeKey(k: string) {
  return k.toLowerCase().trim()
    .replace(/á/g, "a").replace(/é/g, "e").replace(/í/g, "i")
    .replace(/ó/g, "o").replace(/ú/g, "u").replace(/ñ/g, "n")
    .replace(/\s+/g, "_");
}

function parseCSV(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(normalizeKey);
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? "").trim().replace(/^"|"$/g, ""); });
    return row;
  });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 });

  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length === 0) return NextResponse.json({ error: "CSV vacío o mal formateado" }, { status: 400 });

  const records = rows.map(r => ({
    client_id:       r["id_cliente"] || r["client_id"] || null,
    empresa:         r["empresa"] || r["company"] || "",
    contacto_nombre: r["contacto_nombre"] || r["contacto"] || r["nombre"] || null,
    contacto_cargo:  r["contacto_cargo"] || r["cargo"] || null,
    fecha_reunion:   r["fecha_reunion"] || r["fecha"] || null,
    realizado:       r["realizado"] || "Pendiente",
    notas:           r["notas"] || r["notes"] || null,
    sdr_nombre:      r["sdr"] || r["sdr_nombre"] || null,
  })).filter(r => r.empresa);

  if (records.length === 0) {
    return NextResponse.json({ error: "No se encontraron filas válidas. Verifica que el CSV tenga columna 'Empresa'" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("meetings")
    .upsert(records, { ignoreDuplicates: false })
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imported: data?.length ?? 0 });
}
