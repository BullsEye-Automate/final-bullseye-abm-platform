import { redirect } from "next/navigation";

// La Alerta de feriados ahora es una vista de Células SDR (Operación →
// Alerta de feriados). Este enlace antiguo redirige ahí.
export default function AlertaFeriadosRedirect() {
  redirect("/analisis/celulas-sdr?vista=feriados");
}
