// Página pública (ver middleware.ts) — requerida por Google Auth Platform
// para poder publicar la app de OAuth ("Información de la marca" → URL de
// política de privacidad). Describe en términos simples qué datos de Google
// usa Peitho y para qué, nada más — no es una política legal exhaustiva.
export default function PrivacidadPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 text-sm text-gray-700 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Política de privacidad de Peitho</h1>
        <p className="mt-1 text-gray-500">Última actualización: septiembre de 2026</p>
      </div>

      <p>
        Peitho es una herramienta interna de BullsEye ABM para la preparación y el análisis de
        reuniones comerciales. Esta página describe qué datos de Google Workspace utiliza y
        para qué.
      </p>

      <section className="space-y-2">
        <h2 className="font-medium text-gray-900">Qué datos de Google usa Peitho</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Google Calendar (solo lectura):</strong> para detectar reuniones agendadas y
            extraer el enlace de la videollamada, los asistentes y el horario.
          </li>
          <li>
            <strong>Google Sheets (solo lectura):</strong> para leer el registro interno de
            reuniones y clientes de BullsEye, y así enriquecer cada reunión con el nombre,
            cargo y empresa del contacto.
          </li>
          <li>
            <strong>Envío de correo (Gmail):</strong> únicamente para notificaciones internas de
            operación de Peitho (por ejemplo, avisar si una conexión de Google deja de
            funcionar).
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium text-gray-900">Cómo se usan estos datos</h2>
        <p>
          Los datos se usan exclusivamente para operar Peitho: agendar la grabación de una
          reunión, generar un brief de preparación y un análisis post-reunión, y enriquecer esa
          información con datos internos de BullsEye. No se venden ni se comparten con terceros
          fuera de los proveedores estrictamente necesarios para operar el producto (por ejemplo,
          transcripción y análisis con IA de la reunión ya grabada).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium text-gray-900">Acceso y cuentas conectadas</h2>
        <p>
          Solo cuentas de Google autorizadas explícitamente por BullsEye (ejecutivos del equipo y
          la cuenta operativa de Peitho) están conectadas a esta app. Cualquier cuenta puede
          revocar el acceso en cualquier momento desde{" "}
          <a
            href="https://myaccount.google.com/permissions"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            myaccount.google.com/permissions
          </a>
          .
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium text-gray-900">Contacto</h2>
        <p>
          Preguntas sobre esta política:{" "}
          <a href="mailto:jkarmy@bullseye-abm.com" className="underline">
            jkarmy@bullseye-abm.com
          </a>
          .
        </p>
      </section>
    </div>
  );
}
