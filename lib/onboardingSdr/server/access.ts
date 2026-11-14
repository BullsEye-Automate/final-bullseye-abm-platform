import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { viewerFor, type Viewer } from "./roles";
import type { OnboardingRow } from "./store";
import type { Role } from "../plan";

export const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com";

// Usuario de la sesión con sus roles de edición (null = sin sesión).
export async function currentViewer(): Promise<Viewer | null> {
  const email = await currentUserEmail();
  return email ? viewerFor(email) : null;
}

export const isEditor = (v: Viewer) => v.admin || v.editorRoles.length > 0;

// Con qué roles puede actuar sobre un onboarding: el SDR en el suyo, y las
// editoras (líder, RRHH, habilitadora) en el de cualquiera.
export function rolesOn(v: Viewer, row: OnboardingRow): Role[] {
  if (row.sdr_email === v.email) return ["sdr"];
  return v.editorRoles;
}
