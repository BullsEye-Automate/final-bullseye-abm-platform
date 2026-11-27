import { getPortalUser } from "@/lib/portalAuth";
import PortalShell from "@/components/portal/PortalShell";
import PortalLogoutButton from "@/components/portal/PortalLogoutButton";
import { redirect } from "next/navigation";
import { getActiMember, setUserActiFlag } from "@/lib/acti/server";

export const dynamic = "force-dynamic";

// Layout del portal de clientes. El middleware ya confina a los usuarios
// cliente a /portal; acá además se exige una fila activa en client_users.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getPortalUser();

  if (!user) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-sm text-center bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <div className="text-2xl font-bold tracking-tight mb-3">
            <span style={{ color: "#251762" }}>Bulls</span>
            <span style={{ color: "#62E0D8" }}>Eye</span>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            Tu cuenta no tiene acceso activo al portal. Contacta a tu ejecutivo de BullsEye.
          </p>
          <PortalLogoutButton />
        </div>
      </div>
    );
  }

  // Socio ACTI: su experiencia vive en /acti. Normalmente el middleware ya lo
  // redirige (app_metadata.acti); esto cubre a usuarios creados después de
  // marcar al cliente, a los que se les pone la marca acá.
  if (await getActiMember(user.clientId)) {
    await setUserActiFlag(user.authUserId, true).catch(() => {});
    redirect("/acti");
  }

  return (
    <PortalShell clientName={user.clientName} clientLogoUrl={user.clientLogoUrl} userEmail={user.email}>
      {children}
    </PortalShell>
  );
}
