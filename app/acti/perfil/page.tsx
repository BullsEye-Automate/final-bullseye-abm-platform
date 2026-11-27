import { PerfilEditor } from "@/components/acti/IcpEditors";

export default function ActiPerfilPage() {
  return (
    <div>
      <h1>Mi perfil comercial</h1>
      <p className="acti-lead">
        Lo que el SDR de BullsEye usa para presentarte y lo que Peitho considera al analizar tus reuniones.
      </p>
      <PerfilEditor />
    </div>
  );
}
