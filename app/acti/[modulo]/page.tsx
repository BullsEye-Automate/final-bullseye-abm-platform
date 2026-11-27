import Link from "next/link";
import { notFound } from "next/navigation";
import { moduleBySlug } from "@/lib/acti/nav";

// Módulos de la experiencia ACTI que aún no se construyen: cada fase
// reemplaza esta página creando la carpeta del módulo (app/acti/<slug>/).
export default function ActiModulePlaceholder({ params }: { params: { modulo: string } }) {
  const m = moduleBySlug(params.modulo);
  if (!m || !m.slug) notFound();
  return (
    <div>
      <h1>{m.label}</h1>
      <p className="acti-lead">{m.description}</p>
      <div className="acti-card acti-empty">
        <p style={{ margin: "0 0 14px" }}>Este módulo está en preparación y se habilitará pronto.</p>
        <Link href="/acti" className="acti-btn ghost sm">Volver al inicio</Link>
      </div>
    </div>
  );
}
