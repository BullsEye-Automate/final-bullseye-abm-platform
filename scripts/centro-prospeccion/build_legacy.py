"""Convierte el HTML del artifact en los 3 archivos del módulo del portal.

Salidas (en components/centroProspeccion/legacy/):
  app.js      lógica original envuelta en mountCentro(ROOT, DEPS)
  markup.ts   marcado original (sin el bloque de marca del menú oscuro)
  base.css    estilos originales con alcance .cp-root (sin modo oscuro)
Cada reemplazo debe ocurrir el número exacto de veces esperado; si no, falla.
"""
import json, re, sys, pathlib

SRC = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
OUT = pathlib.Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)

lines = SRC.split("\n")
# índices (1-based en la inspección): CSS 11..252, markup 255..332, script 334..1519
css_start = lines.index("<style>", 2) + 1           # segundo <style> (el primero es del host)
css_end = lines.index("</style>", css_start)
css = "\n".join(lines[css_start:css_end])
mk_start = lines.index('<div class="app">')
mk_end = next(i for i, l in enumerate(lines) if l.startswith('<div id="toast"'))
markup = "\n".join(lines[mk_start:mk_end + 1])
js_start = lines.index("<script>", mk_end) + 1
js_end = lines.index("</script>", js_start)
js = "\n".join(lines[js_start:js_end])


def rep(text, old, new, count=1):
    n = text.count(old)
    if n != count:
        raise SystemExit(f"Esperaba {count} ocurrencia(s) y hay {n}: {old[:80]!r}")
    return text.replace(old, new)


# ---------------- JS ----------------
head = "(function(){\n'use strict';\n"
assert js.startswith(head), js[:60]
js = js[len(head):]
tail = "boot();\n})();"
assert js.rstrip().endswith(tail), js[-60:]
js = js.rstrip()[: -len(tail)]

# Tema: el portal es solo claro. Se conserva la API interna (curTheme) para
# los gráficos y se oculta el botón.
js = rep(js,
    "function applyTheme(t){if(t)document.documentElement.setAttribute('data-theme',t);paintThemeBtn()}\n"
    "function curTheme(){const a=document.documentElement.getAttribute('data-theme');if(a)return a;return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}\n"
    "function paintThemeBtn(){$('#themeBtn').innerHTML=curTheme()==='dark'?ic('sun'):ic('moon')}\n"
    "$('#themeBtn').addEventListener('click',()=>{const n=curTheme()==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);store.set('cp-theme',n);paintThemeBtn();sched()});\n"
    "applyTheme(store.get('cp-theme'));",
    "/* tema: el portal es solo claro */\n"
    "function curTheme(){return 'light'}\n"
    "$('#themeBtn').hidden=true;")

# Variables de color: se leen del contenedor del módulo, no de <html>.
js = rep(js, "getComputedStyle(document.documentElement)", "getComputedStyle(ROOT)")

# Escuchas globales: se quitan al salir de la página.
js = rep(js, "document.addEventListener(", "onDoc(", 3)

# Scroll: en el portal se desplaza el <main> del layout, no la ventana.
js = rep(js, "window.scrollTo(", "scrollMain(", js.count("window.scrollTo("))

# Chart.js viene como dependencia del módulo.
js = rep(js, "window.Chart", "Chart", 2)

# Capa de datos: el adaptador del portal reemplaza window.claude.
js = rep(js, "const cl=window.claude;", "const cl=DEPS.claude;")

# Archivos: se abren por la API del portal.
js = rep(js, 'href="/_blob/${d.assetId}"', 'href="/api/centro/assets/${d.assetId}"')

