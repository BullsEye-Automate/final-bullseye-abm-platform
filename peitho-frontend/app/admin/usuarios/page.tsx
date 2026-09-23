import { notFound } from "next/navigation";
import { fetchMe, fetchUserRoles, fetchClients } from "@/lib/peithoBackend";
import UserManagement from "@/components/UserManagement";

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
          Escribe el email y asigna un rol — si la persona todavía no tiene cuenta, se crea sola y le llega un
          correo para que elija su contraseña (no hace falta entrar a Supabase). Un rol "cliente" solo ve sus
          propias reuniones y su propia base de conocimiento (admin cliente, además, el panel de control); "admin"
          ve y filtra todo.
        </p>
      </div>

      <UserManagement clients={clients} roles={roles} />
    </div>
  );
}
