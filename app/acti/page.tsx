import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { getActiSession } from "@/lib/acti/server";
import { loadActiHome, type ActiHome } from "@/lib/acti/home";

export const dynamic = "force-dynamic";

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

const TRIAL_REASON: Record<string, string> = {
  meetings: "Ya tuviste las reuniones de tu prueba.",
  companies: "Ya pediste todas las empresas de tu prueba.",
  expired: "Terminó la ventana de 90 días de tu prueba.",
};

// Inicio del socio ACTI: estado del plan, próximas reuniones, feedback
// pendiente, próximo evento y novedades.
export default async function ActiHomePage() {
  const s = await getActiSession();
  if (!s) redirect("/login");
  const home = await loadActiHome(supabaseAdmin(), s.user.clientId, s.member, s.plan, s.config);
  const firstName = s.user.fullName?.split(/\s+/)[0];

  return (
    <div className="acti-stack" style={{ gap: 20 }}>
      <div>
        <h1>Hola{firstName ? `, ${firstName}` : ""}</h1>
        <p className="acti-lead" style={{ marginBottom: 0 }}>
          {home.isTrial
            ? "Estás en la prueba Freemium de la Red de Negocios ACTI."
            : `Tu plan ${home.planName} garantiza ${home.month.goal} reuniones al mes.`}
        </p>
      </div>

      {home.isTrial && home.trial ? <TrialBlock home={home} /> : <MonthBlock home={home} />}

      <div className="acti-grid2">
        <section className="acti-card">
          <div className="acti-between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Próximas reuniones</h2>
            <Link href="/acti/reuniones" className="acti-tiny acti-muted">Ver todas</Link>
          </div>
          {home.upcoming.length === 0 ? (
            <div className="acti-empty">Aún no tienes reuniones agendadas.</div>
          ) : (
            <ul className="acti-list">
              {home.upcoming.map((m) => (
                <li key={m.id}>
                  <div className="acti-between">
                    <h3 style={{ margin: 0 }}>{m.company}</h3>
                    <span className="acti-tag">{fmtDate(m.date)}{m.time ? ` · ${m.time}` : ""}</span>
                  </div>
                  <div className="acti-small acti-muted">
                    {[m.contactName, m.contactTitle].filter(Boolean).join(" · ") || "Contacto por confirmar"}
                  </div>
                  {(m.contactEmail || m.contactPhone) && (
                    <div className="acti-tiny acti-muted">{[m.contactEmail, m.contactPhone].filter(Boolean).join(" · ")}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="acti-card">
          <div className="acti-between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Feedback pendiente</h2>
            {home.pendingFeedback.length > 0 && <span className="acti-tag warn">{home.pendingFeedback.length}</span>}
          </div>
          {home.pendingFeedback.length === 0 ? (
            <div className="acti-empty">No tienes feedback pendiente.</div>
          ) : (
            <>
              <p className="acti-small acti-muted" style={{ marginTop: 0 }}>
                Cuéntanos cómo te fue: tu feedback mejora las próximas recomendaciones.
              </p>
              <ul className="acti-list">
                {home.pendingFeedback.map((m) => (
                  <li key={m.id} className="acti-between">
                    <span>
                      <b style={{ fontWeight: 600 }}>{m.company}</b>
                      <span className="acti-small acti-muted">{m.contactTitle ? ` · ${m.contactTitle}` : ""}</span>
                    </span>
                    <span className="acti-tiny acti-muted">{fmtDate(m.date)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="acti-card">
          <h2>Próximo evento ACTI</h2>
          <div className="acti-empty">El calendario de eventos y networking de ACTI llega pronto.</div>
        </section>

        <section className="acti-card">
          <h2>Novedades</h2>
          <div className="acti-note">
            Bienvenido a la Red de Negocios ACTI. Elige las empresas y los cargos con los que quieres reunirte; BullsEye las
            prospecta, agenda las reuniones y Peitho analiza cada una.
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ v, l, b }: { v: React.ReactNode; l: string; b?: string }) {
  return (
    <div className="acti-card acti-stat">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
      {b && <div className="b">{b}</div>}
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return <div className="acti-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
}

function MonthBlock({ home }: { home: ActiHome }) {
  const m = home.month;
  return (
    <>
      <section className="acti-card">
        <div className="acti-between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Reuniones del mes</h2>
          <span className="acti-small acti-muted">
            <b style={{ fontWeight: 700, color: "var(--a-ink)" }}>{m.done}</b> de {m.goal} garantizadas
          </span>
        </div>
        <Bar pct={m.pct} />
      </section>
      <div className="acti-grid4">
        <Stat v={m.done} l="Reuniones realizadas" b={`Meta del mes: ${m.goal}`} />
        <Stat v={m.scheduled} l="Agendadas por realizar" b="Este mes" />
        <Stat v={`${m.companiesRequested} / ${m.companyQuota}`} l="Empresas pedidas" b="Cupo del mes para cumplir la garantía" />
        <Stat v={m.noShows} l="No asistió el prospecto" b="No se cobran" />
      </div>
    </>
  );
}

function TrialBlock({ home }: { home: ActiHome }) {
  const t = home.trial!;
  return (
    <>
      {t.completed ? (
        <div className="acti-banner warn">
          <span>
            <b>Completaste tu prueba.</b> {TRIAL_REASON[t.reason ?? ""] ?? ""} Para seguir pidiendo empresas y reuniones, pasa a un plan pagado.
          </span>
          <Link href="/acti/mi-plan" className="acti-btn sm">Ver planes</Link>
        </div>
      ) : (
        <div className="acti-banner">
          <span>
            Tu prueba incluye hasta <b>{t.companiesLimit} empresas</b> o <b>{t.meetingsLimit} reuniones</b>, lo que ocurra primero.
            Te quedan <b>{t.daysLeft} días</b>.
          </span>
          <Link href="/acti/mi-plan" className="acti-btn ghost sm">Conocer los planes</Link>
        </div>
      )}
      <div className="acti-grid4">
        <Stat v={`${t.meetingsUsed} / ${t.meetingsLimit}`} l="Reuniones de la prueba" />
        <Stat v={`${t.companiesUsed} / ${t.companiesLimit}`} l="Empresas pedidas" />
        <Stat v={t.daysLeft} l="Días restantes" b={`Hasta el ${fmtDate(t.end)}`} />
        <Stat v={home.upcoming.length} l="Próximas reuniones" />
      </div>
    </>
  );
}