# Mensajes que mencionaban claude.ai.
js = rep(js, "Abre la página con tu sesión de claude.ai para guardar.", "No hay conexión con los datos del equipo. Recarga la página para guardar.")
js = rep(js, "<b>Sin conexión a los datos.</b> Abre el enlace con tu sesión de claude.ai.", "<b>Sin conexión a los datos.</b> Recarga la página.")
js = rep(js, "Abre este enlace con tu sesión de claude.ai iniciada con el correo corporativo.", "Recarga la página o vuelve a iniciar sesión en el portal con tu correo corporativo.")
js = rep(js, "Abre la página con tu sesión de claude.ai para crear solicitudes.", "No hay conexión con los datos del equipo. Recarga la página para crear solicitudes.")
js = rep(js, "La descarga no está disponible en esta vista. Abre la página en claude.ai.", "La descarga no está disponible. Recarga la página.")
js = rep(js, "Abre la página con tu sesión de claude.ai para registrar avance.", "No hay conexión con los datos del equipo. Recarga la página para registrar avance.")
js = rep(js, "Disponible al abrir la página con tu sesión de claude.ai.", "Disponible con conexión a los datos del equipo. Recarga la página.")
js = rep(js, "Abre esta página desde claude.ai para ver y guardar los datos del equipo. El cruce de contactos funciona igual.", "No pudimos conectar con los datos del equipo. Recarga la página. El cruce de contactos funciona igual.")
js = rep(js, "No pudimos conectar con los datos del equipo. Inicia sesión en claude.ai con tu correo corporativo y vuelve a abrir el enlace.", "No pudimos conectar con los datos del equipo. Vuelve a iniciar sesión en el portal con tu correo corporativo.")
js = rep(js, "Tienes acceso de solo lectura. Para crear solicitudes o registrar avance, pide a quien te compartió la página que te invite como Editora.", "Tienes acceso de solo lectura. Para crear solicitudes o registrar avance, pide acceso al líder de prospección.")
# Enganches del portal (fase 1, nov-2026): marcadores vacíos que completa
# components/centroProspeccion/portalEnhancer.ts con datos del portal.
#  - data-cp-icp: ICP vigente del portal dentro de la ficha del cliente.
#  - data-cp-auto: lo hecho en Empresas / Contactos / Búsqueda manual por
#    cliente, prospectora y semana (tabla del plan y «Mi semana»).
js = rep(js,
    "Abrir en Google Drive</a></dd>`:''}</dl>`;",
    "Abrir en Google Drive</a></dd>`:''}</dl><div data-cp-icp=\"${esc(id)}\"></div>`;")
js = rep(js,
    '<th>Entregadas</th><th class="l">Estado</th>',
    '<th>Entregadas</th><th class="l">En el portal</th><th class="l">Estado</th>')
js = rep(js,
    "en curso</span>`:'–'}</td>",
    "en curso</span>`:'–'}</td><td class=\"l\" data-cp-auto=\"${esc(r.clienteId)}|${esc(r.email||'')}|${esc(wk)}\"></td>")
js = rep(js,
    '</div></div><div class="mw-b">${btn}',
    "</div><div data-cp-auto=\"${esc(r.clienteId)}|${esc(r.email||'')}|${esc(wk)}\" data-cp-mode=\"row\"></div></div><div class=\"mw-b\">${btn}")

if "claude.ai" in js.replace("https://claude.ai/artifact/FCpkgNaYPL2VTtayWHRhnQ", ""):
    left = [m.start() for m in re.finditer("claude.ai", js)]
    raise SystemExit(f"Quedan menciones a claude.ai: {[js[i-60:i+20] for i in left]}")

charts_decl = "let charts=[];"
assert charts_decl in js

