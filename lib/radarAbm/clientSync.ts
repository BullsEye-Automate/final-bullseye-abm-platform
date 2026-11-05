// Navegador: sincroniza el Pulso ABM de un cliente. Si la cuenta tiene varios
// clientes (Configuración → Cliente → Pulso ABM → "Clientes dentro de este
// HubSpot"), el servidor responde 409 con la lista y se sincroniza uno por
// llamada (cada uno con sus 5 minutos de Vercel).

type SyncStats = { companies?: number; contacts?: number; meetings?: number; deals?: number; seconds?: number };
export type SyncOutcome = { ok: boolean; message: string; syncedAt?: string | null; stats?: SyncStats };

async function post(clientId: string, sub?: string) {
  const r = await fetch(`/api/radar-abm?client_id=${clientId}${sub ? `&sub=${encodeURIComponent(sub)}` : ""}`, { method: "POST" }).catch(() => null);
  if (!r) return { r: null as Response | null, d: { error: "se perdió la conexión con el servidor (puede seguir corriendo; recarga en unos minutos)" } as any };
  const raw = await r.text().catch(() => "");
  let d: any;
  try { d = JSON.parse(raw); } catch { d = { error: r.ok ? null : `${r.status}: ${raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}` }; }
  if (r.status === 504) d = { error: "la sincronización superó el tiempo máximo (5 min). Vuelve a intentarlo; si se repite, avísale al equipo técnico" };
  return { r, d };
}

const summary = (s?: SyncStats, warnings?: string[]) =>
  `${s?.companies ?? 0} empresas, ${s?.contacts ?? 0} contactos, ${s?.meetings ?? 0} reuniones${s?.seconds ? ` (${s.seconds} s)` : ""}${(warnings ?? []).some((w) => w.includes("por tiempo")) ? ", parcial por tiempo" : ""}`;

export async function runRadarSync(clientId: string, onProgress?: (msg: string) => void): Promise<SyncOutcome> {
  const first = await post(clientId);
  if (first.r?.status === 409 && Array.isArray(first.d?.needsSubs)) {
    const subs: string[] = first.d.needsSubs;
    const parts: string[] = [];
    let ok = true, syncedAt: string | null = null;
    for (const [i, sub] of subs.entries()) {
      onProgress?.(`Sincronizando ${sub} (${i + 1} de ${subs.length})…`);
      const { r, d } = await post(clientId, sub);
      if (!r?.ok || d.error) { ok = false; parts.push(`${sub}: no se pudo (${d.error ?? `error ${r?.status}`})`); continue; }
      syncedAt = d.syncedAt ?? syncedAt;
      parts.push(`${sub}: ${summary(d.stats, d.warnings)}`);
    }
    return { ok, syncedAt, message: `${ok ? "Sincronizado" : "Sincronización con errores"} — ${parts.join(" · ")}.` };
  }
  const { r, d } = first;
  if (!r?.ok || d.error) return { ok: false, message: `No se pudo sincronizar: ${d.error ?? `error ${r?.status}`}` };
  return { ok: true, syncedAt: d.syncedAt, stats: d.stats, message: `Sincronizado: ${summary(d.stats, d.warnings)}.` };
}
