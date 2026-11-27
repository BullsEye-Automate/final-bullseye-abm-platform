import Solicitudes from "@/components/acti/Solicitudes";

export default function ActiSolicitudesPage() {
  return (
    <div>
      <h1>Mis solicitudes</h1>
      <p className="acti-lead">El avance de cada empresa que pediste, desde la cola hasta la reunión agendada.</p>
      <Solicitudes />
    </div>
  );
}
