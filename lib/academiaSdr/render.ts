import type { AcademyModule, Block } from "./types";

// Render de la Academia SDR como un HTML autocontenido (CSS y JS dentro),
// con la identidad BullsEye y la metáfora Fórmula 1: módulos = "vueltas",
// pestañas y semáforo de avance (localStorage con try/catch). Se usa en la
// vista previa (iframe) y en la descarga. Todo dato pasa por esc().

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const h3 = (t?: string) => (t ? `<h3>${esc(t)}</h3>` : "");
const ROLE_LABEL = { decide: "Decide", influye: "Influye", no_decide: "No decide" } as const;

function renderBlock(b: Block, key: string): string {
  switch (b.type) {
    case "text":
      return `<section class="blk">${h3(b.heading)}${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</section>`;
    case "bullets":
      return `<section class="blk">${h3(b.heading)}<ul class="bul">${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></section>`;
    case "questions":
      return `<section class="blk">${h3(b.heading)}<ol class="qs">${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ol></section>`;
    case "callout":
      return `<aside class="callout ${esc(b.tone ?? "info")}">${b.heading ? `<strong>${esc(b.heading)}</strong>` : ""}<p>${esc(b.text)}</p></aside>`;
    case "concepts":
      return `<section class="blk">${h3(b.heading)}<div class="concepts">${b.items
        .map((i) => `<div class="concept"><div class="term">${esc(i.term)}</div><div><span class="lbl">En simple:</span> ${esc(i.simple)}</div><div><span class="lbl">Por qué te importa:</span> ${esc(i.why)}</div></div>`)
        .join("")}</div></section>`;
    case "facts":
      return `<section class="blk">${h3(b.heading)}<div class="facts">${b.items
        .map((i) => `<div class="fact"><div class="fv">${esc(i.value)}</div><div class="fl">${esc(i.label)}</div></div>`)
        .join("")}</div></section>`;
    case "story":
      return `<section class="blk">${h3(b.heading)}<div class="story">
        <div class="st st1"><span>Problema</span><p>${esc(b.problem)}</p></div>
        <div class="st st2"><span>Solución</span><p>${esc(b.solution)}</p></div>
        <div class="st st3"><span>Resultado</span><p>${esc(b.result)}</p></div>
      </div>${b.analogy ? `<aside class="callout tip"><strong>Piénsalo así</strong><p>${esc(b.analogy)}</p></aside>` : ""}</section>`;
    case "services": {
      if (!b.services.length) return "";
      const first = Math.max(0, b.services.findIndex((x) => x.focus));
      return `<section class="blk">${h3(b.heading || "Elige un servicio")}<div class="svc" data-svc>
        <div class="svc-list">${b.services
          .map((x, i) => `<button type="button" class="chip${i === first ? " on" : ""}" data-i="${i}">${esc(x.name)}${x.focus ? ' <em class="focus">Foco</em>' : ""}</button>`)
          .join("")}</div>
        ${b.services
          .map(
            (x, i) => `<div class="svc-card${i === first ? " on" : ""}" data-i="${i}">
              <h4>${esc(x.name)}</h4>
              <div class="row"><span class="lbl">Piénsalo como…</span><p>${esc(x.analogy)}</p></div>
              <div class="row"><span class="lbl">Qué significa en la empresa</span><p>${esc(x.meaning)}</p></div>
              <div class="row"><span class="lbl">Ejemplo</span><p>${esc(x.example)}</p></div>
            </div>`
          )
          .join("")}
      </div></section>`;
    }
    case "steps":
      return `<section class="blk">${h3(b.heading)}<ol class="steps">${b.steps
        .map((x) => `<li><strong>${esc(x.title)}</strong><p>${esc(x.detail)}</p></li>`)
        .join("")}</ol></section>`;
    case "glossary":
      return `<section class="blk">${h3(b.heading || "Diccionario")}<p class="hint">Toca una tarjeta para darla vuelta.</p><div class="flips">${b.items
        .map(
          (i) => `<button type="button" class="flip" data-flip><span class="face front"><span class="term">${esc(i.term)}</span></span><span class="face back"><span><span class="lbl">En simple:</span> ${esc(i.simple)}</span><span><span class="lbl">Por qué te importa:</span> ${esc(i.why)}</span></span></button>`
        )
        .join("")}</div></section>`;
    case "roles":
      return `<section class="blk">${h3(b.heading || "Quién decide")}<div class="roles">${b.roles
        .map((r) => `<div class="role ${r.kind}"><span class="badge">${ROLE_LABEL[r.kind]}</span><div class="term">${esc(r.role)}</div><p>${esc(r.cares)}</p></div>`)
        .join("")}</div></section>`;
    case "needs":
      return `<section class="blk">${h3(b.heading)}<div class="needs">${b.needs
        .map(
          (n) => `<div class="need"><div class="term">${esc(n.segment)}</div><p>${esc(n.problem)}</p>${n.phrases.length ? `<div class="lbl">Frases que puedes usar</div><ul class="quotes">${n.phrases.map((p) => `<li>“${esc(p)}”</li>`).join("")}</ul>` : ""}</div>`
        )
        .join("")}</div></section>`;
    case "cases": {
      if (!b.cases.length) return "";
      const industries = Array.from(new Set(b.cases.map((c) => c.industry || "General")));
      return `<section class="blk">${h3(b.heading || "¿Qué caso uso?")}<div data-cases>
        <label class="lbl" for="${key}-ind">Industria del prospecto</label>
        <select id="${key}-ind" class="sel">${industries.map((i) => `<option value="${esc(i)}">${esc(i)}</option>`).join("")}</select>
        <div class="cases">${b.cases
          .map(
            (c) => `<div class="case" data-ind="${esc(c.industry || "General")}"><div class="term">${esc(c.client)}</div><p>${esc(c.story)}</p><div class="oneliner"><span class="lbl">Dilo en una frase</span>“${esc(c.oneLiner)}”</div></div>`
          )
          .join("")}</div>
      </div></section>`;
    }
    case "dosdonts":
      return `<section class="blk">${h3(b.heading)}<div class="dd">
        <div class="do"><h4>Haz esto</h4><ul>${b.dos.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>
        <div class="dont"><h4>Evita esto</h4><ul>${b.donts.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>
      </div></section>`;
    case "builder": {
      const parts: [keyof typeof b.pieces, string][] = [
        ["context", "1. Contexto general"],
        ["help", "2. Cómo ayudamos"],
        ["proof", "3. Prueba"],
        ["question", "4. Pregunta"],
      ];
      return `<section class="blk">${h3(b.heading || "Arma tu mensaje")}<div class="builder" data-builder>
        ${parts
          .map(
            ([k, label]) => `<label class="lbl" for="${key}-${k}">${label}</label><select id="${key}-${k}" class="sel" data-piece>${b.pieces[k]
              .map((o) => `<option value="${esc(o)}">${esc(o)}</option>`)
              .join("")}</select>`
          )
          .join("")}
        <textarea class="msg" rows="6" aria-label="Mensaje armado"></textarea>
        <div class="bfoot"><span class="wc"></span><button type="button" class="btn" data-copy>Copiar</button></div>
      </div></section>`;
    }
    case "examples":
      return `<section class="blk">${h3(b.heading || "Mensajes de ejemplo")}<div class="examples">${b.examples
        .map((e) => `<div class="example"><span class="badge">${esc(e.channel)}</span>${e.title ? `<div class="term">${esc(e.title)}</div>` : ""}<p class="pre">${esc(e.text)}</p></div>`)
        .join("")}</div></section>`;
    case "script":
      return `<section class="blk">${h3(b.heading)}<div class="script">${b.lines
        .map((l) => `<div class="line ${/sdr/i.test(l.speaker) ? "me" : "them"}"><span class="lbl">${esc(l.speaker)}</span><p>${esc(l.text)}</p></div>`)
        .join("")}</div></section>`;
    case "sequence":
      return `<section class="blk">${h3(b.heading)}<div class="seq">${b.steps
        .map((x) => `<div class="seq-i"><span class="day">${esc(x.day)}</span><span class="badge">${esc(x.channel)}</span><p>${esc(x.action)}</p></div>`)
        .join("")}</div></section>`;
    case "checklist":
      return `<section class="blk">${h3(b.heading || "¿Esta reunión vale la pena?")}<div class="check" data-check>${b.items
        .map((i) => `<label class="ck"><input type="checkbox" data-critical="${i.critical ? "1" : "0"}"> <span>${esc(i.text)}${i.critical ? ' <em class="focus">Clave</em>' : ""}</span></label>`)
        .join("")}<div class="result" aria-live="polite"></div></div></section>`;
    case "objections":
      return `<section class="blk">${h3(b.heading || "Simulador de objeciones")}<p class="hint">Elige lo que te dijo el prospecto y piensa tu respuesta antes de verla.</p><div class="obj" data-obj>
        <div class="obj-list">${b.objections.map((o, i) => `<button type="button" class="chip" data-i="${i}">“${esc(o.objection)}”</button>`).join("")}</div>
        ${b.objections
          .map(
            (o, i) => `<div class="obj-card" data-i="${i}"><div class="term">“${esc(o.objection)}”</div>
              <div class="row"><span class="lbl">Lo que realmente significa</span><p>${esc(o.meaning)}</p></div>
              <button type="button" class="btn" data-reveal>Ver qué responder</button>
              <div class="row answer"><span class="lbl">Qué responder</span><p>${esc(o.answer)}</p></div></div>`
          )
          .join("")}
      </div></section>`;
    case "plan":
      return `<section class="blk">${h3(b.heading || "Tu plan de 5 días")}<div class="plan">${b.days
        .map((d) => `<div class="pday"><span class="day">${esc(d.day)}</span><div class="term">${esc(d.title)}</div><ul>${d.tasks.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`)
        .join("")}</div></section>`;
    case "quiz": {
      const total = b.questions.length;
      const pass = Math.ceil(total * 0.8);
      return `<section class="blk">${h3(b.heading || "Quiz final")}<form class="quiz" data-quiz data-pass="${pass}">${b.questions
        .map(
          (q, qi) => `<fieldset class="qq" data-answer="${q.answer}"><legend>${qi + 1}. ${esc(q.q)}</legend>${q.options
            .map((o, oi) => `<label class="opt"><input type="radio" name="${key}-q${qi}" value="${oi}"> <span>${esc(o)}</span></label>`)
            .join("")}${q.explain ? `<p class="explain">${esc(q.explain)}</p>` : ""}</fieldset>`
        )
        .join("")}<div class="bfoot"><button type="submit" class="btn">Ver mi puntaje</button><span class="score" aria-live="polite"></span></div><p class="hint">Apruebas con ${pass} de ${total}.</p></form></section>`;
    }
  }
}

const CSS = `
:root{--bg:#140F3D;--s1:#1E1760;--s2:#2A2180;--bd:#3A3196;--tx:#F3F1FF;--tx2:#B9B3E6;--cy:#62E0D8;--pu:#9B4FC0;--mg:#E0457B}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--tx);font-family:Roboto,system-ui,sans-serif;font-size:16px;line-height:1.55}
h1,h2,h3,h4,.term,.fv,.logo,.tab{font-family:Sora,system-ui,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:20px 16px 64px}
header.top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.logo{font-weight:700;font-size:22px}.logo b{color:var(--cy)}
.sub{color:var(--tx2);font-size:14px}
.lights{display:flex;gap:6px;align-items:center;margin:18px 0 8px;flex-wrap:wrap}
.light{width:22px;height:22px;border-radius:50%;background:var(--s2);border:2px solid var(--bd);transition:all .3s}
.light.on{background:var(--cy);border-color:var(--cy);box-shadow:0 0 12px var(--cy)}
.ptxt{color:var(--tx2);font-size:13px;margin-left:8px}
nav.tabs{display:flex;gap:8px;overflow-x:auto;padding:8px 0 12px;scrollbar-width:thin}
.tab{flex:0 0 auto;background:var(--s1);color:var(--tx2);border:1px solid var(--bd);border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer;white-space:nowrap}
.tab.on{background:var(--cy);color:var(--bg);border-color:var(--cy);font-weight:600}
.tab.done:not(.on){border-color:var(--cy);color:var(--cy)}
.panel{display:none}.panel.on{display:block}
.lap{color:var(--cy);font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:600}
h2{font-size:28px;line-height:1.2;margin:4px 0 6px}
.subt{color:var(--tx2);margin:0 0 18px}
h3{font-size:19px;margin:0 0 10px}h4{margin:0 0 8px;font-size:17px}
.blk{background:var(--s1);border:1px solid var(--bd);border-radius:16px;padding:18px;margin:14px 0}
.blk p{margin:0 0 10px}.blk p:last-child{margin-bottom:0}
.lbl{display:block;color:var(--cy);font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin:6px 0 4px}
.concept .lbl,.flip .lbl{display:inline;margin:0}
.hint{color:var(--tx2);font-size:14px}
ul.bul,ol.qs,ol.steps,.dd ul,.pday ul{margin:0;padding-left:20px}li{margin:4px 0}
.callout{border-radius:14px;padding:14px 16px;margin:14px 0;border-left:4px solid var(--cy);background:rgba(98,224,216,.08)}
.callout.alerta{border-color:var(--mg);background:rgba(224,69,123,.1)}
.callout.tip{border-color:var(--pu);background:rgba(155,79,192,.14)}
.callout p{margin:4px 0 0}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.fact{background:var(--s2);border-radius:12px;padding:12px}.fv{font-size:18px;font-weight:600;color:var(--cy)}.fl{color:var(--tx2);font-size:13px}
.story{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.st{background:var(--s2);border-radius:12px;padding:12px;border-top:3px solid var(--mg)}.st2{border-color:var(--pu)}.st3{border-color:var(--cy)}
.st span{font-family:Sora,sans-serif;font-weight:600;font-size:14px}
.chip{background:var(--s2);color:var(--tx);border:1px solid var(--bd);border-radius:999px;padding:8px 14px;cursor:pointer;font:inherit;font-size:14px;text-align:left}
.chip.on{border-color:var(--cy);background:rgba(98,224,216,.15);color:var(--cy)}
.focus{font-style:normal;font-size:11px;background:var(--mg);color:#fff;border-radius:6px;padding:1px 6px;margin-left:4px}
.svc-list,.obj-list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.svc-card,.obj-card{display:none;background:var(--s2);border-radius:12px;padding:14px}.svc-card.on,.obj-card.on{display:block}
.row{margin-top:8px}.row p{margin:0}
.answer{display:none}.obj-card.show .answer{display:block}.obj-card.show [data-reveal]{display:none}
ol.steps li{margin:8px 0}ol.steps p{margin:2px 0 0;color:var(--tx2)}
.flips{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.flip{position:relative;min-height:170px;perspective:800px;background:none;border:0;padding:0;cursor:pointer;color:var(--tx);font:inherit;text-align:left}
.face{position:absolute;inset:0;border-radius:14px;padding:14px;backface-visibility:hidden;transition:transform .5s;display:flex;flex-direction:column;gap:8px;border:1px solid var(--bd)}
.front{background:var(--s2);align-items:center;justify-content:center;text-align:center}.front .term{font-size:18px;color:var(--cy)}
.back{background:var(--pu);transform:rotateY(180deg);font-size:14px;overflow:auto}.back .lbl{color:#fff;font-weight:700}
.flip.on .front{transform:rotateY(180deg)}.flip.on .back{transform:rotateY(360deg)}
.roles,.needs,.cases,.examples,.plan{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.role,.need,.case,.example,.pday,.concept{background:var(--s2);border-radius:12px;padding:12px}
.concepts{display:grid;gap:10px}
.term{font-weight:600;margin-bottom:4px}
.badge{display:inline-block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-radius:6px;padding:2px 8px;background:var(--bd);color:var(--tx);margin-bottom:6px}
.role.decide .badge{background:var(--cy);color:var(--bg)}.role.influye .badge{background:var(--pu)}
ul.quotes{list-style:none;padding:0;margin:0}ul.quotes li{background:var(--s1);border-radius:10px;padding:8px 10px;margin:6px 0;font-style:italic}
.sel,.msg{width:100%;background:var(--s2);color:var(--tx);border:1px solid var(--bd);border-radius:10px;padding:10px;font:inherit;font-size:14px;margin-bottom:8px}
.msg{resize:vertical;margin-top:8px}
.case{display:none}.case.on{display:block}
.oneliner{margin-top:8px;font-style:italic}
.dd{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.do,.dont{border-radius:12px;padding:12px;background:var(--s2);border-top:3px solid var(--cy)}.dont{border-color:var(--mg)}
.bfoot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.wc{font-size:13px;color:var(--tx2)}.wc.ok{color:var(--cy)}.wc.long{color:var(--mg)}
.btn{background:var(--cy);color:var(--bg);border:0;border-radius:10px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer}
.btn.ghost{background:transparent;color:var(--cy);border:1px solid var(--cy)}
.pre{white-space:pre-wrap}
.script{display:flex;flex-direction:column;gap:8px}.line{max-width:85%;border-radius:12px;padding:10px 12px;background:var(--s2)}
.line.me{align-self:flex-start;border-left:3px solid var(--cy)}.line.them{align-self:flex-end;border-right:3px solid var(--pu)}.line p{margin:0}
.seq{display:flex;flex-direction:column;gap:8px}.seq-i{display:grid;grid-template-columns:70px 100px 1fr;gap:8px;align-items:start;background:var(--s2);border-radius:10px;padding:10px}
.seq-i p{margin:0}.seq-i .badge{justify-self:start}.day{font-family:Sora,sans-serif;font-weight:600;color:var(--cy)}
.ck{display:flex;gap:10px;align-items:flex-start;background:var(--s2);border-radius:10px;padding:10px;margin:6px 0;cursor:pointer}
.ck input,.opt input{accent-color:#62E0D8;width:18px;height:18px;margin-top:3px;flex:0 0 auto}
.result{margin-top:10px;font-weight:600}.result.good{color:var(--cy)}.result.bad{color:var(--mg)}
.qq{border:1px solid var(--bd);border-radius:12px;padding:12px;margin:0 0 10px}.qq legend{font-weight:600;padding:0 6px}
.opt{display:flex;gap:10px;align-items:flex-start;padding:6px;border-radius:8px;cursor:pointer}
.qq.checked .opt.right{background:rgba(98,224,216,.18)}.qq.checked .opt.wrong{background:rgba(224,69,123,.2)}
.explain{display:none;color:var(--tx2);font-size:14px;margin:6px 0 0}.qq.checked .explain{display:block}
.score{font-family:Sora,sans-serif;font-weight:600}
.remember{background:linear-gradient(135deg,var(--pu),var(--mg));border-radius:16px;padding:16px 18px;margin:18px 0}
.remember strong{font-family:Sora,sans-serif;display:block;margin-bottom:4px}
.navfoot{display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between;margin-top:18px}
@media (max-width:600px){h2{font-size:23px}.seq-i{grid-template-columns:1fr}.line{max-width:100%}}
`;

const JS = `
(function(){
  var KEY=document.body.getAttribute('data-key');
  function load(){try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch(e){return []}}
  function save(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}}
  var done=load();
  var tabs=[].slice.call(document.querySelectorAll('.tab'));
  var panels=[].slice.call(document.querySelectorAll('.panel'));
  var lights=[].slice.call(document.querySelectorAll('.light'));
  function paint(){
    lights.forEach(function(l){l.classList.toggle('on',done.indexOf(+l.getAttribute('data-no'))>=0)});
    tabs.forEach(function(t){t.classList.toggle('done',done.indexOf(+t.getAttribute('data-no'))>=0)});
    panels.forEach(function(p){var b=p.querySelector('[data-done]');if(b){var d=done.indexOf(+p.getAttribute('data-no'))>=0;b.textContent=d?'Vuelta completada ✓':'Marcar vuelta como completada';b.classList.toggle('ghost',!d)}});
    var pt=document.querySelector('.ptxt');if(pt)pt.textContent=done.length+' de '+panels.length+' vueltas';
  }
  function show(no){
    tabs.forEach(function(t){t.classList.toggle('on',+t.getAttribute('data-no')===no)});
    panels.forEach(function(p){p.classList.toggle('on',+p.getAttribute('data-no')===no)});
    window.scrollTo(0,0);
  }
  tabs.forEach(function(t){t.addEventListener('click',function(){show(+t.getAttribute('data-no'))})});
  panels.forEach(function(p){
    var no=+p.getAttribute('data-no');
    var b=p.querySelector('[data-done]');
    if(b)b.addEventListener('click',function(){var i=done.indexOf(no);if(i>=0)done.splice(i,1);else done.push(no);save(done);paint()});
    var n=p.querySelector('[data-next]');
    if(n)n.addEventListener('click',function(){if(done.indexOf(no)<0){done.push(no);save(done);paint()}var nx=panels[panels.indexOf(p)+1];if(nx)show(+nx.getAttribute('data-no'))});
  });
  document.querySelectorAll('[data-svc],[data-obj]').forEach(function(box){
    var chips=box.querySelectorAll('.chip'),cards=box.querySelectorAll('.svc-card,.obj-card');
    chips.forEach(function(c){c.addEventListener('click',function(){var i=c.getAttribute('data-i');
      chips.forEach(function(x){x.classList.toggle('on',x===c)});
      cards.forEach(function(x){x.classList.toggle('on',x.getAttribute('data-i')===i);x.classList.remove('show')})})});
    box.querySelectorAll('[data-reveal]').forEach(function(r){r.addEventListener('click',function(){r.parentNode.classList.add('show')})});
  });
  document.querySelectorAll('[data-flip]').forEach(function(f){f.addEventListener('click',function(){f.classList.toggle('on')})});
  document.querySelectorAll('[data-cases]').forEach(function(box){
    var sel=box.querySelector('select');
    function upd(){box.querySelectorAll('.case').forEach(function(c){c.classList.toggle('on',c.getAttribute('data-ind')===sel.value)})}
    sel.addEventListener('change',upd);upd();
  });
  document.querySelectorAll('[data-builder]').forEach(function(box){
    var sels=box.querySelectorAll('[data-piece]'),ta=box.querySelector('textarea'),wc=box.querySelector('.wc');
    function count(){var n=(ta.value.trim().match(/\\S+/g)||[]).length;wc.textContent=n+' palabras '+(n<80?'(ideal: menos de 80 ✓)':'(ideal: menos de 80)');wc.className='wc '+(n<80?'ok':'long')}
    function build(){ta.value=[].map.call(sels,function(s){return s.value}).filter(Boolean).join(' ');count()}
    sels.forEach(function(s){s.addEventListener('change',build)});ta.addEventListener('input',count);build();
    box.querySelector('[data-copy]').addEventListener('click',function(e){var b=e.target;
      function ok(){b.textContent='¡Copiado!';setTimeout(function(){b.textContent='Copiar'},1500)}
      function legacy(){ta.select();try{document.execCommand('copy');ok()}catch(x){}}
      if(navigator.clipboard){navigator.clipboard.writeText(ta.value).then(ok,legacy)}else legacy()});
  });
  document.querySelectorAll('[data-check]').forEach(function(box){
    var inputs=box.querySelectorAll('input'),res=box.querySelector('.result');
    function upd(){var miss=[].filter.call(inputs,function(i){return i.getAttribute('data-critical')==='1'&&!i.checked});
      var any=[].some.call(inputs,function(i){return i.checked});
      if(!any){res.textContent='';return}
      if(miss.length===0){res.textContent='✓ Esta reunión vale la pena: agéndala.';res.className='result good'}
      else{res.textContent='Todavía no: te faltan '+miss.length+' punto(s) clave. Si tienes dudas, avisa a tu líder.';res.className='result bad'}}
    inputs.forEach(function(i){i.addEventListener('change',upd)});
  });
  document.querySelectorAll('[data-quiz]').forEach(function(form){
    form.addEventListener('submit',function(e){e.preventDefault();var ok=0,fs=form.querySelectorAll('.qq');
      fs.forEach(function(q){var a=q.getAttribute('data-answer'),c=q.querySelector('input:checked');q.classList.add('checked');
        q.querySelectorAll('.opt').forEach(function(o){var v=o.querySelector('input').value;o.classList.toggle('right',v===a);o.classList.toggle('wrong',!!c&&c.value===v&&v!==a)});
        if(c&&c.value===a)ok++});
      var pass=+form.getAttribute('data-pass');
      form.querySelector('.score').textContent=ok+' de '+fs.length+(ok>=pass?' — ¡Aprobaste! 🏁':' — Repasa y vuelve a intentarlo');
    });
  });
  paint();
})();
`;

export function renderAcademyHtml(opts: { clientName: string; clientKey: string; modules: AcademyModule[] }): string {
  const mods = opts.modules.slice().sort((a, b) => a.no - b.no);
  const first = mods[0]?.no ?? 1;
  const lights = mods.map((m) => `<span class="light" data-no="${m.no}" title="Vuelta ${m.no}"></span>`).join("");
  const tabs = mods.map((m) => `<button type="button" class="tab${m.no === first ? " on" : ""}" data-no="${m.no}">${m.no}. ${esc(m.title)}</button>`).join("");
  const panels = mods
    .map((m, idx) => {
      const isLast = idx === mods.length - 1;
      return `<article class="panel${m.no === first ? " on" : ""}" data-no="${m.no}">
        <div class="lap">Vuelta ${m.no} de ${mods.length}</div>
        <h2>${esc(m.title)}</h2>
        ${m.subtitle ? `<p class="subt">${esc(m.subtitle)}</p>` : ""}
        ${m.blocks.map((b, bi) => renderBlock(b, `m${m.no}b${bi}`)).join("")}
        ${m.remember ? `<div class="remember"><strong>Lo que debes recordar</strong>${esc(m.remember)}</div>` : ""}
        <div class="navfoot"><button type="button" class="btn ghost" data-done>Marcar vuelta como completada</button>${isLast ? "" : '<button type="button" class="btn" data-next>Siguiente vuelta →</button>'}</div>
      </article>`;
    })
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Academia SDR · ${esc(opts.clientName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Sora:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body data-key="academia-sdr:${esc(opts.clientKey)}">
<div class="wrap">
  <header class="top">
    <div><div class="logo">Bulls<b>Eye</b></div><div class="sub">Academia SDR · ${esc(opts.clientName)}</div></div>
  </header>
  <div class="lights" aria-label="Avance">${lights}<span class="ptxt"></span></div>
  <nav class="tabs">${tabs}</nav>
  ${panels}
</div>
<script>${JS}</script>
</body>
</html>`;
}
