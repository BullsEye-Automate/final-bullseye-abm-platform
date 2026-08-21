import { notFound } from "next/navigation";
import { fetchMe, fetchUserRoles, fetchClients } from "@/lib/peithoBackend";
import AssignRoleForm from "@/components/AssignRoleForm";
import UserRolesList from "@/components/UserRolesList";

// Admin-only — el backend también lo exige (requireAdmin en /admin/user-roles),
// esto es solo para no renderizar la página completa si alguien la teclea a mano.
export default async function AdminUsuariosPage() {
  const me = await fetchMe();
  if (me?.role !== "admin") notFound();

  const [roles, clients] = await Promise.all([fetchUserRoles(), fetchClients()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Administración de usuarios</h1>
        <p className="text-sm text-gray-500 mt-1">
          Asigna acceso a Peitho a un usuario ya creado en Supabase Auth (Supabase Studio → Authentication →
          Users). Un rol "cliente" solo ve sus propias reuniones y su propia base de conocimiento; "admin" ve y
          filtra todo.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Asignar rol</h2>
        <AssignRoleForm clients={clients} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Usuarios con acceso ({roles.length})</h2>
        <UserRolesList roles={roles} />
      </div>
    </div>
  );
}
