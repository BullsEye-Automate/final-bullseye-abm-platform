/**
 * Helper para soportar múltiples campañas de Lemlist activas a la vez.
 *
 * Motivo: cuando se rota a una versión nueva del playbook (ej. v2 Email
 * First) los leads nuevos van a la campaña nueva pero los leads viejos
 * siguen viviendo en la anterior. El dashboard tiene que mostrar la
 * actividad combinada.
 *
 * Convención de la env var `LEMLIST_CAMPAIGN_ID`:
 *   - Un solo ID: `cam_XXXX` → comportamiento histórico (1 campaña).
 *   - CSV: `cam_NUEVA, cam_VIEJA` → la primera es la "primaria" (nuevos
 *     leads se pushean ahí) y las siguientes son "legacy" (se leen para
 *     actividad/teléfonos pero no se escribe).
 *
 * Para mantener compatibilidad, el orden importa: el primer ID es el
 * destino de cualquier nuevo push.
 */

export function getLemlistCampaignIds(): string[] {
  const raw = process.env.LEMLIST_CAMPAIGN_ID ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function getPrimaryLemlistCampaignId(): string | null {
  const ids = getLemlistCampaignIds();
  return ids.length > 0 ? ids[0] : null;
}
