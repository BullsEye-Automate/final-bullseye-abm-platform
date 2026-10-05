import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { perplexitySearch } from "@/lib/perplexity";
import { anthropic, getClientModel } from "@/lib/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export type ContactRow = {
  empresa: string;
  sitio_web: string;
  linkedin_url: string;
  nombre: string;
  apellido: string;
  cargo: string;
  email: string;
};

export type MatrixRow = ContactRow & {
  senalEmpresa: string;
  hipotesisDolor: string;
  status: "ok" | "error";
  error?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const { client_id, contacts, segment_id }: { client_id: string; contacts: ContactRow[]; segment_id?: string } = body;
  if (!client_id || !contacts?.length)
    return NextResponse.json({ error: "Se requieren client_id y contacts" }, { status: 400 });

  const db = supabaseAdmin();

  // Si hay segmento específico, usarlo solo — sin propuesta de valor general
  const soloSegmento = !!segment_id;

  const [{ data: icpData }, { data: tc }, segmentRows] = await Promise.all([
    soloSegmento
      ? Promise.resolve({ data: null })
      : db.from("icp_config")
          .select("notes")
          .eq("client_id", client_id)
          .eq("is_active", true)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
    soloSegmento
      ? Promise.resolve({ data: null })
      : db.from("model_training_config")
          .select("business_description, value_props, talking_points, target_buyer_persona")
          .eq("client_id", client_id)
          .maybeSingle(),
    db.from("training_segments")
      .select("id")
      .eq("client_id", client_id),
  ]);

  // Cargar fuentes: si hay segment_id específico, solo ese; si no, todos los segmentos del cliente
  let sourcesContent = "";
  const segmentIds = soloSegmento
    ? [segment_id!]
    : (segmentRows.data ?? []).map((s: any) => s.id);

  if (segmentIds.length > 0) {
    const { data: sources } = await db
      .from("segment_sources")
      .select("content, title, source_type")
      .in("segment_id", segmentIds)
      .not("content", "is", null)
      .order("created_at", { ascending: true });
    if (sources && sources.length > 0) {
      sourcesContent = sources
        .map((s: any) => `[${s.title ?? s.source_type}]\n${(s.content ?? "").slice(0, 3000)}`)
        .join("\n\n---\n\n")
        .slice(0, 15000);
    }
  }

  let contextoCliente: string;
  let descripcionServicio = "";
  let clienteIdeal = "";

  if (soloSegmento) {
    // Modo segmento específico: solo fuentes, sin propuesta de valor general
    if (!sourcesContent)
      return NextResponse.json({ error: "El segmento seleccionado no tiene fuentes de conocimiento con contenido." }, { status: 400 });
    contextoCliente = `Fuentes de conocimiento del segmento:\n\n${sourcesContent}`;
  } else {
    const propuestaDeValor = [
      icpData?.notes,
      tc?.value_props          && `Propuesta de valor: ${tc.value_props}`,
      tc?.business_description && `Descripción del negocio: ${tc.business_description}`,
      tc?.talking_points       && `Puntos clave: ${tc.talking_points}`,
    ].filter(Boolean).join("\n\n");

    contextoCliente = [propuestaDeValor, sourcesContent && `\n\nFuentes de conocimiento del cliente:\n${sourcesContent}`]
      .filter(Boolean).join("\n\n");

    if (!contextoCliente)
      return NextResponse.json({ error: "No hay contexto de cliente configurado. Ve a Sistema → ICP o Entrenar modelo." }, { status: 400 });

    descripcionServicio = tc?.business_description ?? "";
    clienteIdeal = tc?.target_buyer_persona ?? "";
  }

  const model = await getClientModel(db, client_id);

  // Agrupar contactos por empresa para investigar cada empresa una sola vez
  const empresaMap = new Map<string, ContactRow[]>();
  for (const c of contacts) {
    const key = c.empresa.trim().toLowerCase();
    if (!empresaMap.has(key)) empresaMap.set(key, []);
    empresaMap.get(key)!.push(c);
  }

  const senalPorEmpresa = new Map<string, string>();

  // Paso 1: investigar cada empresa y generar SenalEmpresa
  for (const [key, rows] of empresaMap) {
    const { empresa, sitio_web, linkedin_url } = rows[0];
    try {
      const research = await perplexitySearch({
        system: `Eres un analista de inteligencia comercial especializado en ABM (Account-Based Marketing).
Tu tarea es investigar empresas y extraer señales relevantes para campañas de outreach B2B.
Sé específico, conciso y basa todo en información pública verificable.
Distingue siempre entre Hecho, Interpretación e Hipótesis.`,
        user: `Investiga la siguiente empresa para una campaña ABM:

Empresa: ${empresa}
Sitio web: ${sitio_web || "no disponible"}
LinkedIn: ${linkedin_url || "no disponible"}

Contexto del cliente que hace el outreach:
${contextoCliente.slice(0, 4000)}

Busca información pública reciente sobre:
- Situación actual de la empresa (expansión, reestructuración, nuevos productos, ajuste presupuestario, etc.)
- Noticias, comunicados, reportes, ofertas de empleo relevantes
- Cambios organizacionales o estratégicos
- Iniciativas tecnológicas o digitales

Solo incluye información con relación clara a la propuesta de valor descrita. Si no hay evidencia suficiente, indícalo.`,
        searchRecencyFilter: "year",
      });

      // Generar SenalEmpresa con Claude
      const senalRes = await anthropic().messages.create({
        model,
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `Basándote en la siguiente investigación sobre ${empresa}, construye una SenalEmpresa.

La SenalEmpresa debe:
- Explicar brevemente qué está ocurriendo en la empresa
- Señalar el contexto que rodea esa situación
- Apuntar a la tensión o desafío que podría generar
- Tener relación directa con el contexto del cliente

Formato: 1-2 oraciones directas, sin sujeto explícito ("Están expandiendo..." no "La empresa está expandiendo...").
Ejemplo: "Están expandiendo operaciones a nuevos mercados de LATAM, lo que probablemente está generando presión por escalar procesos y tecnología sin aumentar complejidad operacional en la misma proporción."

NO uses frases genéricas que apliquen a cualquier empresa. Debe surgir de los hallazgos específicos.
Si no hay evidencia suficiente, responde exactamente: SIN_EVIDENCIA_SUFICIENTE

Investigación:
${research.content}`,
          },
        ],
      });

      const senal = (senalRes.content[0] as any).text?.trim() ?? "SIN_EVIDENCIA_SUFICIENTE";
      senalPorEmpresa.set(key, senal);
    } catch (e: any) {
      senalPorEmpresa.set(key, `ERROR: ${e?.message ?? "desconocido"}`);
    }
  }

  // Paso 2: generar HipótesisDolor por cada combinación empresa-cargo
  const matrix: MatrixRow[] = [];

  for (const contact of contacts) {
    const key = contact.empresa.trim().toLowerCase();
    const senal = senalPorEmpresa.get(key) ?? "SIN_EVIDENCIA_SUFICIENTE";

    if (senal.startsWith("ERROR:") || senal === "SIN_EVIDENCIA_SUFICIENTE") {
      matrix.push({
        ...contact,
        senalEmpresa: senal,
        hipotesisDolor: "",
        status: "error",
        error: senal,
      });
      continue;
    }

    try {
      const hipRes = await anthropic().messages.create({
        model,
        max_tokens: 250,
        messages: [
          {
            role: "user",
            content: `Construye una HipótesisDolor para la siguiente combinación de empresa y cargo.

Empresa: ${contact.empresa}
Señal de la empresa: ${senal}
Cargo del contacto: ${contact.cargo}

Contexto del cliente:
${contextoCliente.slice(0, 6000)}
${clienteIdeal ? `\nBuyer persona objetivo: ${clienteIdeal}` : ""}

La HipótesisDolor debe:
- Partir de la señal específica de la empresa (no del cargo en abstracto)
- Cruzar esa señal con las responsabilidades propias de ese cargo
- Identificar la tensión o desafío que esa situación genera para ESA persona
- Conectar naturalmente con la propuesta de valor

Formato: 1 oración, segunda persona implícita, sin mencionar la empresa ni el cargo directamente.
Ejemplo: "puede traducirse en mayor presión por escalar la infraestructura digital sin comprometer la estabilidad de los servicios actuales."

La oración debe poder insertarse directamente después de: "Para un rol como el tuyo, esto podría traducirse en..."`,
          },
        ],
      });

      const hipotesis = (hipRes.content[0] as any).text?.trim() ?? "";
      matrix.push({
        ...contact,
        senalEmpresa: senal,
        hipotesisDolor: hipotesis,
        status: "ok",
      });
    } catch (e: any) {
      matrix.push({
        ...contact,
        senalEmpresa: senal,
        hipotesisDolor: "",
        status: "error",
        error: e?.message ?? "Error generando hipótesis",
      });
    }
  }

  return NextResponse.json({ matrix });
}
