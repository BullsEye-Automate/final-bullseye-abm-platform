import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "training-files";

// GET /api/training/upload-url?filename=xxx.pdf
// Devuelve una signed URL para subir directamente a Supabase Storage desde el browser
export async function GET(req: NextRequest) {
  const filename = req.nextUrl.searchParams.get("filename");
  if (!filename) return NextResponse.json({ error: "filename requerido" }, { status: 400 });

  const ext = filename.split(".").pop()?.toLowerCase() ?? "bin";
  const storagePath = `pdfs/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const db = supabaseAdmin();

  // Crear el bucket si no existe
  await db.storage.createBucket(BUCKET, { public: false }).catch(() => {});

  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ signedUrl: data.signedUrl, path: storagePath, token: data.token });
}
