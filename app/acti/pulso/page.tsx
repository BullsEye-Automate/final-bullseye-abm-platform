import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiSession } from "@/lib/acti/server";
import { canSeePulsoView, PULSO_VIEW_OPTIONS } from "@/lib/acti/plans";

// Pulso ABM para socios ACTI: las vistas dependen del plan (configuración
// editable). El informe se conecta en una fase siguiente; por ahora solo
// se valida el acceso por plan.
export default async function ActiPulsoPage({ searchParams }: { searchParams: { vista?: string } }) {
  const s = await getActiSession();
  if (!s) redirect("/acti");
  const view = PULSO_VIEW_OPTIONS.find((v) => v.slug === searchParams.vista);
  if (!view || !canSeePulsoView(s.plan, view.slug)) redirect("/acti");
  return (
    <div>
      <h1>{view.label}</h1>
      <p className="acti-lead">Pulso ABM · el informe de tu cuenta.</p>
      <div className="acti-card acti-empty">
        <p style={{ margin: "0 0 14px" }}>Esta vista de Pulso ABM se habilitará pronto para tu plan.</p>
        <Link href="/acti" className="acti-btn ghost sm">Volver al inicio</Link>
      </div>
    </div>
  );
}
