import { IcpEditor } from "@/components/acti/IcpEditors";

export default function ActiIcpPage() {
  return (
    <div>
      <h1>Mi ICP</h1>
      <p className="acti-lead">
        Tu cliente ideal y tus buyer personas. Es el mismo ICP con que BullsEye prospecta para ti: lo que cambies aquí se usa en
        las recomendaciones de empresas, el fit y la búsqueda de contactos.
      </p>
      <IcpEditor />
    </div>
  );
}
