"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

// Página pública (ver PUBLIC_PAGE_PREFIXES en middleware.ts) — a la que
// Supabase redirige el link del correo de invitación cuando un admin da de
// alta a un usuario nuevo desde /admin/usuarios (23-09-2026). El link trae
// los tokens de sesión en el fragmento de la URL (#access_token=...) — el
// cliente de Supabase (createBrowserClient, detectSessionInUrl por default)
// los detecta solo apenas carga la página y abre sesión; acá solo falta
// pedirle al usuario que elija una contraseña para poder volver a entrar
// después sin depender de un link nuevo cada vez.
export default function InvitacionPage() {
  const [status, setStatus] = useState<"loading" | "ready" | "invalid">("loading");
  const [invalidReason, setInvalidReason] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Cuando el link de invitación ya fue consumido o venció, Supabase no
    // manda tokens — redirige acá con el motivo en query params
    // (?error=access_denied&error_code=otp_expired&error_description=...).
    // Se revisa esto de entrada, sin esperar el timeout de abajo, para poder
    // mostrar la razón real en vez de un genérico "no es válido".
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("error_code");
    const errorDescription = params.get("error_description");
    if (errorCode || params.get("error")) {
      setInvalidReason(
        errorCode === "otp_expired"
          ? "El link ya fue usado o venció — a veces el filtro de seguridad del correo " +
              "\"abre\" el link automático antes de que la persona lo haga a mano, dejándolo gastado."
          : errorDescription
            ? decodeURIComponent(errorDescription.replace(/\+/g, " "))
            : `Error: ${errorCode}`
      );
      setStatus("invalid");
      return;
    }

    const supabase = supabaseBrowser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setStatus("ready");
    });

    // Por si el evento ya disparó antes de montar el listener de arriba.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStatus("ready");
    });

    // El link puede haber vencido o ya haberse usado — sin sesión después de
    // unos segundos, es un link inválido, no un problema de timing.
    const timeout = setTimeout(() => {
      setStatus((current) => (current === "loading" ? "invalid" : current));
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

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
      setError("No se pudo guardar la contraseña — intenta de nuevo.");
      return;
    }
    setDone(true);
    setTimeout(() => {
      window.location.href = "/reuniones/futuras";
    }, 1200);
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-peitho-transparent.png" alt="Peitho" className="h-28 mx-auto" />
          <p className="text-sm text-gray-500 -mt-2">Activa tu acceso a Peitho</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          {status === "loading" && <p className="text-sm text-gray-500 text-center">Verificando tu invitación…</p>}

          {status === "invalid" && (
            <p className="text-sm text-gray-500 text-center">
              {invalidReason ?? "Este link no es válido o ya venció."} Pide a un administrador que te reenvíe la
              invitación desde Peitho.
            </p>
          )}

          {status === "ready" && !done && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Elige una contraseña</label>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Confírmala</label>
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
                {saving ? "Guardando…" : "Activar mi cuenta"}
              </button>
            </form>
          )}

          {done && <p className="text-sm text-gray-500 text-center">Listo, entrando a Peitho…</p>}
        </div>
      </div>
    </div>
  );
}
