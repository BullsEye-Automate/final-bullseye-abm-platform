"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

// Pedido explícito del usuario (14-10-2026, alta masiva de usuarios de
// CChC): hasta ahora la ÚNICA forma de que alguien pusiera su contraseña
// era el link de invitación/recuperación de Supabase (/invitacion) — un
// flujo que ya falló varias veces en producción (links que "vencen" al
// tocarlos desde el navegador integrado de una app de correo, ver el
// incidente real de Erick/Crossnet). Con 11 personas de CChC para dar de
// alta de una, no conviene depender de que ese link funcione para cada una.
// Esta página le da a cualquier usuario YA logueado una forma de poner su
// propia contraseña sin pasar por ningún link — sirve tanto para quien
// recibió una contraseña temporal creada a mano en Supabase Studio (el
// workaround que ya se usó para Erick) como para cualquiera que
// simplemente quiera cambiarla más adelante.
export default function CambiarPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== password2) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabaseBrowser().auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      setError(updateError.message || "No se pudo guardar la contraseña — intenta de nuevo.");
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.push("/reuniones/futuras");
    }, 1200);
  }

  return (
    <div className="max-w-sm">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Cambiar contraseña</h1>
      <p className="text-sm text-gray-500 mb-6">Elegí una contraseña nueva para tu cuenta de Peitho.</p>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        {done ? (
          <p className="text-sm text-gray-500 text-center">Listo, contraseña actualizada…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contraseña nueva</label>
              <input
                type="password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-[#62E0D8]"
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Confirmar contraseña</label>
              <input
                type="password"
                required
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-[#62E0D8]"
                placeholder="••••••••"
              />
            </div>

            {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>}

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition"
              style={{ background: "#251762" }}
            >
              {saving ? "Guardando…" : "Guardar contraseña"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
