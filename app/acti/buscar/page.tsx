import BuscarCuentas from "@/components/acti/BuscarCuentas";

export default function ActiBuscarPage() {
  return (
    <div>
      <h1>Buscar cuentas</h1>
      <p className="acti-lead">
        Elige las empresas y los tipos de cargo con los que quieres reunirte. BullsEye identifica a la persona adecuada y agenda
        la reunión: nunca verás nombres antes de que se agende.
      </p>
      <BuscarCuentas />
    </div>
  );
}
