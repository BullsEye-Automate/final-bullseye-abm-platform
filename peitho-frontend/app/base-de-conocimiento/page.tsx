import Link from "next/link";
import { fetchClients } from "@/lib/peithoBackend";
import NewClientForm from "@/components/NewClientForm";

export default async function BaseDeConocimientoPage() {
  const clients = await fetchClients();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Base de conocimiento</h1>
        <p className="text-sm text-gray-500 mt-1">
          Documentación por cliente (ICP, buyer persona, propuesta de valor, casos de éxito, presentaciones) que
          Peitho usa para preparar el research y el análisis de reuniones.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <NewClientForm />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        {clients.length === 0 ? (
          <p className="text-sm text-gray-500 p-6">
            Todavía no hay clientes registrados. Se crean solos cuando una reunión hace match con el excel de metas,
            o puedes agregar uno a mano arriba.
          </p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {clients.map((client) => (
              <li key={client.id}>
                <Link
                  href={`/base-de-conocimiento/${client.id}`}
                  className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition"
                >
                  <span className="text-sm font-medium text-gray-900">{client.name}</span>
                  <span className="text-xs text-gray-500">
                    {client.documentos} {client.documentos === 1 ? "documento" : "documentos"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
