// Envío del correo diario de alertas a las líderes de célula.
//
// Destinatarios (confirmados con BullsEye): cada líder recibe su célula y
// Ingri Hincapié va en copia. Modo de envío según CELULAS_ALERTS_MODE:
// - "live": a cada líder, con copia a CC_ALWAYS;
// - cualquier otro valor o vacío (por defecto): modo prueba, TODOS los
//   correos van solo a TEST_RECIPIENT. Así se revisan antes de activarlos.
// Remitente: CELULAS_ALERTS_FROM (casilla de bullseye-abm.com) o, si no está,
// ihincapie@bullseye-abm.com. Requiere delegación de dominio de Gmail (ver
// lib/gmail.ts).
import { sendGmail } from "@/lib/gmail";
import { normalizeSdrName } from "@/lib/sdrAnalytics";
import { chileToday, isBusinessDay } from "@/lib/celulasSdr/calendar";
import { buildLeaderDigest, loadModelForDigest, type LeaderDigest } from "./digest";

// Clave = nombre de pila del líder (normalizado), igual que en la Maestra.
const LEADER_EMAILS: Record<string, string> = {
  nicolle: "nnazar@bullseye-abm.com",
  vanessa: "vabarzua@bullseye-abm.com",
};
const CC_ALWAYS = ["ihincapie@bullseye-abm.com"];
const TEST_RECIPIENT = "ihincapie@bullseye-abm.com";

export function leaderEmail(leaderName: string): string | null {
  const first = normalizeSdrName(leaderName).split(" ")[0];
  return LEADER_EMAILS[first] ?? null;
}

export type SendResult = { leader: string; to: string[]; cc: string[]; subject: string; status: "sent" | "skipped" | "error"; error?: string };

export async function buildAllDigests(today = chileToday()): Promise<{ digests: LeaderDigest[]; warnings: string[] }> {
  const { M, warnings } = await loadModelForDigest(today);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com";
  return { digests: M.leaders.map((l) => buildLeaderDigest(M, l, today, appUrl, warnings)), warnings };
}

export async function sendCellAlerts(opts: { today?: string; force?: boolean; testOnly?: boolean; leaderKey?: string } = {}): Promise<{ mode: string; today: string; results: SendResult[]; skippedReason?: string }> {
  const today = opts.today ?? chileToday();
  const live = process.env.CELULAS_ALERTS_MODE === "live" && !opts.testOnly;
  const mode = live ? "live" : "test";
  if (!opts.force && !isBusinessDay(today)) return { mode, today, results: [], skippedReason: "No es día hábil" };

  const from = process.env.CELULAS_ALERTS_FROM || "ihincapie@bullseye-abm.com";
  const { digests } = await buildAllDigests(today);
  const results: SendResult[] = [];
  for (const d of digests) {
    if (opts.leaderKey && d.leader.key !== opts.leaderKey) continue;
    const leaderTo = leaderEmail(d.leader.name);
    const to = live ? (leaderTo ? [leaderTo] : []) : [TEST_RECIPIENT];
    const cc = live ? CC_ALWAYS.filter((c) => !to.includes(c)) : [];
    const subject = live ? d.subject : `[PRUEBA → ${leaderTo ?? "sin correo"}] ${d.subject}`;
    if (!to.length) {
      results.push({ leader: d.leader.name, to, cc, subject, status: "skipped", error: "Líder sin correo configurado" });
      continue;
    }
    try {
      await sendGmail({ from, fromName: "BullsEye · Células SDR", to, cc, subject, html: d.html });
      results.push({ leader: d.leader.name, to, cc, subject, status: "sent" });
    } catch (e) {
      results.push({ leader: d.leader.name, to, cc, subject, status: "error", error: (e as Error).message });
    }
  }
  return { mode, today, results };
}
