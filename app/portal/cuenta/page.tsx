"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

// Cambio de contraseña: el equipo BullsEye entrega una contraseña temporal
// al crear el acceso, y el cliente la cambia acá.
export default function PortalAccountPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setMsg({ ok: false, text: "Usa al menos 10 caracteres." });
    if (password !== confirm) return setMsg({ ok: false, text: "Las contraseñas no coinciden." });
    setSaving(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setSaving(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setPassword("");
    setConfirm("");
    setMsg({ ok: true, text: "Contraseña actualizada." });
  }

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold mb-6" style={{ color: "#251762" }}>Mi cuenta</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-medium text-sm" style={{ color: "#251762" }}>Cambiar contraseña</h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Nueva contraseña"
          autoComplete="new-password"
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-[#62E0D8]"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repite la contraseña"
          autoComplete="new-password"
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-[#62E0D8]"
        />
        {msg && (
          <div className={`text-sm px-4 py-3 rounded-xl ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>
        )}
        <button
          type="submit"
          disabled={saving || !password}
          className="w-full py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
          style={{ background: "#251762" }}
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </form>
    </div>
  );
}
