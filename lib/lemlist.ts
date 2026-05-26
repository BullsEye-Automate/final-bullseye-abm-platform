// Integración con la API de Lemlist para crear leads en campañas.

export type LemlistLead = {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  linkedinUrl?: string | null;
  phone?: string | null;
  icebreaker?: string | null;
  // Campos personalizados con prefijo bullseye_
  bullseye_fit_score?: number | null;
  bullseye_fit_reason?: string | null;
  bullseye_fit_action?: string | null;
  // Permitir campos adicionales
  [key: string]: unknown;
};

export type LemlistAddLeadResult =
  | { ok: true; leadId: string; email: string | null }
  | { ok: false; error: string; status?: number };

/**
 * Agrega un lead a una campaña de Lemlist.
 * Si el lead no tiene email, lo omite y fuerza deduplicación por LinkedIn.
 */
export async function addLeadToLemlistCampaign(
  campaignId: string,
  lead: LemlistLead
): Promise<LemlistAddLeadResult> {
  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "LEMLIST_API_KEY no configurada" };
  }
  if (!campaignId) {
    return { ok: false, error: "campaignId requerido" };
  }

  // Lemlist requiere al menos un email o linkedinUrl para deduplicar
  const email = lead.email?.trim() || null;
  const linkedinUrl = lead.linkedinUrl?.trim() || null;

  if (!email && !linkedinUrl) {
    return {
      ok: false,
      error: "El lead debe tener email o linkedinUrl para añadirlo a Lemlist",
    };
  }

  // Construir el payload para Lemlist
  const payload: Record<string, unknown> = {};

  if (email) payload["email"] = email;
  if (lead.firstName) payload["firstName"] = lead.firstName;
  if (lead.lastName) payload["lastName"] = lead.lastName;
  if (lead.companyName) payload["companyName"] = lead.companyName;
  if (linkedinUrl) payload["linkedinUrl"] = linkedinUrl;
  if (lead.phone) payload["phone"] = lead.phone;
  if (lead.icebreaker) payload["icebreaker"] = lead.icebreaker;
  if (lead.bullseye_fit_score != null) payload["bullseye_fit_score"] = lead.bullseye_fit_score;
  if (lead.bullseye_fit_reason) payload["bullseye_fit_reason"] = lead.bullseye_fit_reason;
  if (lead.bullseye_fit_action) payload["bullseye_fit_action"] = lead.bullseye_fit_action;

  // Agregar cualquier campo adicional que no esté ya incluido
  for (const [k, v] of Object.entries(lead)) {
    if (
      ![
        "email", "firstName", "lastName", "companyName", "linkedinUrl",
        "phone", "icebreaker", "bullseye_fit_score", "bullseye_fit_reason",
        "bullseye_fit_action"
      ].includes(k) &&
      v != null
    ) {
      payload[k] = v;
    }
  }

  const url = `https://api.lemlist.com/api/campaigns/${campaignId}/leads/${encodeURIComponent(email ?? linkedinUrl!)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await res.text();
    let responseData: Record<string, unknown> = {};
    try {
      responseData = JSON.parse(responseText);
    } catch {
      // Si no es JSON, usar el texto como error
    }

    if (!res.ok) {
      const errMsg =
        (responseData["error"] as string) ||
        (responseData["message"] as string) ||
        responseText ||
        `HTTP ${res.status}`;
      return { ok: false, error: errMsg, status: res.status };
    }

    // Lemlist retorna el lead creado con _id
    const leadId =
      (responseData["_id"] as string) ||
      (responseData["leadId"] as string) ||
      "";

    return { ok: true, leadId, email };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
