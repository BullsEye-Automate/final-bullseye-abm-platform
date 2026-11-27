import { Suspense } from "react";
import "@/components/acti/acti.css";
import ActiShell from "@/components/acti/ActiShell";
import PortalLogoutButton from "@/components/portal/PortalLogoutButton";
import { getActiSession } from "@/lib/acti/server";

export const dynamic = "force-dynamic";

// Experiencia ACTI · Red de Negocios (socios ACTI). El middleware deja entrar
// aquí solo a usuarios del portal con la marca ACTI; además se exige que el
// cliente de la sesión tenga fila en acti_members.
export default async function ActiLayout({ children }: { children: React.ReactNode }) {
  const s = await getActiSession();

  return (
    <div className="acti-root">
      {/* Montserrat solo para la experiencia ACTI */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet" />
      {s ? (
        <Suspense>
          <ActiShell
            clientName={s.user.clientName}
            userEmail={s.user.email}
            planName={s.plan.name}
            pulsoViews={s.plan.pulsoViews}
          >
            {children}
          </ActiShell>
        </Suspense>
      ) : (
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
          <div className="acti-card" style={{ maxWidth: 420, textAlign: "center" }}>
            <h1>ACTI · Red de Negocios</h1>
            <p className="acti-muted acti-small" style={{ margin: "8px 0 18px" }}>
              Tu cuenta no tiene acceso activo a la Red de Negocios ACTI. Contacta a tu ejecutivo de BullsEye.
            </p>
            <PortalLogoutButton className="acti-btn" />
          </div>
        </div>
      )}
    </div>
  );
}
