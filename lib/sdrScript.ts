import { anthropic, CLAUDE_MODEL } from "@/lib/claude";

export async function generateSdrScript(opts: {
  firstName:   string;
  lastName:    string;
  jobTitle:    string;
  companyName: string;
  fitSignals:  string | null;
  icpContext:  string | null;
  emailBody:   string | null;
  icebreaker:  string | null;
  trainingCtx: string | null;
}): Promise<string> {
  const { firstName, lastName, jobTitle, companyName, fitSignals, icpContext, emailBody, icebreaker, trainingCtx } = opts;

  const system = `Eres un experto en ventas B2B que prepara scripts de llamada para SDRs.
Redacta scripts concisos y personalizados en formato bullet-points, listos para usar como material de apoyo durante la llamada.
Usa un tono consultivo y directo. Evita frases genéricas.
NUNCA uses guiones largos (—). En su lugar usa comas o puntos según corresponda.
Responde SOLO con el script en markdown.`;

  const user = `Prepara un script de llamada SDR para este contacto:

**Contacto:** ${firstName} ${lastName} — ${jobTitle} en ${companyName}
${fitSignals  ? `\n**Por qué encajan:** ${fitSignals}` : ""}
${icpContext  ? `\n**Contexto ICP / negocio:** ${icpContext}` : ""}
${trainingCtx ? `\n**Propuesta de valor:** ${trainingCtx}` : ""}
${emailBody   ? `\n**Email ya enviado (para coherencia):** ${emailBody.slice(0, 400)}` : ""}
${icebreaker  ? `\n**Icebreaker LinkedIn:** ${icebreaker}` : ""}

---
Estructura el script con estas secciones (cada una 2-4 bullets breves):
1. **Apertura** — presentación + enganche personalizado a ${companyName}
2. **Propuesta de valor** — específica para el cargo de ${jobTitle}
3. **Preguntas de calificación** — para abrir el diálogo
4. **Manejo de objeción más probable** — respuesta corta lista para usar
5. **CTA** — siguiente paso concreto (reunión, demo, etc.)`;

  const res = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 800,
    messages: [{ role: "user", content: user }],
    system,
  });

  return (res.content[0] as { type: "text"; text: string }).text.trim();
}
