// Puente de la plataforma para el Formulario de reuniones (se inyecta al final
// del HTML de GitHub Pages; ver app/api/sdr/formulario-reunion/route.ts y
// CLAUDE.md → "Formulario de reuniones"). No cambia el envío al Apps Script.
//  1. Deja elegido al SDR de la sesión como responsable.
//  2. No deja registrar (ni mover) una reunión en un feriado nacional del país
//     elegido; los feriados regionales y días de baja actividad avisan y se
//     confirman con un segundo clic.
//  3. Reemplaza el resumen para WhatsApp por el formato enriquecido: se muestra
//     al tiro con los datos del formulario y la plataforma lo completa con IA.
(function () {
  var CFG = window.__BE_FORM || {};
  var HOLIDAYS = CFG.holidays || [];

  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function tom(id) {
    try { return typeof tomInstances !== "undefined" ? tomInstances[id] : null; } catch (e) { return null; }
  }

  // ── 1. SDR de la sesión ────────────────────────────────────────────────
  function pickSdr(ts, want) {
    if (!ts || !ts.options) return;
    var keys = Object.keys(ts.options);
    var w = norm(want), wt = w.split(" "), hit = null;
    keys.forEach(function (k) { if (!hit && norm(k) === w) hit = k; });
    if (!hit) {
      var c = keys.filter(function (k) { var t = norm(k).split(" "); return t[0] === wt[0] && wt.slice(1).some(function (x) { return t.indexOf(x) > 0; }); });
      if (c.length === 1) hit = c[0];
    }
    if (!hit) {
      var f = keys.filter(function (k) { return norm(k).split(" ")[0] === wt[0]; });
      if (f.length === 1) hit = f[0];
    }
    if (hit && !ts.getValue()) ts.setValue(hit);
  }
  if (CFG.sdrName) {
    var tries = 0, iv = setInterval(function () {
      tries++;
      var s = tom("s-sdr");
      if (s && Object.keys(s.options).length) {
        pickSdr(s, CFG.sdrName);
        pickSdr(tom("edit-sdr-select"), CFG.sdrName);
        clearInterval(iv);
      }
      if (tries > 120) clearInterval(iv);
    }, 250);
  }

  // ── 2. Feriados ────────────────────────────────────────────────────────
  // "25/11/2026" → "2026-11-25"
  function isoOf(dmy) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dmy || "").trim());
    return m ? m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2) : null;
  }
  // Feriado más importante de ese día en ese país (nacional > regional > baja).
  var RANK = { national: 3, regional: 2, low: 1 };
  function holidayOn(dmy, country) {
    var iso = isoOf(dmy), c = norm(country);
    if (!iso || !c) return null;
    var best = null;
    HOLIDAYS.forEach(function (h) {
      if (h.d === iso && norm(h.c) === c && (!best || RANK[h.k] > RANK[best.k])) best = h;
    });
    return best;
  }
  function holidayText(h, dmy) {
    if (h.k === "national") return "⛔ El " + dmy + " es feriado en " + h.c + " (" + h.n + "). Elige otro día para la reunión.";
    if (h.k === "regional") return "⚠️ El " + dmy + " es feriado regional en " + h.c + " (" + h.n + (h.r ? ": " + h.r : "") + "). Revisa que la empresa no esté en esa zona.";
    return "⚠️ El " + dmy + " es un día de baja actividad en " + h.c + " (" + h.n + ").";
  }

  // Aviso bajo "Fecha de la Reunión" en el registro nuevo.
  var note = document.createElement("div");
  note.id = "be-holiday-note";
  note.style.cssText = "display:none;margin-top:6px;font-size:12.5px;line-height:1.4;border-radius:8px;padding:8px 10px;";
  var fpInput = document.getElementById("fp-reunion");
  var fpField = fpInput && fpInput.closest(".field");
  if (fpField) fpField.appendChild(note);

  function currentCountry() {
    var t = tom("s-pais");
    return t ? t.getValue() : (document.getElementById("s-pais") || {}).value;
  }
  var confirmedKey = null; // feriado regional / baja ya avisado (segundo clic = registrar)
  function refreshNote() {
    var dmy = fpInput ? fpInput.value : "";
    var h = holidayOn(dmy, currentCountry());
    confirmedKey = null;
    if (!h) { note.style.display = "none"; return; }
    note.textContent = holidayText(h, dmy);
    var block = h.k === "national";
    note.style.display = "block";
    note.style.background = block ? "rgba(239,68,68,.12)" : "rgba(245,158,11,.12)";
    note.style.border = "1px solid " + (block ? "rgba(239,68,68,.5)" : "rgba(245,158,11,.5)");
    note.style.color = block ? "#fca5a5" : "#fcd34d";
  }
  document.addEventListener("change", function (e) {
    var id = e.target && e.target.id;
    if (id === "fp-reunion" || id === "s-pais") refreshNote();
  });
  if (fpInput) fpInput.addEventListener("input", refreshNote);

  // Validación del registro nuevo: la del formulario + feriados.
  var origValidate = window.validate;
  window.validate = function () {
    var ok = origValidate();
    if (!ok) return false;
    var dmy = fpInput ? fpInput.value : "";
    var h = holidayOn(dmy, currentCountry());
    if (!h) return true;
    refreshNote();
    var key = dmy + "|" + norm(currentCountry());
    if (h.k === "national") {
      note.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast("toast", "fail", holidayText(h, dmy));
      return false;
    }
    if (confirmedKey === key) return true;
    confirmedKey = key;
    showToast("toast", "fail", holidayText(h, dmy) + " Si está correcto, presiona Registrar de nuevo.");
    return false;
  };

  // Actualizar reunión: no se puede mover a un feriado nacional.
  var origUpdate = window.updateMeeting;
  window.updateMeeting = function (idx, rowNum) {
    var input = document.getElementById("fp-edit-" + idx);
    var status = document.getElementById("ust-" + idx);
    var meeting = (typeof allMeetings !== "undefined" ? allMeetings : []).find(function (m) { return m.row === rowNum; });
    var h = input && meeting ? holidayOn(input.value, meeting.pais) : null;
    if (h && h.k === "national") {
      if (status) { status.textContent = holidayText(h, input.value); status.className = "update-status fail"; }
      return;
    }
    return origUpdate(idx, rowNum);
  };

  // ── 3. Resumen para WhatsApp ──────────────────────────────────────────
  function horaLabel(h) {
    var p = String(h || "").split(":").map(Number);
    if (isNaN(p[0])) return h || "";
    var suf = p[0] < 12 ? "AM" : "PM";
    var h12 = p[0] > 12 ? p[0] - 12 : p[0] === 0 ? 12 : p[0];
    return ("0" + h12).slice(-2) + ":" + ("0" + (p[1] || 0)).slice(-2) + " " + suf;
  }
  // Teléfono legible: Chile +56 9 XXXX XXXX; el resto como venga.
  function phoneLabel(t) {
    var raw = String(t || "").trim();
    var d = raw.replace(/\D/g, "");
    if (/^569\d{8}$/.test(d)) return "+56 9 " + d.slice(3, 7) + " " + d.slice(7);
    if (/^9\d{8}$/.test(d) && norm(lastData && lastData.pais) === "chile") return "+56 9 " + d.slice(1, 5) + " " + d.slice(5);
    return raw;
  }

  var lastData = null, lastAi = null, reqId = 0;
  function compose(data, ai) {
    ai = ai || {};
    var L = ["🎯 Nueva reunión agendada!!", ""];
    L.push("🏢 " + (ai.empresa || data.empresa || "-"));
    if (ai.giro) L.push("🏦 " + ai.giro);
    L.push("🌎 " + (data.pais || "-"));
    L.push("");
    L.push("👤 " + (ai.contacto || data.contactos || "-"));
    L.push("💼 " + (ai.cargo || data.cargo || "-"));
    if (ai.rol) L.push("🎚️ Rol: " + ai.rol);
    if (data.correo && data.correo.trim()) L.push("📧 " + data.correo.trim());
    if (data.telefono && data.telefono.trim()) L.push("📞 " + phoneLabel(data.telefono));
    L.push("");
    var when = data.fecha_reunion || "-";
    if (data.hora) when += " — " + horaLabel(data.hora) + (data.pais ? " (hora " + data.pais + ")" : "");
    L.push("📅 " + when);
    if (data.origen) L.push("📲 Canal: " + data.origen);
    var ctx = ai.contexto_llamada || (data.comentario || "").trim();
    if (ctx) { L.push(""); L.push("💬 Contexto de la llamada:"); L.push(ctx); }
    if (ai.interes) { L.push(""); L.push("🔥 Nivel de interés: " + ai.interes); }
    if (ai.contexto_cuenta && ai.contexto_cuenta.length) {
      L.push(""); L.push("📡 Contexto de la cuenta:");
      ai.contexto_cuenta.forEach(function (b) { L.push("• " + b); });
    }
    return L.join("\n");
  }

  // Línea de estado de la IA, sobre el resumen.
  var aiStatus = document.createElement("div");
  aiStatus.style.cssText = "margin:0 0 10px;font-size:12.5px;line-height:1.4;";
  var box = document.getElementById("summary-box");
  if (box && box.parentNode) box.parentNode.insertBefore(aiStatus, box);
  function setStatus(kind, text) {
    aiStatus.textContent = text;
    aiStatus.style.color = kind === "ok" ? "#6ee7b7" : kind === "fail" ? "#fcd34d" : "#7dd3fc";
  }

  var origShowSummary = window.showSummary;
  window.showSummary = function (data) {
    origShowSummary(data);
    lastData = data; lastAi = null;
    var id = ++reqId;
    document.getElementById("summary-box").textContent = compose(data);
    if (!window.parent || window.parent === window) return;
    setStatus("wait", "✨ Completando con IA: rubro de la empresa, rol del contacto y contexto de la cuenta (≈30 s). Ya puedes copiar la versión básica.");
    // Al parent no viajan el correo ni el teléfono del prospecto.
    window.parent.postMessage({
      type: "be-form:summary", id: id,
      data: {
        cliente: data.cliente, empresa: data.empresa, pais: data.pais, contacto: data.contactos,
        cargo: data.cargo, origen: data.origen, industria: data.industria, comentario: data.comentario,
        fecha_reunion: data.fecha_reunion,
      },
    }, "*");
  };

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var m = e.data || {};
    if (m.type !== "be-form:summary-result" || m.id !== reqId || !lastData) return;
    if (m.ai) {
      lastAi = m.ai;
      document.getElementById("summary-box").textContent = compose(lastData, lastAi);
      setStatus("ok", "✅ Resumen completado con IA. Revísalo antes de enviarlo al cliente.");
    } else {
      setStatus("fail", "⚠️ No se pudo completar con IA (" + (m.error || "error") + "). Se muestra el resumen con los datos del formulario.");
    }
  });

  // "Registrar otra" limpia el estado.
  var origReset = window.resetForm;
  window.resetForm = function () {
    reqId++; lastData = null; lastAi = null; setStatus("", "");
    note.style.display = "none"; confirmedKey = null;
    return origReset();
  };
})();
