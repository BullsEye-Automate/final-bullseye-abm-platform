import { NextRequest, NextResponse } from "next/server";
import { isBusinessDay } from "@/lib/celulasSdr/calendar";
import { getFlag, loadWeekPlan, planPendingKey, sendDailyAlerts, sendIcpDigest, sendMondayMail, sendWeeklyCostReport, setFlag } from "@/lib/centroProspeccion/intel/automations";
import { PROSPECTORAS } from "@/lib/centroProspeccion/intel/mail";
import { loadProspectoraCalendar } from "@/lib/centroProspeccion/intel/prospectoraDays";
import { chileDate, planningMonday } from "@/lib/centroProspeccion/intel/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (lunes a viernes 11:30 y 12:30 UTC, ver vercel.json): corre
// cuando en Chile son las 8:xx (o las 9:xx si a las 8 no quedó enviado).
// Todos los días hábiles: alertas de prospección y recordatorios de llamadas.
// Los lunes además: plan de la semana a prospectoras y líder + costo de IA (la
// prospectora con feriado en su país lo recibe su siguiente día hábil).
// Todos los días: un solo correo al KAM con los cambios de ICP aprobados en las fichas.
// ?force=1 se salta el chequeo de hora y de "ya enviado"; ?solo=lunes|costo|alertas.

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.get("authorization") ?? "") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  const solo = req.nextUrl.searchParams.get("solo");
  const now = new Date();
  const today = chileDate(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", hour: "numeric", hourCycle: "h23" }).format(now));
  const flag = `centro_alerts_sent:${today}`;
  // Arranque: el equipo se prepara la primera semana; nada sale antes de esta fecha
  const start = process.env.CENTRO_ALERTS_START || "2026-11-16";
  if (!force) {
    if (today < start) return NextResponse.json({ skipped: `los correos parten el ${start}` });
    if (!isBusinessDay(today)) return NextResponse.json({ skipped: "día no hábil" });
    if (hour !== 8 && hour !== 9) return NextResponse.json({ skipped: `hora de Chile ${hour}` });
    if (await getFlag(flag)) return NextResponse.json({ skipped: "ya enviado hoy" });
  }
  const isMonday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
  const out: Record<string, unknown> = { today };
  const step = async (k: string, fn: () => Promise<unknown>) => {
    try { out[k] = await fn(); } catch (e) { out[k] = { error: (e as Error).message }; }
  };
  if (!solo || solo === "alertas") await step("alertas", () => sendDailyAlerts(today));
  const cal = await loadProspectoraCalendar();
  if ((isMonday && !solo) || solo === "lunes") {
    // Quien no trabaja hoy (feriado de su país o ausencia, según config/feriados
    // del Centro) no lo recibe: queda pendiente para su próximo día hábil
    const semana = planningMonday(now);
    const away = PROSPECTORAS.filter((e) => cal.offReason(e, today));
    const here = PROSPECTORAS.filter((e) => !away.includes(e));
    for (const e of away) await setFlag(planPendingKey(semana, e), { desde: today, motivo: cal.offReason(e, today) }, 6);
    await step("lunes", async () => {
      const r = await sendMondayMail({ to: here });
      // Plan aún sin aprobar: se les envía el primer día hábil en que esté aprobado
      if (!r.planAprobado) for (const e of here) await setFlag(planPendingKey(semana, e), { desde: today, motivo: "plan sin aprobar" }, 6);
      return { ...r, noTrabajan: away };
    });
  } else if (!solo) {
    // Otro día de la semana: el plan a quien no lo recibió (feriado / ausencia o
    // porque el lunes el plan aún no estaba aprobado)
    const semana = planningMonday(new Date(now.getTime() - 6 * 86_400_000));
    const week = await loadWeekPlan(semana);
    const late: string[] = [];
    for (const e of PROSPECTORAS) if (!cal.offReason(e, today) && (await getFlag(planPendingKey(semana, e)))) late.push(e);
    if (late.length && week.approved) await step("lunes_atrasado", async () => {
      const r = await sendMondayMail({ to: late, late: true, leader: false });
      for (const e of late) await setFlag(planPendingKey(semana, e), null, 0);
      return r;
    });
  }
  if (!solo || solo === "icp") await step("icp", () => sendIcpDigest());
  if ((isMonday && !solo) || solo === "costo") await step("costo", () => sendWeeklyCostReport());
  if (!solo) await setFlag(flag, out, 3);
  return NextResponse.json(out);
}
