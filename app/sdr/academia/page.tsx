import { redirect } from "next/navigation";

// "Academia SDR" pasó a llamarse "Entrenamiento cliente".
export default function AcademiaRedirect({ searchParams }: { searchParams: { tab?: string } }) {
  redirect(searchParams?.tab ? `/sdr/entrenamiento?tab=${encodeURIComponent(searchParams.tab)}` : "/sdr/entrenamiento");
}
