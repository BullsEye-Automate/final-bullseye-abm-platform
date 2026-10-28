// Carga de datos de Allo para Alertas de Números (ver engine.ts).
// Reutiliza el cliente de lib/allo.ts (throttle + caché compartida en
// allo_response_cache) y la asignación número → cliente de
// client_allo_numbers, igual que Salud Telefónica.
import { supabaseAdmin } from "@/lib/supabase";
import { listAlloNumbers, searchAlloCalls, fetchAlloConnectedCallIds, resolveConnected } from "@/lib/allo";
import { callDateKey, resolveCountryLabel } from "@/lib/sdrAnalytics";
import { addDays, chileToday } from "@/lib/celulasSdr/calendar";
import { evaluateNumber, sortHealth, type NumberHealth, type WindowStats, type AlertLevel } from "./engine";

export type PhoneHealthReport = {
  today: string;              // día de Chile en que se calculó
  windows: { current: [string, string]; previous: [string, string]; baseline: [string, string] };
  numbers: NumberHealth[];
  counts: Record<AlertLevel, number>;
  dataWarning: string | null; // si no es null, las alertas no son confiables (no se envía correo)
  generatedAt: string;
};

const SHORT_SECONDS = 15;
const emptyStats = (): WindowStats => ({ dials: 0, human: 0, voicemail: 0, short: 0 });

export async function buildPhoneHealthReport(today = chileToday()): Promise<PhoneHealthReport> {
  const end = addDays(today, -1); // ventanas cerradas: terminan ayer
  const current: [string, string] = [addDays(end, -6), end];
  const previous: [string, string] = [addDays(end, -13), addDays(end, -7)];
  const baseline: [string, string] = [addDays(end, -34), addDays(end, -7)];
  const from = baseline[0];

  const db = supabaseAdmin();
  const { data: assigned, error } = await db.from("client_allo_numbers").select("allo_number, client_id");
  if (error) throw new Error(`client_allo_numbers: ${error.message}`);
  const numberClient = new Map<string, string>((assigned ?? []).map((r: any) => [r.allo_number, r.client_id]));
  const numbers = [...numberClient.keys()];

  const counts: Record<AlertLevel, number> = { red: 0, yellow: 0, watch: 0, ok: 0, low_volume: 0 };
  const base = { today, windows: { current, previous, baseline }, generatedAt: new Date().toISOString() };
  if (numbers.length === 0) return { ...base, numbers: [], counts, dataWarning: "No hay números de Allo asignados a clientes" };

  const clientIds = [...new Set(numberClient.values())];
  const [{ data: clientRows }, alloNumbers] = await Promise.all([
    db.from("clients").select("id, name").in("id", clientIds),
    listAlloNumbers(),
  ]);
  const clientName = new Map<string, string>((clientRows ?? []).map((c: any) => [c.id, c.name]));
  const meta = new Map(alloNumbers.map((n) => [n.number, n]));

  // Una búsqueda por número (paginada) + una consulta de "Conversación" para
  // todos: mismo patrón que Salud Telefónica.
  const [callsByNumber, connectedIds] = await Promise.all([
    Promise.all(numbers.map((n) => searchAlloCalls({ allo_number: n, date_from: from, date_to: end, direction: "OUTBOUND" }))),
    fetchAlloConnectedCallIds({ allo_numbers: numbers, date_from: from, date_to: end }),
  ]);

  let totalDials = 0;
  let totalHuman = 0;
  const seen = new Set<string>();
  const inputs = numbers.map((number, i) => {
    const w = { current: emptyStats(), previous: emptyStats(), baseline: emptyStats() };
    for (const call of callsByNumber[i]) {
      if (call.allo_number !== number || seen.has(call.id)) continue;
      seen.add(call.id);
      const day = callDateKey(call.date);
      const human = resolveConnected(call, connectedIds);
      const voicemail = call.result === "VOICEMAIL";
      const short = !human && call.result === "ANSWERED" && call.duration < SHORT_SECONDS;
      const buckets: WindowStats[] = [];
      if (day >= current[0] && day <= current[1]) buckets.push(w.current);
      if (day >= previous[0] && day <= previous[1]) buckets.push(w.previous);
      if (day >= baseline[0] && day <= baseline[1]) buckets.push(w.baseline);
      for (const b of buckets) {
        b.dials++;
        if (human) b.human++;
        if (voicemail) b.voicemail++;
        if (short) b.short++;
      }
      if (buckets.length) {
        totalDials++;
        if (human) totalHuman++;
      }
    }
    const m = meta.get(number);
    const cid = numberClient.get(number);
    return {
      number,
      name: (m?.name && m.name.trim()) || number,
      client: (cid && clientName.get(cid)) || "Sin cliente",
      country: resolveCountryLabel((m?.country && m.country.trim()) || "Sin país"),
      ...w,
    };
  });

  // Resguardo: si Allo no devolvió ninguna "Conversación" con volumen
  // relevante, es una falla de datos (no que todos los números murieron de
  // golpe). En ese caso se muestran los datos pero NO se envían alertas.
  let dataWarning: string | null = null;
  if (connectedIds === null) {
    dataWarning = "La clasificación de conversaciones de Allo falló; se usó una aproximación por duración.";
  } else if (totalDials >= 200 && totalHuman === 0) {
    dataWarning = `Allo no devolvió ninguna conversación para ${totalDials} llamadas: probable falla de la API. Alertas suspendidas hasta que se normalice.`;
  }

  const health = sortHealth(inputs.map(evaluateNumber));
  for (const h of health) counts[h.level]++;
  return { ...base, numbers: health, counts, dataWarning };
}