module = (
    "// @ts-nocheck\n"
    "/* eslint-disable */\n"
    "// Centro de prospección BullsEye — lógica original del artifact de claude.ai,\n"
    "// portada al portal sin cambios de comportamiento. Generado por\n"
    "// scripts/centro-prospeccion/build_legacy.py a partir del HTML del artifact;\n"
    "// los únicos cambios son: datos por el adaptador del portal (DEPS.claude en\n"
    "// lugar de window.claude), tema solo claro, escuchas globales que se quitan\n"
    "// al salir, scroll del <main> del portal, archivos por /api/centro/assets,\n"
    "// textos que mencionaban claude.ai y marcadores vacíos (data-cp-icp,\n"
    "// data-cp-auto) que completa portalEnhancer.ts con datos del portal.\n"
    "export function mountCentro(ROOT, DEPS){\n"
    "'use strict';\n"
    "const {Chart,ExcelJS,Papa}=DEPS;\n"
    "const __ac=new AbortController();\n"
    "const onDoc=(t,f)=>document.addEventListener(t,f,{signal:__ac.signal});\n"
    "const scrollMain=(...a)=>{const m=ROOT.closest('main');if(m&&m.scrollTo)m.scrollTo(...a);else window.scrollTo(...a)};\n"
    + js +
    "boot();\n"
    "return function unmount(){__ac.abort();try{charts.forEach(c=>{try{c.destroy()}catch(e){}})}catch(e){}if(DEPS.claude&&DEPS.claude.__stop)DEPS.claude.__stop()};\n"
    "}\n"
)
(OUT / "app.js").write_text(module, encoding="utf-8")

# ---------------- markup ----------------
markup = rep(markup,
    '    <div class="brand">\n      <div class="mark" id="brandMark"></div>\n      <div><b>BullsEye ABM</b><small>Centro de prospección</small></div>\n    </div>\n',
    '    <div class="brand" hidden>\n      <div class="mark" id="brandMark"></div>\n      <div><b>BullsEye ABM</b><small>Centro de prospección</small></div>\n    </div>\n')
(OUT / "markup.ts").write_text(
    "// Marcado original del artifact \"Centro de prospección BullsEye\" (generado).\n"
    "export const CENTRO_MARKUP = " + json.dumps(markup, ensure_ascii=False) + ";\n",
    encoding="utf-8")


# ---------------- CSS ----------------
def split_rules(s):
    """Devuelve [(prelude, body)] de nivel superior."""
    out, i, n = [], 0, len(s)
    while i < n:
        j = s.find("{", i)
        if j < 0:
            break
        prelude = s[i:j].strip()
        depth, k = 1, j + 1
        while depth and k < n:
            if s[k] == "{": depth += 1
            elif s[k] == "}": depth -= 1
            k += 1
        out.append((prelude, s[j + 1:k - 1]))
        i = k
    return out


def strip_comments(s):
    return re.sub(r"/\*.*?\*/", "", s, flags=re.S)


def scope_selector(sel):
    sel = sel.strip()
    if sel in ("html",):
        return None
    if sel == "body":
        return ".cp-root"
    if sel.startswith(":root"):
        return None
    if sel.startswith("*"):
        return ".cp-root " + sel
    return ".cp-root " + sel


def scope(css_text):
    res = []
    for prelude, body in split_rules(strip_comments(css_text)):
        if prelude.startswith("@media"):
            if "prefers-color-scheme" in prelude:
                continue  # modo oscuro: el portal es solo claro
            inner = scope(body)
            if inner.strip():
                res.append(f"{prelude}{{\n{inner}\n}}")
        elif prelude.startswith("@keyframes"):
            res.append(prelude.replace("@keyframes sp", "@keyframes cp-sp") + "{" + body + "}")
        else:
            sels = [scope_selector(x) for x in prelude.split(",")]
            sels = [x for x in sels if x]
            if not sels:
                continue
            body = body.replace("animation:sp ", "animation:cp-sp ")
            res.append(",".join(sels) + "{" + body.strip() + "}")
    return "\n".join(res)


scoped = scope(css)
(OUT / "base.css").write_text(
    "/* Centro de prospección — estilos originales del artifact con alcance .cp-root\n"
    "   (generado; sin modo oscuro). El tema del portal está en theme.css. */\n"
    ".cp-root [hidden]:not([hidden=until-found i]){display:none!important}\n" + scoped + "\n",
    encoding="utf-8")
print("ok", len(module), len(markup), len(scoped))
