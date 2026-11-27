import Facturacion from "@/components/acti/Facturacion";

export default function ActiFacturacionPage() {
  return (
    <div>
      <h1>Facturación</h1>
      <p className="acti-lead">Base mensual de tu plan más las reuniones realizadas, más IVA. Las reuniones a las que el prospecto no asiste no se cobran.</p>
      <Facturacion />
    </div>
  );
}
