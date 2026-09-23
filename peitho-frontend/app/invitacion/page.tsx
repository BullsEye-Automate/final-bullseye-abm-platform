"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

// Página pública (ver PUBLIC_PAGE_PREFIXES en middleware.ts) — a la que
// Supabase redirige el link del correo de invitación/recuperación cuando un
// admin da de alta o le devuelve el acceso a un usuario desde
// /admin/usuarios (23-09-2026).
//
// Bug real encontrado probando esto con el usuario (confirmado leyendo el
// código fuente de @supabase/auth-js, no adivinado): supabaseBrowser()
// (createBrowserClient de @supabase/ssr) fuerza flowType:'pkce' SIEMPRE, sin
// forma de desactivarlo. inviteUserByEmail()/resetPasswordForEmail() del
// lado admin NUNCA usan PKCE (Supabase lo documenta explícito — el navegador
// que dispara la invitación no es el mismo que la acepta) — mandan los
// tokens directo en el fragmento de la URL (#access_token=...), el flujo
// "implicit" de siempre. Cuando detectSessionInUrl de un cliente en modo
// pkce se encuentra con una URL de tipo implicit, _getSessionFromURL() TIRA
// AuthPKCEGrantCodeExchangeError('Not a valid PKCE flow url.') en vez de
// procesarla — silencioso (no rompe la página), pero nunca abre sesión, así
// que el timeout de abajo terminaba mostrando "link inválido" con un link
// perfectamente válido. Fix: parsear el fragmento a mano acá y pasarle los
// tokens directo a setSession() (esa función no mira flowType en absoluto).
export default function InvitacionPage() {
  const [status, setStatus] = useState<"loading" | "ready" | "invalid">("loading");
  const [invalidReason, setInvalidReason] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Cuando el link de invitación/recuperación ya fue consumido o venció,
    // Supabase no manda tokens — redirige acá con el motivo en query params
    // (?error=access_denied&error_code=otp_expired&error_description=...).
    const searchParams = new URLSearchParams(window.location.search);
    const errorCode = searchParams.get("error_code");
    const errorDescription = searchParams.get("error_description");
    if (errorCode || searchParams.get("error")) {
      setInvalidReason(
        errorCode === "otp_expired"
          ? "El link ya fue usado o venció."
          : errorDescription
            ? decodeURIComponent(errorDescription.replace(/\+/g, " "))
            : `Error: ${errorCode}`
      );
      setStatus("invalid");
      return;
    }

    // Éxito: los tokens vienen en el FRAGMENTO (#access_token=...), no en
    // query params — nunca llegan al servidor, solo se leen acá en el
    // navegador.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    if (!accessToken || !refreshToken) {
      setStatus("invalid");
      return;
    }

    // Se limpia el hash de la URL apenas se leen los tokens — no hace falta
    // dejarlos visibles/copiables en la barra de direcciones ni en el
    // historial del navegador más tiempo del necesario.
    window.history.replaceState(null, "", window.location.pathname);

    supabaseBrowser()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          console.error("Error estableciendo la sesión desde /invitacion", sessionError);
          setStatus("invalid");
          return;
        }
        setStatus("ready");
      });
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
