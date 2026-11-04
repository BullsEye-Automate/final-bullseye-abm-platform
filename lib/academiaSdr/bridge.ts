import type { ProgressConfig } from "./catalog";

// Puente entre la academia HTML (en un iframe aislado, sin acceso a la sesión
// de la plataforma) y la página de Entrenamiento cliente. Se inyecta como
// primer <script> del HTML, sin cambiar su diseño:
//   - reemplaza localStorage por uno en memoria (en un iframe aislado el
//     localStorage real no está disponible), precargado con las vueltas que
//     el usuario ya completó según la base de datos;
//   - cuando la academia guarda su avance, compara las vueltas completadas y
//     avisa a la página con postMessage (lap_done / lap_undone / quiz).

function bridgeSource(): string {
  return `(function(C,SEED){
var mem={};
function laps(raw){var v;try{v=JSON.parse(raw)}catch(e){return null}
var a=C.shape==='object'?(v&&v.done):v;if(!Array.isArray(a))return null;var out=[];
a.forEach(function(x){var n;if(C.ids){var i=C.ids.indexOf(x);n=i<0?NaN:i+1}else{n=Number(x)+(C.base===0?1:0)}
if(n>=1&&n<=10&&out.indexOf(n)<0)out.push(n)});return out}
function unlaps(list){return list.map(function(n){return C.ids?C.ids[n-1]:(C.base===0?n-1:n)})}
if(C.key&&SEED.length){var v;if(C.shape==='object'){v=JSON.parse(JSON.stringify(C.empty||{}));v.done=unlaps(SEED)}else{v=unlaps(SEED)}mem[C.key]=JSON.stringify(v)}
var last=C.key&&mem[C.key]?laps(mem[C.key]):[];var lastQuiz=null;
function emit(m){m.source='academia-sdr';try{parent.postMessage(m,'*')}catch(e){}}
function changed(k,val){if(!C.key||k!==C.key)return;var now=laps(val);if(!now)return;
now.forEach(function(n){if(last.indexOf(n)<0)emit({type:'lap_done',no:n})});
last.forEach(function(n){if(now.indexOf(n)<0)emit({type:'lap_undone',no:n})});last=now;
if(C.quiz){try{var q=JSON.parse(val)[C.quiz];if(q&&isFinite(q.score)&&isFinite(q.total)){var sig=q.score+'/'+q.total;if(sig!==lastQuiz){lastQuiz=sig;emit({type:'quiz',no:10,score:+q.score,total:+q.total})}}}catch(e){}}}
function store(track){var m=track?mem:{};return{
getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},
setItem:function(k,val){k=String(k);val=String(val);m[k]=val;if(track)changed(k,val)},
removeItem:function(k){delete m[String(k)]},clear:function(){for(var k in m)delete m[k]},
key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}}
var ls=store(true),ss=store(false);
try{Object.defineProperty(window,'localStorage',{configurable:true,get:function(){return ls}})}catch(e){}
try{Object.defineProperty(window,'sessionStorage',{configurable:true,get:function(){return ss}})}catch(e){}
})`;
}

// JSON dentro de <script>: se escapa "<" para que no cierre la etiqueta.
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export function injectBridge(html: string, progress: ProgressConfig | null, completed: number[]): string {
  const cfg = progress ?? { key: "", shape: "array", base: 1 };
  const script = `<script>${bridgeSource()}(${safeJson(cfg)},${safeJson(completed)});</script>`;
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  return script + html;
}
