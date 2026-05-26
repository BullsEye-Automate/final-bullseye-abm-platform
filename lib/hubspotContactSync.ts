// Sincronización automática de contacto → HubSpot después de ser enriquecido.
// Se llama desde el webhook de scored-contacts cuando se auto-aprueba.

import { pushContactToHubspot, type ContactHubspotPushResult } from "@/lib/hubspotPush";

/**
 * Sincroniza un contacto con HubSpot.
 * Wrapper conveniente sobre pushContactToHubspot con logging.
 */
export async function syncContactToHubspot(
  contactId: string
): Promise<ContactHubspotPushResult> {
  console.log(`[hubspotContactSync] Sincronizando contacto ${contactId}`);

  const result = await pushContactToHubspot(contactId);

  if (result.ok) {
    console.log(
      `[hubspotContactSync] Contacto ${contactId} sincronizado. ` +
        `HubSpot ID: ${result.hubspotContactId} (${result.created ? "creado" : "actualizado"})`
    );
  } else {
    console.error(
      `[hubspotContactSync] Error sincronizando contacto ${contactId}: ${result.error}`
    );
  }

  return result;
}
