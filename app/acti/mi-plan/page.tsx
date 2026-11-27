import { redirect } from "next/navigation";
import { getActiSession } from "@/lib/acti/server";
import { PLAN_IDS, planFeatures, planPriceLabel } from "@/lib/acti/plans";

export const dynamic = "force-dynamic";

// Mi plan: los cuatro planes lado a lado, con lo que incluye cada uno y el
// plan actual destacado. Todo sale de la configuración editable de planes.
export default async function ActiMiPlanPage() {
  const s = await getActiSession();
  if (!s) redirect("/login");
  const { config, plan: current } = s;
  const iva = config.params.ivaPct;

  return (
    <div className="acti-stack" style={{ gap: 20 }}>
      <div>
        <h1>Mi plan</h1>
        <p className="acti-lead" style={{ marginBottom: 0 }}>
          Estás en el plan <b style={{ fontWeight: 600 }}>{current.name}</b>. Compara lo que incluye cada plan de la Red de Negocios ACTI.
        </p>
      </div>

      <div className="acti-banner">
        <span>
          <b>KAM dedicado desde el plan Crece.</b> En Crece y Acelera un KAM de BullsEye acompaña tu cuenta; en Freemium y Conecta te
          apoya el equipo de BullsEye desde la plataforma.
        </span>
      </div>

      <div className="acti-plans">
        {PLAN_IDS.map((id) => {
          const p = config.plans[id];
          const isCurrent = id === current.id;
          return (
            <section key={id} className="acti-card acti-plan" data-current={isCurrent || undefined} aria-current={isCurrent || undefined}>
              <div className="acti-between">
                <h2 style={{ margin: 0 }}>{p.name}</h2>
                {isCurrent ? <span className="acti-tag ok">Tu plan</span> : p.hasKam ? <span className="acti-tag">Con KAM</span> : null}
              </div>
              <div className="acti-plan-price">{planPriceLabel(p)}</div>
              {p.baseUf > 0 && <div className="acti-tiny acti-muted">Más IVA ({iva}%)</div>}
              <p className="acti-small acti-muted" style={{ margin: "10px 0 12px" }}>{p.description}</p>
              <ul className="acti-features">
                {planFeatures(p, config.params).map((f) => (
                  <li key={f.key} data-off={!f.included || undefined}>
                    <span className="acti-check" aria-hidden="true">{f.included ? "✓" : "–"}</span>
                    <span>
                      <span className="acti-feature-label">{f.label}</span>
                      <span className="acti-tiny acti-muted" style={{ display: "block" }}>{f.value}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="acti-note">
        ¿Quieres cambiar de plan? Escríbele al equipo de BullsEye. Muy pronto podrás solicitar el cambio directamente desde aquí.
        Los cambios de plan no se cobran automáticamente: el equipo de BullsEye los confirma contigo.
      </div>
    </div>
  );
}
