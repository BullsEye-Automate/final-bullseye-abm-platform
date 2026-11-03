// @ts-nocheck
/* eslint-disable */
// Centro de prospección BullsEye — lógica original del artifact de claude.ai,
// portada al portal sin cambios de comportamiento. Generado por
// scripts/centro-prospeccion/build_legacy.py a partir del HTML del artifact;
// los únicos cambios son: datos por el adaptador del portal (DEPS.claude en
// lugar de window.claude), tema solo claro, escuchas globales que se quitan
// al salir, scroll del <main> del portal, archivos por /api/centro/assets y
// textos que mencionaban claude.ai.
export function mountCentro(ROOT, DEPS){
'use strict';
const {Chart,ExcelJS,Papa}=DEPS;
const __ac=new AbortController();
const onDoc=(t,f)=>document.addEventListener(t,f,{signal:__ac.signal});
const scrollMain=(...a)=>{const m=ROOT.closest('main');if(m&&m.scrollTo)m.scrollTo(...a);else window.scrollTo(...a)};
/* ---------- utilidades ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>(n==null||!isFinite(n))?'–':Math.round(n).toLocaleString('es-CL');
const pct=n=>(n==null||!isFinite(n))?'–':Math.round(n*100)+'%';
const z=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());
const TODAY=()=>ymd(new Date());
const addDays=(s,n)=>{const d=new Date(s+'T12:00:00');d.setDate(d.getDate()+n);return ymd(d)};
const dayOf=iso=>{if(!iso)return '';const d=new Date(iso);return isNaN(d)?String(iso).slice(0,10):ymd(d)};
const niceDate=s=>{if(!s)return '–';const d=new Date(String(s).length===10?s+'T12:00:00':s);return isNaN(d)?'–':d.toLocaleDateString('es-CL',{day:'numeric',month:'short'})};
const inR=(d,a,b)=>!!d&&(!a||d>=a)&&(!b||d<=b);
const slug=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||('c-'+Date.now());
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};

const IC={
 home:'<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z"/>',
 building:'<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3"/>',
 inbox:'<path d="M4 13l2.5-7.5A1 1 0 0 1 7.4 5h9.2a1 1 0 0 1 .9.5L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h4l1.5 3h5L16 13h4"/>',
 pen:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
 shuffle:'<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
 wrench:'<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7V21h3.3l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
 gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
 x:'<path d="M6 6l12 12M18 6 6 18"/>',
 upload:'<path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
 target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
 users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
 check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
 sparkle:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'
};
const ic=(n,s=16)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]||''}</svg>`;

/* ---------- catálogos ---------- */
const VIEWS=[
 {id:'resumen',t:'Resumen del equipo',s:'Actividad, solicitudes y resultados de cruces de la prospección',ic:'home',grp:'Reportería'},
 {id:'comp',t:'Comparación 2025 vs 2026',s:'Mismos meses y promedios mensuales, para comparar en forma justa',ic:'chart'},
 {id:'clientes',t:'Clientes',s:'Perfil de búsqueda, avances y próximos pasos de cada cliente',ic:'building',grp:'Trabajo diario'},
 {id:'cuentas',t:'Cuentas aprobadas',s:'Empresas que cada cliente aprobó para prospectar, con su prospectora y estado de trabajo',ic:'check'},
 {id:'plan',t:'Plan semanal',s:'Metas de la semana por prospectora y cliente, con lo entregado y los motivos cuando no hubo gestión',ic:'clock'},
 {id:'solicitudes',t:'Solicitudes de investigación',s:'Pide listados de empresas, búsquedas, cruces o limpiezas y sigue su estado',ic:'inbox'},
 {id:'registro',t:'Registro de avance',s:'Lo que investigó y cargó cada prospectora',ic:'pen'},
 {id:'efectividad',t:'Efectividad de prospección',s:'Índice semanal por prospectora y cliente según ICP, cargos y datos de contacto (solo líderes)',ic:'chart',grp:'Liderazgo'},
 {id:'mant',t:'Mantenimiento',s:'Registro vivo de mejoras y riesgos técnicos de este portal',ic:'wrench',grp:'Herramientas'}
];
const TIPOS=['Listado de empresas','Sitio web y LinkedIn','Cruce de bases','Limpieza de datos','Otro'];
const ESTADOS={revision:{t:'Esperando aprobación',c:'o'},pendiente:{t:'Pendiente',c:'y'},en_proceso:{t:'En proceso',c:'p'},lista:{t:'Entregada',c:'g'},cancelada:{t:'Cancelada',c:'n'}};
const PRIOS={alta:{t:'Alta',c:'r'},media:{t:'Media',c:'y'},baja:{t:'Baja',c:'n'}};
const MPRIO={critico:{t:'Crítico',c:'r',o:0},alto:{t:'Alto',c:'o',o:1},medio:{t:'Medio',c:'y',o:2},bajo:{t:'Bajo',c:'g',o:3}};
const MEST={pendiente:'Pendiente',en_curso:'En curso',resuelto:'Resuelto',descartado:'Descartado'};

/* ---------- estado ---------- */
const S={view:'resumen',per:'30',cli:'',who:'',rf:'abiertas',kf:'aprobadas',kl:'todas'};
try{const h=location.hash.replace('#','');if(VIEWS.some(v=>v.id===h))S.view=h;}catch(e){}
const D={clientes:[],solicitudes:[],registro:[],metas:null,mant:[],equipo:[],plan:[],prop:[],hist:{},docs:[],cuentas:[]};
const VINC={};let ACTIVOS=[];let myEmail=null,linkTried=false,vincLoaded=false,eqLoaded=false;
const L={c:false,s:false,r:false,m:false,p:false,k:false};
let db=null,user=null,dlc=null,assetsCap=null,myId=null,isAdmin=false,canWrite=null,connected=false,offline=false,readOnly=false;
const SNAP=/*SNAPSHOT*/null;
const PROF={};
let charts=[];

/* ---------- tema ---------- */
/* tema: el portal es solo claro */
function curTheme(){return 'light'}
$('#themeBtn').hidden=true;

/* ---------- toast ---------- */
let tt;function toast(m,err){const t=$('#toast');t.textContent=m;t.className=err?'err':'';t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,err?6000:3200)}
function setBanner(m){const b=$('#banner');if(!m){b.hidden=true;return}b.textContent=m;b.hidden=false}

/* ---------- personas ---------- */
const roster=()=>(D.equipo||[]).filter(m=>m&&m.email);
const rosterBy=e=>roster().find(m=>String(m.email).toLowerCase()===String(e||'').toLowerCase());
const keyOf=r=>{if(!r)return '';if(r.nombreHistorico)return 'hist:'+r.nombreHistorico;const e=String(r.email||VINC[r.por]||'').toLowerCase();return e||r.por||''};
const myKey=()=>(VINC[myId]||myEmail||myId||'');
const myMail=()=>{const k=myKey();return k&&k.includes('@')?k:''};
const pname=id=>{if(!id)return 'Sin identificar';if(String(id).startsWith('hist:'))return String(id).slice(5);if(String(id).includes('@')){const m=rosterBy(id);if(m)return m.nombre||id;if(id===myEmail&&myId&&PROF[myId]&&PROF[myId].name)return PROF[myId].name;return id}return (PROF[id]&&PROF[id].name)||(id===myId?'Tú':'Sin identificar')};
const CPAL=['#3d5afe','#e8437f','#00a896','#f7812b','#7b5cff','#1e9bf0'];
const colorOf=k=>{if(!k)return '#98a0bd';if(String(k).startsWith('hist:'))return '#98a0bd';if(!String(k).includes('@')&&PROF[k]&&PROF[k].color)return PROF[k].color;const i=roster().findIndex(m=>String(m.email).toLowerCase()===k);if(i>=0)return CPAL[i%CPAL.length];let h=0;for(const ch of String(k))h=(h*31+ch.charCodeAt(0))>>>0;return CPAL[h%CPAL.length]};
const ini=n=>String(n||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';
function av(id){return `<span class="av" style="--c:${esc(colorOf(id))}">${esc(ini(pname(id)))}</span>`}
function who(id,sub){return `<span class="who">${av(id)}<span style="min-width:0"><b>${esc(pname(id))}</b>${sub?`<small class="muted" style="display:block;font-size:11.5px">${esc(sub)}</small>`:''}</span></span>`}
async function resolveProfiles(){
  if(!user)return;
  const ids=[...new Set([...D.solicitudes.map(r=>r.por),...D.registro.map(r=>r.por),myId].filter(Boolean))];
  if(!ids.length)return;
  let ps;try{ps=await user.profiles(ids)}catch(e){return}
  let ch=false;
  ids.forEach(id=>{const p=ps[id]||{};const n=p.name||'';if(!PROF[id]||PROF[id].name!==n||PROF[id].color!==p.color){ch=true}PROF[id]={name:n,color:p.color||'#7b5cff'}});
  if(ch)sched();
}
const team=()=>roster().map(m=>String(m.email).toLowerCase());
const cname=id=>{const c=D.clientes.find(x=>x.id===id);if(c)return c.nombre;if(!id)return 'Sin cliente';const r=D.registro.find(x=>x.clienteId===id&&x.clienteNombre)||D.solicitudes.find(x=>x.clienteId===id&&x.clienteNombre);return r?r.clienteNombre+(ACTIVOS.includes(id)?'':' (ex cliente)'):'Ex cliente'};
const allClients=()=>{const m=new Map(D.clientes.map(c=>[c.id,{id:c.id,nombre:c.nombre,ficha:c}]));[...D.registro,...D.solicitudes].forEach(r=>{if(r.clienteId&&!m.has(r.clienteId))m.set(r.clienteId,{id:r.clienteId,nombre:r.clienteNombre||r.clienteId,ficha:null,ex:!ACTIVOS.includes(r.clienteId)})});return [...m.values()].sort((a,b)=>(a.ex?1:0)-(b.ex?1:0)||String(a.nombre).localeCompare(String(b.nombre),'es'))};

/* ---------- escritura con manejo de errores ---------- */
async function write(fn,ok){
  if(readOnly){toast('Esta es la versión de consulta: los cambios no se guardan aquí.',true);return false}
  if(!db){toast('No hay conexión con los datos del equipo. Recarga la página para guardar.',true);return false}
  try{await fn();if(ok)toast(ok);return true}
  catch(e){
    const c=e&&e.code;
    if(c==='invalid_argument'){canWrite=false;toast('No tienes permiso para guardar esto. Pide a quien te compartió la página que te invite como Editora.',true);sched()}
    else if(c==='quota_exceeded')toast('La base del portal está llena. Avísale a quien administra el portal para archivar registros antiguos.',true);
    else if(c==='resource_exhausted')toast('Demasiados cambios seguidos. Espera unos segundos e intenta otra vez.',true);
    else toast('No se pudo guardar. Revisa tu conexión e intenta de nuevo.',true);
    return false;
  }
}

/* ---------- navegación ---------- */
const isOpen=r=>r.estado==='revision'||r.estado==='pendiente'||r.estado==='en_proceso';
function openCount(){return D.solicitudes.filter(isOpen).length}
/* ---------- consumo estimado ---------- */
const CONSUMO={bajo:{t:'Bajo',c:'g'},medio:{t:'Medio',c:'y'},alto:{t:'Alto',c:'r'}};
function estimarConsumo(tipo,cant,filas){
  const n=Math.max(+cant||0,+filas||0);
  if(tipo==='Listado de empresas'){if(n>150)return['alto',`Se piden más de 150 empresas (${fmt(n)}). Cada una se busca y verifica por separado.`];if(n>=75)return['medio',`Se piden entre 75 y 150 empresas (${fmt(n)}).`];if(!n)return['medio','No se indicó cantidad: puede crecer sin límite.'];return['bajo',`${fmt(n)} empresas.`]}
  if(tipo==='Sitio web y LinkedIn'){if(n>100)return['alto',`Hay que investigar más de 100 empresas una por una (${fmt(n)}).`];if(n>=50)return['medio',`Entre 50 y 100 empresas a investigar (${fmt(n)}).`];if(!n)return['medio','No se indicó cuántas empresas hay que investigar.'];return['bajo',`${fmt(n)} empresas a investigar.`]}
  if(tipo==='Cruce de bases'||tipo==='Limpieza de datos'){if(n>3000)return['alto',`Más de 3.000 filas a procesar (${fmt(n)}).`];if(n>1000)return['medio',`Entre 1.000 y 3.000 filas (${fmt(n)}).`];return['bajo',n?`${fmt(n)} filas.`:'Trabajo de procesamiento de datos.']}
  if(n>100)return['alto',`Más de 100 registros (${fmt(n)}).`];if(n>=50||!n)return['medio',n?`${fmt(n)} registros.`:'No se indicó el volumen.'];return['bajo',`${fmt(n)} registros.`];
}
/* ---------- entrega estimada (simula la cola diaria) ---------- */
const RUN_M=53,RUN_H0=8,RUN_H1=20,RUN_MAX=5,WEB_POR_RUN=150;
const _clFmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Santiago',hour:'numeric',hourCycle:'h23',weekday:'short'});
const okRun=t=>{const pr=Object.fromEntries(_clFmt.formatToParts(t).map(x=>[x.type,x.value]));const h=+pr.hour;return !['Sat','Sun'].includes(pr.weekday)&&h>=RUN_H0&&h<=RUN_H1};
function nextRun(from){const t=new Date(from||Date.now());const m=t.getMinutes();t.setSeconds(0,0);t.setMinutes(RUN_M);if(m>=RUN_M)t.setTime(t.getTime()+3600e3);let g=0;while(!okRun(t)&&g++<200)t.setTime(t.getTime()+3600e3);return t}
const addRun=d=>nextRun(new Date(new Date(d).getTime()+60e3));
function pendFilas(r){if(r.tipo!=='Sitio web y LinkedIn')return 0;const tot=(r.progreso&&r.progreso.total)||(r.adjunto&&r.adjunto.filas)||r.cantidad||0;const h=(r.progreso&&r.progreso.hechas)||0;return Math.max(tot-h,0)}
const corridas=r=>r.tipo==='Sitio web y LinkedIn'?Math.max(1,Math.ceil(pendFilas(r)/WEB_POR_RUN)):1;
function colaETA(extra){
  const po={alta:0,media:1,baja:2};
  const ex=D.extra||{},hoy=TODAY();let q=D.solicitudes.filter(r=>(r.estado==='pendiente'||r.estado==='en_proceso')&&ex[r.id]!==hoy).map(r=>({id:r.id,pr:po[r.prioridad]??1,c:String(r.creado||''),left:corridas(r)}));
  if(extra)q.push({id:'__nueva',pr:po[extra.prioridad]??1,c:'~',left:corridas(extra)});
  q.sort((a,b)=>a.pr-b.pr||a.c.localeCompare(b.c));
  const out={};let run=nextRun(extra&&extra.desde),guard=0;
  while(q.length&&guard++<400){const take=q.slice(0,RUN_MAX);take.forEach(x=>{x.left--;if(x.left<=0)out[x.id]=new Date(run)});q=q.filter(x=>x.left>0);run=addRun(run)}
  return out;
}
let _eta=null,_etaKey='';
function etaDe(r){const k=D.solicitudes.map(x=>x.id+x.estado+(x.progreso?x.progreso.hechas:'')).join('|');if(k!==_etaKey){_eta=colaETA();_etaKey=k}return _eta[r.id]}
const fechaCorta=d=>{const sd=x=>new Date(x).toDateString();const hh=d.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});const ent=new Date(d.getTime()+20*60e3);const h2=ent.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});const dia=sd(d)===sd(Date.now())?'hoy':sd(d)===sd(Date.now()+864e5)?'mañana':d.toLocaleDateString('es-CL',{weekday:'short',day:'numeric',month:'short'});return `${dia} ~${h2}`};
function etaTxt(r){
  if(r.estado==='lista')return{t:niceDate(r.entregado),s:'entregada'};
  if(r.estado==='cancelada')return{t:'–',s:''};
  if(r.estado==='revision')return{t:'Tras aprobación',s:''};
  if((D.extra||{})[r.id]===TODAY())return{t:'Hoy',s:'ejecución extraordinaria',d:new Date()};
  const d=etaDe(r);if(!d)return{t:'–',s:''};return{t:fechaCorta(d),s:'estimada',d};
}
function barra(r){const pg=r.progreso;if(!pg||!pg.total)return'';const pc=Math.min(100,Math.round(100*(pg.hechas||0)/pg.total));return`<div class="bar sm" role="progressbar" aria-valuenow="${pc}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pc}%"></i></div><div class="rt-sub">${fmt(pg.hechas||0)} de ${fmt(pg.total)} filas listas</div>`}
/* ---------- lectura de archivos adjuntos ---------- */
const MAX_FILAS=5000;
async function parseTable(file){
  let rows;
  if(/\.csv$/i.test(file.name)){let txt=await file.text();if(txt.charCodeAt(0)===0xFEFF)txt=txt.slice(1);rows=Papa.parse(txt,{skipEmptyLines:'greedy'}).data}
  else if(/\.xlsx$/i.test(file.name)){const wb=new ExcelJS.Workbook();await wb.xlsx.load(await file.arrayBuffer());const ws=wb.worksheets[0];if(!ws)throw new Error('vacio');rows=[];ws.eachRow({includeEmpty:false},row=>{const v=[];row.eachCell({includeEmpty:true},(c,col)=>{let t='';try{t=c.text}catch(_){t=c.value}v[col-1]=t==null?'':String(t)});rows.push(Array.from(v,x=>x==null?'':x))})}
  else throw new Error('formato');
  rows=rows.filter(r=>r.some(c=>String(c).trim()!==''));
  if(rows.length<2)throw new Error('pocas');
  const r0=rows[0].map(h=>String(h).trim());
  const pareceDato=r0.some(h=>/^\d{1,3}(\.?\d{3}){1,2}-[\dkK]$/.test(h)||/^\d+([.,]\d+)?$/.test(h)||/^https?:\/\//i.test(h)||/@/.test(h));
  const sinEnc=file._sinEnc!=null?file._sinEnc:pareceDato;
  const nc=Math.max(...rows.map(r=>r.length));
  const cols=sinEnc?Array.from({length:nc},(_,i)=>(r0[i]&&/^\d{1,3}(\.?\d{3}){1,2}-[\dkK]$/.test(r0[i]))?'RUT':`Columna ${i+1}`):r0.map((h,i)=>h||`Columna ${i+1}`);
  let body=rows.slice(sinEnc?0:1).map(r=>cols.map((_,i)=>String(r[i]==null?'':r[i]).slice(0,500)));
  const recortado=body.length>MAX_FILAS;if(recortado)body=body.slice(0,MAX_FILAS);
  return{cols,body,recortado,total:rows.length-(sinEnc?0:1),sinEnc,pareceDato};
}
const normEmp=v=>String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[.,;:()'"´`]/g,' ').replace(/\b(s ?a ?c|s ?a ?s|s ?a|spa|s ?p ?a|ltda|limitada|eirl|inc|llc|ltd|sociedad anonima|s de r ?l|de c ?v|cia|y cia)\b/g,' ').replace(/[^a-z0-9&]+/g,' ').trim();
const empCol=cols=>{const i=cols.findIndex(h=>/empresa|company|raz[oó]n social|cuenta|account|organiza|compa[nñ][ií]a/i.test(h));return i<0?0:i};
function partir(body,cols){const parts=[];let cur=[],size=0;const lim=180000;body.forEach(r=>{const l=JSON.stringify(r).length+1;if(cur.length&&size+l>lim){parts.push(cur);cur=[];size=0}cur.push(r);size+=l});if(cur.length)parts.push(cur);return parts}
function renderNav(){
  let h='';VIEWS.filter(v=>(v.id!=='mant'||isAdmin)&&(v.id!=='efectividad'||isLead())).forEach(v=>{if(v.grp)h+=`<div class="grp">${esc(v.grp)}</div>`;const cnt=v.id==='solicitudes'&&openCount()?`<span class="cnt">${openCount()}</span>`:'';h+=`<button data-view="${v.id}" class="${S.view===v.id?'on':''}" ${S.view===v.id?'aria-current="page"':''}>${ic(v.ic)}<span>${esc(v.t)}</span>${cnt}</button>`});
  $('#nav').innerHTML=h;
  const f=$('#sideFoot');
  if(readOnly)f.innerHTML=`<b>Versión de consulta.</b> Datos al ${esc(niceDate(SNAP.generado))}. El cruce funciona completo.`;
  else if(offline)f.innerHTML='<b>Sin conexión a los datos.</b> Recarga la página.';
  else if(!connected)f.textContent='Conectando con los datos del equipo…';
  else f.innerHTML=`<b>${esc(myId?pname(myKey()):'Visitante')}</b><br>${isAdmin?'Administras el portal: puedes editar clientes, metas y mantenimiento.':(canWrite===false?'Acceso de solo lectura.':'Puedes crear solicitudes y registrar tu avance.')}`;
}
function renderTop(){
  if(S.view==='solicitudes'&&S.cli&&L.c&&!D.clientes.some(c=>c.id===S.cli))S.cli='';
  if(S.who&&D.equipo.length&&!team().includes(S.who))S.who='';
  const v=VIEWS.find(x=>x.id===S.view);
  $('#vt').textContent=v.t;$('#vs').textContent=v.s;
  $('#newReqBtn').innerHTML=ic('plus')+'<span>Nueva solicitud</span>';
  $('#cfgBtn').innerHTML=ic('gear')+'<span>Configurar</span>';$('#cfgBtn').hidden=!isAdmin;
  const f=$('#filters');let h='';
  if(S.view==='resumen'||S.view==='registro'){h+=`<div class="seg" role="group" aria-label="Período">${[['7','7 días'],['30','30 días'],['90','90 días'],['ano','Este año'],['todo','Todo']].map(([k,t])=>`<button data-per="${k}" class="${S.per===k?'on':''}">${t}</button>`).join('')}</div>`}
  if(['resumen','solicitudes','registro','comp','plan','cuentas'].includes(S.view)){
    h+=`<select id="fCli" aria-label="Cliente" class="${S.cli?'act':''}"><option value="">Todos los clientes</option>${(()=>{const o=c=>`<option value="${esc(c.id)}" ${S.cli===c.id?'selected':''}>${esc(c.nombre)}</option>`;if(S.view==='solicitudes')return D.clientes.slice().sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es')).map(o).join('');const cur=allClients().filter(c=>!c.ex);const ex=allClients().filter(c=>c.ex);return `<optgroup label="Clientes actuales">${cur.map(o).join('')}</optgroup>`+(ex.length?`<optgroup label="Ex clientes">${ex.map(o).join('')}</optgroup>`:'')})()}</select>`;
    const tm=team();h+=`<select id="fWho" aria-label="Prospectora" class="${S.who?'act':''}"><option value="">Todo el equipo</option>${tm.map(id=>`<option value="${esc(id)}" ${S.who===id?'selected':''}>${esc(pname(id))}</option>`).join('')}</select>`;
    if(S.cli||S.who)h+=`<button class="btn ghost sm" data-act="clear">Limpiar filtros</button>`;
  }
  if(S.view==='cuentas'){h+=`<div class="seg" role="group" aria-label="Respuesta del cliente">${[['aprobadas','Aprobadas'],['revisar','Por revisar'],['rechazadas','Rechazadas'],['pendientes','Sin respuesta'],['todas','Todas']].map(([k,t])=>`<button data-kf="${k}" class="${S.kf===k?'on':''}">${t}</button>`).join('')}</div><div class="seg" role="group" aria-label="Lista">${[['todas','Ambas listas'],['Empresas grandes','Empresas grandes'],['Servicio TI 360','Servicio TI 360']].map(([k,t])=>`<button data-kl="${esc(k)}" class="${S.kl===k?'on':''}">${t}</button>`).join('')}</div>`}
  if(S.view==='solicitudes'){h+=`<div class="seg" role="group" aria-label="Estado">${[['abiertas','Abiertas'],['lista','Entregadas'],['todas','Todas']].map(([k,t])=>`<button data-rf="${k}" class="${S.rf===k?'on':''}">${t}</button>`).join('')}</div>`}
  if(f.dataset.k!==h){f.innerHTML=h;f.dataset.k=h}
}

/* ---------- render principal ---------- */
let rq=0;function sched(){if(rq)return;rq=requestAnimationFrame(()=>{rq=0;renderAll()})}
function renderAll(){
  renderNav();renderTop();
  if(S.view==='mant'&&!isAdmin)S.view='resumen';
  const isCx=S.view==='cruce';
  $('#cruce').hidden=!isCx;$('#view').hidden=isCx;
  if(isCx){fillCxClients();return}
  charts.forEach(c=>c.destroy());charts=[];
  $('#view').innerHTML=(VF[S.view]||VF.resumen)();
  (AF[S.view]||(()=>{}))();
  resolveProfiles();
}
const loading=()=>`<div class="card empty"><span class="spin" style="color:var(--primary)"></span><p style="margin-top:12px">Cargando datos del equipo…</p></div>`;
const noConn=()=>`<div class="card empty"><h3>No hay conexión con los datos del equipo</h3><p>Recarga la página o vuelve a iniciar sesión en el portal con tu correo corporativo. El módulo de cruce funciona igual sin conexión.</p><button class="btn" data-view="cruce">${ic('shuffle')} Ir al cruce</button></div>`;

/* ---------- métricas ---------- */
function win(){if(S.per==='todo')return{a:null,b:null,days:null};if(S.per==='ano'){const b=TODAY(),a=b.slice(0,4)+'-01-01';const n=Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/864e5)+1;return{a,b,days:n}}const n=+S.per,b=TODAY(),a=addDays(b,-(n-1));return{a,b,days:n,pa:addDays(a,-n),pb:addDays(a,-1)}}
const fReg=(a,b,who)=>D.registro.filter(r=>inR(r.fecha,a,b)&&(!S.cli||r.clienteId===S.cli)&&(!(who!==undefined?who:S.who)||keyOf(r)===(who!==undefined?who:S.who)));
const fReq=who=>D.solicitudes.filter(r=>(!S.cli||r.clienteId===S.cli)&&(!(who!==undefined?who:S.who)||keyOf(r)===(who!==undefined?who:S.who)));
function metrics(a,b,who){
  const reg=fReg(a,b,who),req=fReq(who);
  const cre=req.filter(r=>inR(dayOf(r.creado),a,b));
  const ent=req.filter(r=>r.estado==='lista'&&inR(dayOf(r.entregado),a,b));
  const ts=ent.map(r=>(new Date(r.entregado)-new Date(r.creado))/864e5).filter(x=>isFinite(x)&&x>=0);
  const sum=k=>reg.reduce((s,r)=>s+(+r[k]||0),0);
  const nuevos=sum('nuevos'),exist=sum('existentes');
  return{reg,creadas:cre.length,entregadas:ent.length,tiempo:ts.length?ts.reduce((x,y)=>x+y,0)/ts.length:null,empresas:sum('empresas'),contactos:sum('contactos'),cargados:sum('cargados'),nuevos,exist,tasa:(nuevos+exist)?nuevos/(nuevos+exist):null};
}
function delta(cur,prev,upGood=true){
  if(prev==null||cur==null||!isFinite(prev))return '<span class="dl n">&nbsp;</span>';
  if(prev===0){return cur>0?`<span class="dl ${upGood?'good':'bad'}">nuevo <em>vs período anterior</em></span>`:'<span class="dl n">sin cambio <em>vs período anterior</em></span>'}
  const d=(cur-prev)/prev;if(Math.abs(d)<0.005)return '<span class="dl n">sin cambio <em>vs período anterior</em></span>';
  const good=(d>0)===upGood;return `<span class="dl ${good?'good':'bad'}">${d>0?'▲':'▼'} ${Math.abs(Math.round(d*100))}% <em>vs período anterior</em></span>`;
}
const fdays=x=>x==null?'–':(x<1?Math.max(1,Math.round(x*24))+' h':(Math.round(x*10)/10).toLocaleString('es-CL')+' días');
function kpi(o){return `<div class="kpi ${o.hl?'hl':''}"><div class="kpi-h"><span class="kic ${o.c||''}">${ic(o.ic,15)}</span>${esc(o.t)}</div><div class="kv">${o.v}</div>${o.bar!=null?`<div class="bar"><i class="${o.bar>=1?'g':o.bar>=.7?'':'y'}" style="width:${Math.min(100,Math.round(o.bar*100))}%"></i></div>`:''}<div class="ksub">${o.sub||''}</div>${o.d||''}</div>`}

/* ---------- vistas ---------- */
const VF={},AF={};

VF.resumen=function(){
  if(offline)return noConn();if(!L.r||!L.s)return loading();
  const w=win(),m=metrics(w.a,w.b),p=w.a?metrics(w.pa,w.pb):null;
  const open=fReq().filter(isOpen);
  const alta=open.filter(r=>r.prioridad==='alta').length;
  const meta=D.metas||{};const nPeople=S.who?1:Math.max(1,team().length);
  const metaEmp=(meta.empresasSemana&&w.days)?meta.empresasSemana*nPeople*w.days/7:null;
  const metaCon=(meta.contactosSemana&&w.days)?meta.contactosSemana*nPeople*w.days/7:null;
  const pl=D.plan.filter(r=>(!w.a||r.semana>=mondayOf(w.a))&&(!w.b||r.semana<=w.b)&&(!S.cli||r.clienteId===S.cli)&&(!S.who||r.email===S.who)&&r.estado!=='planificada');
  const sg=pl.filter(r=>r.estado==='sin_gestion').length;
  let h=`<div class="kgrid">
   ${kpi({hl:1,ic:'building',t:'Empresas investigadas',v:fmt(m.empresas)+(metaEmp?`<span class="of"> / ${fmt(metaEmp)}</span>`:''),bar:metaEmp?m.empresas/metaEmp:null,sub:metaEmp?`${pct(m.empresas/metaEmp)} de la meta del período`:'Define metas en Configurar',d:p?delta(m.empresas,p.empresas):''})}
   ${kpi({ic:'users',t:'Contactos encontrados',v:fmt(m.contactos)+(metaCon?`<span class="of"> / ${fmt(metaCon)}</span>`:''),bar:metaCon?m.contactos/metaCon:null,sub:m.empresas?`${(Math.round(m.contactos/m.empresas*10)/10).toLocaleString('es-CL')} contactos por empresa`:'Sin entregas en el período',d:p?delta(m.contactos,p.contactos):''})}
   ${kpi({ic:'sparkle',c:'g',t:'Contactos nuevos en cruces',v:fmt(m.nuevos),sub:(m.nuevos+m.exist)?`${pct(m.tasa)} nuevos · ${fmt(m.exist)} ya estaban en HubSpot`:'Sin cruces registrados en el período',d:p?delta(m.nuevos,p.nuevos):''})}
   ${kpi({ic:'check',c:'g',t:'Solicitudes entregadas',v:fmt(m.entregadas)+`<span class="of"> / ${fmt(m.creadas)} creadas</span>`,sub:'Entregadas dentro del período',d:p?delta(m.entregadas,p.entregadas):''})}
   ${kpi({ic:'clock',c:'y',t:'Tiempo medio de entrega',v:fdays(m.tiempo),sub:'Desde que se pide hasta que se entrega',d:p&&m.tiempo!=null&&p.tiempo!=null?delta(m.tiempo,p.tiempo,false):''})}
   ${kpi({ic:'clock',c:pl.length&&sg/pl.length>.15?'r':'g',t:'Semanas sin gestión',v:pl.length?pct(sg/pl.length):'–',sub:pl.length?`${fmt(sg)} de ${fmt(pl.length)} asignaciones cerradas · objetivo ≤15%`:'Se mide desde el plan semanal'})}
   ${kpi({ic:'inbox',c:alta?'r':'',t:'Solicitudes abiertas hoy',v:fmt(open.length),sub:(()=>{const rv=open.filter(r=>r.estado==='revision').length;return (rv?`${rv} de consumo alto por aprobar · `:'')+(alta?`${alta} con prioridad alta`:'Ninguna con prioridad alta')})()})}
  </div>`;
  const hasReg=m.reg.length>0;
  h+=`<div class="sec"><h2>Actividad</h2><p>${w.days?`Últimos ${w.days} días`:'Todo el historial'}${S.cli?' · '+esc(cname(S.cli)):''}</p></div>`;
  if(!hasReg){h+=`<div class="card empty"><h3>Aún no hay avance registrado en este período</h3><p>Cada prospectora registra lo que investigó en «Registro de avance», y los cruces se pueden guardar con un clic desde el módulo de cruce. Esos registros alimentan estos gráficos.</p><button class="btn pri" data-act="new-reg">${ic('plus')} Registrar avance</button></div>`}
  else h+=`<div class="g21"><div class="card"><div class="ch"><div><h3>Empresas investigadas por prospectora</h3><p>${w.days&&w.days<=31?'Por día':'Por semana'}</p></div></div><div class="cw"><canvas id="chAct" aria-label="Empresas investigadas por prospectora"></canvas></div></div>
  <div class="card"><div class="ch"><div><h3>Resultado de los cruces</h3><p>Contactos nuevos frente a los que ya existían en HubSpot</p></div></div><div class="cw"><canvas id="chCx" aria-label="Resultado de cruces"></canvas></div></div></div>`;
  // equipo
  const base=roster().map(m=>String(m.email).toLowerCase());const tm=S.who?[S.who]:team().filter(id=>base.includes(id)||(()=>{const x=metrics(w.a,w.b,id);return x.empresas>0||x.creadas>0})());
  h+=`<div class="sec"><h2>Equipo</h2><p>Avance de cada prospectora frente a su meta semanal</p></div><div class="card">`;
  if(!tm.length)h+=`<div class="empty"><p>Las prospectoras aparecen aquí cuando crean su primera solicitud o registran avance.</p></div>`;
  else{h+=`<div class="tw"><table><thead><tr><th class="l">Prospectora</th><th>Solicitudes</th><th>Empresas</th><th>Contactos</th><th>Nuevos en cruce</th><th class="l">Meta de empresas</th></tr></thead><tbody>`;
    tm.forEach(id=>{const x=metrics(w.a,w.b,id);const mt=(meta.empresasSemana&&w.days)?meta.empresasSemana*w.days/7:null;const r=mt?x.empresas/mt:null;
      h+=`<tr class="click" data-who="${esc(id)}"><td class="l">${who(id)}</td><td>${fmt(x.creadas)}</td><td>${fmt(x.empresas)}</td><td>${fmt(x.contactos)}</td><td>${fmt(x.nuevos)}</td><td class="l">${r==null?'<span class="muted">Sin meta</span>':`<div class="pbar"><div class="bar"><i class="${r>=1?'g':r>=.7?'':'y'}" style="width:${Math.min(100,Math.round(r*100))}%"></i></div><span>${pct(r)}</span></div>`}</td></tr>`});
    h+='</tbody></table></div>'}
  h+='</div>';
  // clientes
  const cl=S.cli?allClients().filter(c=>c.id===S.cli):allClients();
  h+=`<div class="sec"><h2>Clientes</h2><p>Dónde se concentró el trabajo</p></div><div class="card">`;
  if(!cl.length)h+=`<div class="empty"><p>Las fichas de clientes se cargan desde los resúmenes de la carpeta de Drive del portal.</p><button class="btn" data-view="clientes">${ic('building')} Ver clientes</button></div>`;
  else{h+=`<div class="tw"><table><thead><tr><th class="l">Cliente</th><th>Solicitudes abiertas</th><th>Empresas</th><th>Contactos</th><th>Nuevos en cruce</th><th>Última actividad</th></tr></thead><tbody>`;
    cl.forEach(c=>{const reg=D.registro.filter(r=>r.clienteId===c.id&&(!S.who||keyOf(r)===S.who));const regp=reg.filter(r=>inR(r.fecha,w.a,w.b));const s=k=>regp.reduce((a,r)=>a+(+r[k]||0),0);const ab=D.solicitudes.filter(r=>r.clienteId===c.id&&isOpen(r)).length;const last=reg.reduce((mx,r)=>r.fecha>mx?r.fecha:mx,'');
      h+=`<tr class="${c.ficha?'click':''}" ${c.ficha?`data-cli="${esc(c.id)}"`:''}><td class="l"><span class="rt-title">${esc(c.nombre)}</span>${c.ficha?(c.ficha.industria?`<div class="rt-sub">${esc(c.ficha.industria)}</div>`:''):(c.ex?'<div class="rt-sub"><span class="tag">Ex cliente</span></div>':'<div class="rt-sub">Sin ficha</div>')}</td><td>${ab?`<span class="pill y">${ab}</span>`:'0'}</td><td>${fmt(s('empresas'))}</td><td>${fmt(s('contactos'))}</td><td>${fmt(s('nuevos'))}</td><td>${niceDate(last)}</td></tr>`});
    h+='</tbody></table></div>'}
  return h+'</div>';
};
function cssv(n){return getComputedStyle(ROOT).getPropertyValue(n).trim()}
AF.resumen=function(){
  if(!Chart||!$('#chAct'))return;
  const w=win(),reg=fReg(w.a,w.b);
  const daily=w.days&&w.days<=31;
  const wk=s=>{const d=new Date(s+'T12:00:00');const dd=(d.getDay()+6)%7;d.setDate(d.getDate()-dd);return ymd(d)};
  let keys=[];
  if(daily){for(let i=0;i<w.days;i++)keys.push(addDays(w.a,i))}
  else{const start=w.a||reg.reduce((m,r)=>r.fecha<m?r.fecha:m,TODAY());let k=wk(start);const end=wk(TODAY());while(k<=end){keys.push(k);k=addDays(k,7)}if(keys.length>26)keys=keys.slice(-26)}
  const bk=r=>daily?r.fecha:wk(r.fecha);
  const lbl=keys.map(k=>{const d=new Date(k+'T12:00:00');return d.toLocaleDateString('es-CL',{day:'numeric',month:'short'})});
  const muted=cssv('--muted'),grid=cssv('--border');
  Chart.defaults.font.family="Figtree, system-ui, sans-serif";Chart.defaults.color=muted;
  const PAL=[cssv('--primary'),cssv('--magenta'),cssv('--teal'),cssv('--orange'),'#7b5cff','#1e9bf0'];
  const ids=S.who?[S.who]:[...new Set(reg.map(keyOf))];
  const ds=ids.map((id,i)=>({label:pname(id),data:keys.map(k=>reg.filter(r=>keyOf(r)===id&&bk(r)===k).reduce((s,r)=>s+(+r.empresas||0),0)),backgroundColor:colorOf(id),borderRadius:4,maxBarThickness:28}));
  const opts={responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:10,boxHeight:10,usePointStyle:true}}},scales:{x:{stacked:true,grid:{display:false},ticks:{maxRotation:0,autoSkip:true,maxTicksLimit:10}},y:{stacked:true,beginAtZero:true,grid:{color:grid},ticks:{precision:0}}}};
  charts.push(new Chart($('#chAct'),{type:'bar',data:{labels:lbl,datasets:ds},options:opts}));
  const nv=keys.map(k=>reg.filter(r=>bk(r)===k).reduce((s,r)=>s+(+r.nuevos||0),0));
  const ex=keys.map(k=>reg.filter(r=>bk(r)===k).reduce((s,r)=>s+(+r.existentes||0),0));
  charts.push(new Chart($('#chCx'),{type:'bar',data:{labels:lbl,datasets:[{label:'Nuevos',data:nv,backgroundColor:cssv('--primary'),borderRadius:4,maxBarThickness:28},{label:'Ya en HubSpot',data:ex,backgroundColor:cssv('--faint'),borderRadius:4,maxBarThickness:28}]},options:opts}));
};

const MESES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
function yr(y,m1,m2,who){const a=`${y}-${z(m1)}-01`,b=`${y}-${z(m2)}-31`;const reg=fReg(a,b,who);const sum=k=>reg.reduce((s,r)=>s+(+r[k]||0),0);const months=new Set(reg.map(r=>r.fecha.slice(0,7)));return{reg,emp:sum('empresas'),meta:sum('meta'),cont:sum('contactos'),entregas:reg.length,clientes:new Set(reg.map(r=>r.clienteId)).size,personas:new Set(reg.map(keyOf).filter(Boolean)).size,meses:months.size,conCont:reg.filter(r=>+r.contactos>0).length}}
function varPct(a,b){if(!a||!isFinite(a)||b==null)return '<span class="muted">–</span>';const d=(b-a)/a;const cls=d>=0?'good':'bad';return `<span class="dl ${cls}">${d>=0?'▲':'▼'} ${Math.abs(Math.round(d*100))}%</span>`}
VF.comp=function(){
  if(offline)return noConn();if(!L.r)return loading();
  const has25=D.registro.some(r=>String(r.fecha).startsWith('2025'));
  if(!has25)return `<div class="card empty"><h3>Aún no hay datos de 2025</h3><p>La comparación aparece cuando el registro tiene entregas de ambos años.</p></div>`;
  const now=new Date();const lastClosed=now.getFullYear()===2026?now.getMonth():12; // meses cerrados de 2026 (oct en curso => 9)
  const q25=yr(2025,7,9),q26=yr(2026,7,9);
  const a25=yr(2025,7,12),a26=yr(2026,1,lastClosed);
  const avg=(o,n)=>n?o/n:null;
  const row=(lbl,v25,v26,fmtf,note)=>`<tr><td class="l"><span class="rt-title">${lbl}</span>${note?`<div class="rt-sub">${note}</div>`:''}</td><td>${fmtf(v25)}</td><td>${fmtf(v26)}</td><td>${typeof v25==='number'&&typeof v26==='number'?varPct(v25,v26):'<span class="muted">–</span>'}</td></tr>`;
  let h=`<p class="note">Para que la comparación sea justa: 2025 solo tiene datos desde julio, así que se comparan <b>los mismos meses (julio a septiembre)</b> de cada año y el <b>promedio mensual</b> de los meses cerrados (2025: jul–dic · 2026: ene–${MESES[lastClosed-1]}). Los contactos no se comparan: en 2025 solo se registraron en diciembre (${a25.conCont} de ${a25.entregas} entregas).</p>`;
  h+=`<div class="sec"><h2>Julio a septiembre</h2><p>Mismo trimestre en ambos años${S.cli?' · '+esc(cname(S.cli)):''}${S.who?' · '+esc(pname(S.who)):''}</p></div>
  <div class="card"><div class="tw"><table><thead><tr><th class="l">Indicador</th><th>2025</th><th>2026</th><th>Variación</th></tr></thead><tbody>
  ${row('Empresas entregadas',q25.emp,q26.emp,fmt)}
  ${row('Meta asignada',q25.meta,q26.meta,fmt)}
  ${row('Cumplimiento de meta',q25.meta?q25.emp/q25.meta:null,q26.meta?q26.emp/q26.meta:null,pct,'Empresas entregadas sobre meta')}
  ${row('Entregas realizadas',q25.entregas,q26.entregas,fmt,'Una entrega = un cliente en una semana')}
  ${row('Clientes atendidos',q25.clientes,q26.clientes,fmt)}
  ${row('Empresas por entrega',q25.entregas?q25.emp/q25.entregas:null,q26.entregas?q26.emp/q26.entregas:null,v=>v==null?'–':(Math.round(v*10)/10).toLocaleString('es-CL'))}
  </tbody></table></div></div>`;
  h+=`<div class="sec"><h2>Promedio mensual</h2><p>Meses cerrados de cada año</p></div>
  <div class="card"><div class="tw"><table><thead><tr><th class="l">Indicador</th><th>2025 (${a25.meses} meses)</th><th>2026 (${a26.meses} meses)</th><th>Variación</th></tr></thead><tbody>
  ${row('Empresas por mes',avg(a25.emp,a25.meses),avg(a26.emp,a26.meses),fmt)}
  ${row('Meta por mes',avg(a25.meta,a25.meses),avg(a26.meta,a26.meses),fmt)}
  ${row('Entregas por mes',avg(a25.entregas,a25.meses),avg(a26.entregas,a26.meses),fmt)}
  ${row('Cumplimiento de meta',a25.meta?a25.emp/a25.meta:null,a26.meta?a26.emp/a26.meta:null,pct)}
  </tbody></table></div></div>`;
  h+=`<div class="sec"><h2>Empresas entregadas por mes</h2></div><div class="card"><div class="cw"><canvas id="chComp" aria-label="Empresas por mes 2025 y 2026"></canvas></div></div>`;
  if(!S.who){const ids=team();
    h+=`<div class="sec"><h2>Por prospectora</h2><p>Julio a septiembre de cada año</p></div><div class="card"><div class="tw"><table><thead><tr><th class="l">Prospectora</th><th>Empresas 2025</th><th>Empresas 2026</th><th>Variación</th><th>Cumplimiento 2025</th><th>Cumplimiento 2026</th></tr></thead><tbody>${ids.map(id=>{const x=yr(2025,7,9,id),y=yr(2026,7,9,id);return `<tr><td class="l">${who(id)}</td><td>${fmt(x.emp)}</td><td>${fmt(y.emp)}</td><td>${varPct(x.emp,y.emp)}</td><td>${x.meta?pct(x.emp/x.meta):'–'}</td><td>${y.meta?pct(y.emp/y.meta):'–'}</td></tr>`}).join('')}</tbody></table></div></div>`}
  return h;
};
AF.comp=function(){
  if(!Chart||!$('#chComp'))return;
  const by=y=>MESES.map((_,i)=>fReg(`${y}-${z(i+1)}-01`,`${y}-${z(i+1)}-31`).reduce((s,r)=>s+(+r.empresas||0),0));
  const d25=by(2025).map((v,i)=>i<6?null:v),d26=by(2026).map((v,i)=>{const now=new Date();return (now.getFullYear()===2026&&i>now.getMonth())?null:v});
  const muted=cssv('--muted'),grid=cssv('--border');Chart.defaults.font.family="Figtree, system-ui, sans-serif";Chart.defaults.color=muted;
  charts.push(new Chart($('#chComp'),{type:'bar',data:{labels:MESES,datasets:[{label:'2025',data:d25,backgroundColor:cssv('--faint'),borderRadius:4,maxBarThickness:26},{label:'2026',data:d26,backgroundColor:cssv('--primary'),borderRadius:4,maxBarThickness:26}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:10,boxHeight:10,usePointStyle:true}},tooltip:{callbacks:{footer:items=>items[0]&&items[0].label==='oct'?'Octubre 2026 en curso':''}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:grid},ticks:{precision:0}}}}}));
};
VF.clientes=function(){
  if(offline)return noConn();if(!L.c)return loading();
  let h='';
  if(isAdmin)h+=`<div class="actions" style="margin-bottom:14px"><button class="btn" data-act="edit-cli">${ic('plus')} Agregar cliente</button></div>`;
  if(!D.clientes.length)return h+`<div class="card empty"><h3>Todavía no hay clientes cargados</h3><p>Las fichas se cargan desde los resúmenes de la carpeta de Drive «Portal Prospección – Clientes». Cuando estén listos, pídele a Claude que actualice los clientes del portal.</p>${isAdmin?`<button class="btn pri" data-act="edit-cli">${ic('plus')} Agregar cliente a mano</button>`:''}</div>`;
  const since=addDays(TODAY(),-29);
  h+='<div class="cgrid">';
  D.clientes.forEach(c=>{
    const ab=D.solicitudes.filter(r=>r.clienteId===c.id&&isOpen(r)).length;
    const reg=D.registro.filter(r=>r.clienteId===c.id);const last=reg.reduce((m,r)=>r.fecha>m?r.fecha:m,'');
    const emp=reg.filter(r=>r.fecha>=since).reduce((s,r)=>s+(+r.empresas||0),0);
    const est=c.estado==='pausado'?'<span class="pill n">Pausado</span>':'<span class="pill g">Activo</span>';
    h+=`<button class="ccard" data-cli="${esc(c.id)}"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><h3>${esc(c.nombre)}</h3>${est}</div>
      <div class="tags">${c.industria?`<span class="tag p">${esc(c.industria)}</span>`:''}${c.pais?`<span class="tag">${esc(c.pais)}</span>`:''}</div>
      ${c.icp?`<div class="muted" style="font-size:13px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(c.icp)}</div>`:''}
      <div class="stats"><div class="stat"><small>Abiertas</small><b>${ab}</b></div><div class="stat"><small>Empresas 30 d</small><b>${fmt(emp)}</b></div><div class="stat"><small>Última act.</small><b style="font-size:14px">${niceDate(last)}</b></div></div></button>`;
  });
  return h+'</div>';
};


/* ---------- cuentas aprobadas por el cliente ---------- */
const KEST={por_asignar:{t:'Por asignar',c:'n'},asignada:{t:'Asignada',c:'p'},en_prospeccion:{t:'En prospección',c:'y'},contactada:{t:'Contactada',c:'o'},reunion:{t:'Reunión agendada',c:'g'},descartada:{t:'Descartada',c:'r'}};
const KRESP={'Sí':{t:'Aprobada',c:'g'},'No':{t:'Rechazada',c:'r'},'Revisar':{t:'Por revisar',c:'y'},'Pendiente':{t:'Sin respuesta',c:'n'}};
const kresp=r=>KRESP[r.respuesta]?r.respuesta:'Pendiente';
function fCuentas(ignoreKf){return D.cuentas.filter(r=>(!S.cli||r.clienteId===S.cli)&&(S.kl==='todas'||r.lista===S.kl)&&(!S.who||String(r.prospectora||'').toLowerCase()===S.who)&&(ignoreKf||S.kf==='todas'||(S.kf==='aprobadas'&&kresp(r)==='Sí')||(S.kf==='revisar'&&kresp(r)==='Revisar')||(S.kf==='rechazadas'&&kresp(r)==='No')||(S.kf==='pendientes'&&kresp(r)==='Pendiente')))}
VF.cuentas=function(){
  if(offline)return noConn();if(!L.k)return loading();
  const base=fCuentas(true);
  if(!base.length)return `<div class="card empty"><h3>Aún no hay cuentas cargadas${S.cli?' para '+esc(cname(S.cli)):''}</h3><p>Cuando un cliente recibe su planilla de aprobación, sus empresas aparecen aquí. A medida que el cliente marca «Sí», «No» o «Revisar», la sincronización automática las actualiza y el equipo puede asignarlas y trabajarlas.</p></div>`;
  const c=k=>base.filter(r=>kresp(r)===k).length;
  const apr=base.filter(r=>kresp(r)==='Sí');const sinAsig=apr.filter(r=>!r.prospectora).length;
  const enTrab=apr.filter(r=>['asignada','en_prospeccion','contactada','reunion'].includes(r.estadoTrabajo)).length;
  const last=D.cuentas.reduce((m,r)=>String(r.sincronizado||'')>m?String(r.sincronizado):m,'');
  let h=`<div class="kgrid" style="margin-bottom:16px">
   ${kpi({hl:1,ic:'check',c:'g',t:'Aprobadas por el cliente',v:fmt(c('Sí'))+`<span class="of"> / ${fmt(base.length)}</span>`,bar:base.length?c('Sí')/base.length:null,sub:`${fmt(c('Pendiente'))} todavía sin respuesta`})}
   ${kpi({ic:'clock',c:'y',t:'Por revisar con el cliente',v:fmt(c('Revisar')),sub:'Marcadas «Revisar» en la planilla'})}
   ${kpi({ic:'x',c:'r',t:'Rechazadas',v:fmt(c('No')),sub:'No se prospectan'})}
   ${kpi({ic:'users',c:sinAsig?'r':'g',t:'Aprobadas sin prospectora',v:fmt(sinAsig),sub:`${fmt(enTrab)} ya en trabajo`})}
  </div>`;
  if(last)h+=`<p class="muted" style="font-size:12.5px;margin:-4px 0 12px">Última sincronización con la planilla del cliente: ${esc(new Date(last).toLocaleString('es-CL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</p>`;
  const rows=fCuentas().slice().sort((a,b)=>String(b.fechaRespuesta||'').localeCompare(String(a.fechaRespuesta||''))||String(a.prioridad).localeCompare(String(b.prioridad))||String(a.empresa).localeCompare(String(b.empresa),'es'));
  if(!rows.length)return h+`<div class="card empty"><h3>No hay cuentas en esta vista</h3><p>Cambia el filtro de respuesta o de lista.</p></div>`;
  const tm=team();
  h+=`<div class="card"><div class="tw"><table><thead><tr><th class="l">Empresa</th><th class="l">Lista</th><th class="l">Prioridad</th><th class="l">Respuesta del cliente</th><th class="l">Prospectora</th><th class="l">Estado de trabajo</th></tr></thead><tbody>`;
  rows.slice(0,400).forEach(r=>{const rp=KRESP[kresp(r)];const e=KEST[r.estadoTrabajo]||KEST.por_asignar;const can=isAdmin||(r.prospectora&&String(r.prospectora).toLowerCase()===myKey());
    const proSel=isAdmin?`<select data-k-pro="${esc(r.id)}" aria-label="Prospectora"><option value="">Sin asignar</option>${tm.map(id=>`<option value="${esc(id)}" ${String(r.prospectora||'').toLowerCase()===id?'selected':''}>${esc(pname(id))}</option>`).join('')}</select>`:(r.prospectora?who(String(r.prospectora).toLowerCase()):(kresp(r)==='Sí'?`<button class="btn sm" data-k-tomar="${esc(r.id)}">Tomarla</button>`:'<span class="muted">–</span>'));
    const estSel=can?`<select data-k-est="${esc(r.id)}" aria-label="Estado de trabajo">${Object.entries(KEST).map(([k,v])=>`<option value="${k}" ${(r.estadoTrabajo||'por_asignar')===k?'selected':''}>${v.t}</option>`).join('')}</select>`:`<span class="pill ${e.c}">${e.t}</span>`;
    h+=`<tr><td class="l" style="white-space:normal;min-width:220px"><button class="btn ghost sm" style="padding:0;border:0;font-weight:700;font-size:13.5px;text-align:left;white-space:normal" data-cuenta="${esc(r.id)}">${esc(r.empresa)}</button><div class="rt-sub">${esc(r.segmento||r.industria||'')}${r.tamano?' · '+esc(r.tamano)+' colab.':''}${S.cli?'':' · '+esc(cname(r.clienteId))}</div>${r.alertaInterna?`<div class="rt-sub" style="color:var(--o)">⚠ ${esc(r.alertaInterna)}</div>`:''}</td><td class="l">${esc(r.lista||'')}</td><td class="l"><span class="pill ${r.prioridad==='A'?'g':'n'}">${esc(r.prioridad||'–')}</span></td><td class="l" style="white-space:normal;max-width:240px"><span class="pill ${rp.c}">${rp.t}</span>${r.comentarioCliente?`<div class="rt-sub">«${esc(r.comentarioCliente)}»</div>`:''}${r.fechaRespuesta?`<div class="rt-sub">${niceDate(r.fechaRespuesta)}</div>`:''}</td><td class="l">${proSel}</td><td class="l">${estSel}</td></tr>`});
  h+='</tbody></table></div>';
  if(rows.length>400)h+=`<p class="muted" style="font-size:12px;margin:8px 0 0">Se muestran 400 de ${fmt(rows.length)} cuentas. Usa los filtros para acotar.</p>`;
  return h+'</div>';
};
function modalCuenta(id){
  const r=D.cuentas.find(x=>x.id===id);if(!r)return;const rp=KRESP[kresp(r)];
  const link=u=>u&&/^https?:\/\//i.test(u)?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,''))}</a>`:'';
  const web=r.web?link(/^https?:/i.test(r.web)?r.web:'https://'+r.web):'';
  openModal(mtop(r.empresa,`${esc(cname(r.clienteId))} · ${esc(r.lista||'')} · <span class="pill ${rp.c}">${rp.t}</span>`)+
  `<dl class="fld"><dt>Prioridad sugerida</dt><dd>${esc(r.prioridad||'–')}</dd><dt>Industria</dt><dd>${esc([r.industria,r.segmento].filter(Boolean).join(' · '))}</dd><dt>Tamaño</dt><dd>${esc(r.tamano||'–')} colaboradores</dd>${r.grupo?`<dt>Grupo</dt><dd>${esc(r.grupo)}</dd>`:''}${web?`<dt>Sitio web</dt><dd>${web}</dd>`:''}${r.linkedin?`<dt>LinkedIn</dt><dd>${link(r.linkedin)}</dd>`:''}<dt>Motivos de fit</dt><dd>${esc(r.motivos||'')}</dd>${r.observaciones?`<dt>Observaciones</dt><dd>${esc(r.observaciones)}</dd>`:''}${r.comentarioCliente?`<dt>Comentario del cliente</dt><dd>${esc(r.comentarioCliente)}</dd>`:''}${r.alertaInterna?`<dt>Alerta interna</dt><dd style="color:var(--o)">${esc(r.alertaInterna)}</dd>`:''}${r.fuenteInterna?`<dt>Prospectada antes para</dt><dd>${esc(r.fuenteInterna)}</dd>`:''}${r.contactos?`<dt>Contactos en base</dt><dd>${fmt(r.contactos)}</dd>`:''}</dl>
  <div class="mact"><button class="btn" data-act="close">Cerrar</button></div>`,true);
}

VF.solicitudes=function(){
  if(offline)return noConn();if(!L.s)return loading();
  let rows=fReq();
  if(S.rf==='abiertas')rows=rows.filter(isOpen);
  else if(S.rf==='lista')rows=rows.filter(r=>r.estado==='lista');
  if(S.rf==='abiertas'){const po={alta:0,media:1,baja:2};rows=rows.slice().sort((a,b)=>(a.estado==='revision'?0:1)-(b.estado==='revision'?0:1)||(po[a.prioridad]??1)-(po[b.prioridad]??1)||String(a.creado).localeCompare(String(b.creado)))}
  if(!rows.length){
    const msg=S.rf==='abiertas'?'No hay solicitudes abiertas':S.rf==='lista'?'Aún no hay solicitudes entregadas':'Aún no hay solicitudes';
    return `<div class="card empty"><h3>${msg}${S.cli||S.who?' con estos filtros':''}</h3><p>Pide un listado de empresas, la búsqueda de sitios web y perfiles de LinkedIn, un cruce entre bases o una limpieza de datos. Claude atiende la cola y deja el resultado aquí mismo para descargar.</p><button class="btn pri" data-act="new-req">${ic('plus')} Nueva solicitud</button></div>`;
  }
  let h='';const rev=D.solicitudes.filter(r=>r.estado==='revision');
  if(isAdmin&&rev.length)h+=`<div class="card" style="margin-bottom:14px;background:var(--r-soft);border-color:color-mix(in srgb,var(--r) 35%,transparent)"><b>${rev.length===1?'Hay 1 solicitud de consumo alto esperando tu aprobación':`Hay ${rev.length} solicitudes de consumo alto esperando tu aprobación`}.</b> <span class="muted">No se procesan hasta que las apruebes. Ábrelas para revisarlas.</span></div>`;
  h+=`<div class="card"><div class="tw"><table><thead><tr><th class="l">Solicitud</th><th class="l">Cliente</th><th class="l">Pidió</th><th class="l">Prioridad</th><th>Fecha límite</th><th>Entrega</th><th class="l">Consumo</th><th class="l">Estado</th></tr></thead><tbody>`;
  const t=TODAY();
  rows.forEach(r=>{const e=ESTADOS[r.estado]||ESTADOS.pendiente,p=PRIOS[r.prioridad]||PRIOS.media;const late=r.fechaLimite&&r.fechaLimite<t&&isOpen(r);
    h+=`<tr class="click" data-req="${esc(r.id)}"><td class="l"><div class="rt-title">${esc(r.titulo||'Sin título')}</div><div class="rt-sub">${esc(r.tipo||'')}${r.cantidad?' · ~'+fmt(r.cantidad)+' registros':''}${r.adjunto?' · lista adjunta de '+fmt(r.adjunto.filas)+' filas':''}${r.resultadoCount?' · '+fmt(r.resultadoCount)+' filas entregadas':''}${r.evaluacion?' · evaluada: '+({si:'sirvió',parcial:'en parte',no:'no sirvió'})[r.evaluacion.valor]:''}</div>${r.estado==='en_proceso'?barra(r):''}</td><td class="l">${esc(cname(r.clienteId))}</td><td class="l">${who(keyOf(r))}</td><td class="l"><span class="pill ${p.c}">${p.t}</span></td><td style="${late?'color:var(--r);font-weight:700':''}">${niceDate(r.fechaLimite)}${late?' · atrasada':''}</td><td>${(()=>{const et=etaTxt(r);const tarde=et.d&&r.fechaLimite&&ymd(et.d)>r.fechaLimite;return `<span style="${tarde?'color:var(--r);font-weight:700':''}">${esc(et.t)}</span>${et.s?`<div class="rt-sub">${et.s}${tarde?' · después del límite':''}</div>`:''}`})()}</td><td class="l">${r.consumo?`<span class="pill ${CONSUMO[r.consumo].c}">${CONSUMO[r.consumo].t}</span>`:'–'}</td><td class="l"><span class="pill ${e.c}">${e.t}</span></td></tr>`});
  return h+'</tbody></table></div></div>';
};

const VIDEO_AVANCE='https://claude.ai/artifact/FCpkgNaYPL2VTtayWHRhnQ';
const MOTIVOS=['Sin empresas aprobadas','Esperando aprobación del KAM o del cliente','El cliente pausó la prospección','Ausencia de la prospectora','Problema con una herramienta','Otro'];
const LIDERES=['amadriz@bullseye-abm.com','ihincapie@bullseye-abm.com'];
const isLead=()=>isAdmin||LIDERES.includes(myMail());
const PEST={planificada:{t:'Planificada',c:'n'},entregada:{t:'Entregada',c:'g'},sin_gestion:{t:'Sin gestión',c:'r'}};
const mondayOf=d=>{const x=new Date((d||TODAY())+'T12:00:00');x.setDate(x.getDate()-((x.getDay()+6)%7));return ymd(x)};
S.sem=mondayOf();
const vigentes=()=>allClients().filter(c=>!c.ex);
const canRow=r=>isAdmin||(r.email&&r.email===myKey());
VF.plan=function(){
  if(offline)return noConn();if(!L.p)return loading();
  const wk=S.sem,fin=addDays(wk,4);
  let rows=D.plan.filter(r=>r.semana===wk&&(!S.cli||r.clienteId===S.cli)&&(!S.who||r.email===S.who));
  rows=rows.slice().sort((a,b)=>pname(a.email).localeCompare(pname(b.email),'es')||cname(a.clienteId).localeCompare(cname(b.clienteId),'es'));
  const cnt=k=>rows.filter(r=>r.estado===k).length;const meta=rows.reduce((s,r)=>s+(+r.meta||0),0),ent=rows.reduce((s,r)=>s+(+r.empresas||0),0);
  const cerradas=cnt('entregada')+cnt('sin_gestion');
  let h=`<div class="actions" style="justify-content:space-between;margin-bottom:14px"><div class="actions"><button class="btn sm" data-act="sem-prev" aria-label="Semana anterior">◀</button><b style="font-family:var(--head);font-size:16px">Semana del ${niceDate(wk)} al ${niceDate(fin)}</b><button class="btn sm" data-act="sem-next" aria-label="Semana siguiente">▶</button>${wk!==mondayOf()?'<button class="btn ghost sm" data-act="sem-hoy">Esta semana</button>':''}</div>
  ${isAdmin?`<div class="actions"><button class="btn" data-act="plan-copy">Copiar semana anterior</button><button class="btn pri" data-act="plan-add">${ic('plus')} Agregar asignación</button></div>`:''}</div>
  ${ferCard(wk)}${propCard(wk)}${miSemana(wk)}<div class="kgrid" style="margin-bottom:16px">
   ${kpi({ic:'target',t:'Asignaciones',v:fmt(rows.length),sub:`${fmt(cnt('planificada'))} por cerrar`})}
   ${kpi({ic:'building',hl:1,t:'Empresas entregadas',v:fmt(ent)+(meta?`<span class="of"> / ${fmt(meta)}</span>`:''),bar:meta?ent/meta:null,sub:meta?`${pct(ent/meta)} de la meta de la semana`:'Sin metas asignadas'})}
   ${kpi({ic:'check',c:'g',t:'Entregadas',v:fmt(cnt('entregada')),sub:'Asignaciones con entrega registrada'})}
   ${kpi({ic:'clock',c:cnt('sin_gestion')?'r':'',t:'Sin gestión',v:fmt(cnt('sin_gestion')),sub:cerradas?`${pct(cnt('sin_gestion')/cerradas)} de las cerradas · objetivo 2027: 15% o menos`:'Objetivo 2027: 15% o menos'})}
  </div>`;
  if(!rows.length)return h+`<div class="card empty"><h3>No hay asignaciones para esta semana</h3><p>${isAdmin?'Agrega la meta de cada prospectora por cliente, o copia la semana anterior y ajústala.':'Tu líder aún no carga el plan de esta semana.'}</p>${isAdmin?`<div class="actions" style="justify-content:center"><button class="btn" data-act="plan-copy">Copiar semana anterior</button><button class="btn pri" data-act="plan-add">${ic('plus')} Agregar asignación</button></div>`:''}</div>`;
  h+=`<div class="card"><div class="tw"><table><thead><tr><th class="l">Prospectora</th><th class="l">Cliente</th><th>Meta</th><th>Entregadas</th><th class="l">Estado</th><th class="l">Motivo o nota</th><th></th></tr></thead><tbody>`;
  rows.forEach(r=>{const e=PEST[r.estado]||PEST.planificada;const can=canRow(r);
    let act='';
    if(can&&r.estado==='planificada')act=`<button class="btn sm pri" data-plan-ent="${esc(r.id)}">Registrar entrega</button> <button class="btn sm" data-plan-sg="${esc(r.id)}">Sin gestión</button>`;
    else if(isAdmin)act=`<button class="btn ghost sm" data-plan-reopen="${esc(r.id)}">Reabrir</button>`;
    if(isAdmin&&r.estado==='planificada')act+=` <button class="btn ghost sm danger" data-plan-del="${esc(r.id)}">Quitar</button>`;
    h+=`<tr><td class="l">${who(r.email)}</td><td class="l">${esc(cname(r.clienteId))}</td><td>${fmt(r.meta)}</td><td>${r.estado==='entregada'?fmt(r.empresas):r.avance?`<span class="muted">${fmt(r.avance)} en curso</span>`:'–'}</td><td class="l"><span class="pill ${e.c}">${e.t}</span></td><td class="l" style="white-space:normal;max-width:280px;color:var(--muted)">${esc(r.motivo?(r.motivo+(r.detalle?': '+r.detalle:'')):(r.nota||''))}</td><td style="white-space:nowrap">${act}</td></tr>`});
  return h+'</tbody></table></div></div>';
};
function propCard(wk){
  if(!isLead())return '';
  const rows=(D.prop||[]).filter(r=>r.semana===wk).sort((a,b)=>String(pname(a.email)).localeCompare(String(pname(b.email)),'es')||(+a.prioridad||9)-(+b.prioridad||9));
  if(!rows.length)return '';
  const tm=team();
  const tot=tm.map(e=>{const META=metaAj(e,wk);const n=rows.filter(r=>r.email===e).reduce((s,r)=>s+(+r.meta||0),0);return `<span class="pill ${n>META?'r':n===META?'g':'n'}">${esc(pname(e))}: ${fmt(n)} / ${META}</span>`}).join(' ');
  const cl=vigentes();
  const tr=rows.map(r=>`<tr>
   <td><select data-pp="email" data-id="${esc(r.id)}" aria-label="Prospectora">${tm.map(e=>`<option value="${esc(e)}" ${e===r.email?'selected':''}>${esc(pname(e))}</option>`).join('')}</select></td>
   <td><select data-pp="clienteId" data-id="${esc(r.id)}" aria-label="Cliente">${cl.map(c=>`<option value="${esc(c.id)}" ${c.id===r.clienteId?'selected':''}>${esc(c.nombre)}</option>`).join('')}${cl.some(c=>c.id===r.clienteId)?'':`<option selected value="${esc(r.clienteId)}">${esc(cname(r.clienteId))}</option>`}</select></td>
   <td><input data-pp="meta" data-id="${esc(r.id)}" type="number" min="0" step="5" value="${esc(r.meta||0)}" style="width:76px" aria-label="Meta"></td>
   <td><input data-pp="prioridad" data-id="${esc(r.id)}" type="number" min="1" step="1" value="${esc(r.prioridad||'')}" style="width:56px" aria-label="Prioridad"></td>
   <td><input data-pp="nota" data-id="${esc(r.id)}" value="${esc(r.nota||'')}" maxlength="200" style="width:100%;min-width:180px" aria-label="Nota"></td>
   <td><button class="btn ghost sm" data-pp-del="${esc(r.id)}">Quitar</button></td></tr>`).join('');
  const ap=rows.find(r=>r.propuestaPor);
  return `<div class="card pp" style="border:2px dashed var(--border);margin-bottom:16px">
   <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><h3 style="margin:0 0 4px">Propuesta · pendiente de aprobación</h3>
   <p class="hint" style="margin:0">Distribución sugerida para la semana del ${niceDate(wk)}. Solo la ven los líderes. Los cambios se guardan al editar cada campo; las prospectoras la verán cuando la apruebes.</p></div>
   <div style="display:flex;gap:6px;flex-wrap:wrap">${tot}</div></div>
   <div class="tw" style="margin-top:12px"><table><thead><tr><th>Prospectora</th><th>Cliente</th><th>Meta</th><th>Prior.</th><th>Motivo / nota</th><th></th></tr></thead><tbody>${tr}</tbody></table></div>
   <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;justify-content:flex-end">
    <button class="btn ghost" data-pp-act="add">${ic('plus')} Agregar fila</button>
    <button class="btn ghost" data-pp-act="discard">Descartar propuesta</button>
    <button class="btn pri" data-pp-act="ok">Aprobar y publicar</button></div></div>`;
}
async function propAct(t){
  const wk=S.sem;const rows=(D.prop||[]).filter(r=>r.semana===wk);const now=new Date().toISOString();
  const a=t.dataset.ppAct;
  if(a==='add'){const tm=team(),cl=vigentes();if(!tm.length||!cl.length)return;
    await write(()=>db.collection('plan').add({semana:wk,email:tm[0],clienteId:cl[0].id,meta:20,prioridad:rows.length+1,nota:'',estado:'propuesta',creado:now,actualizado:now}),'Fila agregada');return}
  if(t.dataset.sure!=='1'){t.dataset.sure='1';t.textContent=a==='ok'?'¿Confirmas? Se publica a las prospectoras':'¿Confirmas descartar todo?';return}
  if(a==='discard'){for(const r of rows){const ok=await write(()=>db.doc('plan/'+r.id).delete());if(!ok)return}toast('Propuesta descartada');return}
  if(a==='ok'){let n=0;for(const r of rows){
      const dup=D.plan.find(x=>x.semana===wk&&x.email===r.email&&x.clienteId===r.clienteId);
      const ok=dup?await write(()=>db.doc('plan/'+r.id).delete()):await write(()=>db.doc('plan/'+r.id).update({estado:'planificada',aprobada:now,aprobadaPor:myMail()||'líder',actualizado:now}));
      if(!ok)return;if(!dup)n++}
    toast(`Propuesta aprobada: ${n} asignaciones publicadas`)}
}
/* ---------- efectividad (solo líderes) ---------- */
function efeLoad(force){
  if(!force&&(D.efe||D.efeLoading))return;D.efeLoading=true;
  db.collection('config').where('tipo','==','efectividad').get().then(s=>{D.efe=s.docs.map(d=>Object.assign({id:d.id},d.data())).sort((a,b)=>String(b.semana).localeCompare(String(a.semana)));D.efeLoading=false;sched()}).catch(()=>{D.efe=[];D.efeLoading=false;sched()});
}
const efePct=v=>v==null?'–':(Math.round(v*10)/10).toLocaleString('es-CL')+'%';
VF.efectividad=function(){
  if(!isLead())return `<div class="card empty"><h3>Sección reservada</h3><p>Esta vista está disponible solo para la líder y la jefatura.</p></div>`;
  if(offline)return noConn();
  efeLoad();if(!D.efe)return loading();
  if(!D.efe.length)return `<div class="card empty"><h3>Aún no hay mediciones</h3><p>El índice se calcula cada lunes a las 8:00 (Chile) con lo que el equipo subió a HubSpot la semana anterior.</p></div>`;
  const wk=D.efe.some(e=>e.semana===S.efeSem)?S.efeSem:D.efe[0].semana;S.efeSem=wk;
  const W=D.efe.find(e=>e.semana===wk);const fin=addDays(wk,6);
  const weeks=D.efe.slice().sort((a,b)=>String(a.semana).localeCompare(String(b.semana))).slice(-8);
  const pros=[...new Set(D.efe.flatMap(e=>(e.totales||[]).map(t=>t.email)))];
  const nom=em=>{for(const e of D.efe)for(const t of (e.totales||[]))if(t.email===em)return t.prospectora;return pname(em)};
  let h=`<div class="actions" style="justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px"><div class="actions"><label class="muted" for="efeSem" style="font-size:13px">Semana</label><select id="efeSem">${D.efe.map(e=>`<option value="${esc(e.semana)}" ${e.semana===wk?'selected':''}>${esc(niceDate(e.semana))} al ${esc(niceDate(addDays(e.semana,6)))}</option>`).join('')}</select></div><span class="muted" style="font-size:12.5px">Visible solo para líderes · fuente: HubSpot · calculado el ${esc(niceDate(W.generado))}</span></div>`;
  h+=`<div class="kgrid" style="margin-bottom:16px">${(W.totales||[]).map(t=>kpi({ic:'chart',t:t.prospectora,v:`${efePct(t.indice)}<span class="of"> ${esc(t.calif||'–')}</span>`,sub:`${fmt(t.empresas)} empresas de ${fmt(t.meta||120)} · ${fmt(t.contactos)} contactos${t.sinCliente?` · ${fmt(t.sinCliente)} sin cliente en HubSpot`:''}`})).join('')}</div>`;
  h+=`<div class="card" style="margin-bottom:16px"><div class="ch"><div><h3>Detalle por cliente · semana del ${esc(niceDate(wk))} al ${esc(niceDate(fin))}</h3><p>Índice = 40% empresas dentro del ICP + 30% cargo objetivo + 10% correo + 10% teléfono cargado por la prospectora + 10% LinkedIn.</p></div></div><div class="tw"><table><thead><tr><th>Prospectora</th><th>Cliente</th><th>Empresas</th><th>Contactos</th><th>ICP</th><th>Cargo</th><th>Correo</th><th>Teléfono</th><th>LinkedIn</th><th>Índice</th><th>Calificación</th><th></th></tr></thead><tbody>${(W.filas||[]).map((f,i)=>`<tr><td>${esc(f.prospectora)}</td><td>${esc(f.clienteId?cname(f.clienteId):f.clienteHS)}</td><td>${fmt(f.empresas)}${f.meta?`<span class="muted"> / ${fmt(f.meta)}</span>`:''}</td><td>${fmt(f.contactos)}</td><td>${efePct(f.icpPct)}</td><td>${efePct(f.cargoPct)}</td><td>${efePct(f.emailPct)}</td><td>${efePct(f.telPct)}</td><td>${efePct(f.liPct)}</td><td><b>${efePct(f.indice)}</b></td><td>${esc(f.calif||'–')}</td><td>${f.clienteId?`<button class="btn ghost sm" data-efe-det="${i}">Ver detalle</button>`:''}</td></tr>`).join('')}</tbody></table></div><p class="muted" style="font-size:12.5px;margin-top:10px">«Sin ficha» o «Sin cliente»: contactos sin cliente BullsEye en HubSpot o de un cliente sin ficha en el portal; no entran al índice. La meta por cliente aparece cuando la semana tiene plan aprobado en el portal; la meta total es 120 empresas por prospectora.</p></div>`;
  h+=`<div class="card" style="margin-bottom:16px"><div class="ch"><div><h3>Evolución del índice</h3><p>Últimas ${weeks.length} semanas</p></div></div><div class="tw"><table><thead><tr><th>Prospectora</th>${weeks.map(e=>`<th>${esc(niceDate(e.semana))}</th>`).join('')}</tr></thead><tbody>${pros.map(em=>`<tr><td>${esc(nom(em))}</td>${weeks.map(e=>{const t=(e.totales||[]).find(x=>x.email===em);return `<td>${t&&t.indice!=null?`<b>${efePct(t.indice)}</b><div class="muted" style="font-size:11.5px">${esc(t.calif)} · ${fmt(t.empresas)} emp.</div>`:'<span class="muted">–</span>'}</td>`}).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  h+=`<div class="card"><h3 style="margin-top:0">Cómo se calcula</h3><ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.6">
   <li><b>Empresas dentro del ICP (40%)</b>: industria, tamaño mínimo y país según la ficha del cliente, más sus exclusiones. Datos de la empresa en HubSpot; si faltan, se completan con búsqueda web.</li>
   <li><b>Cargo objetivo (30%)</b>: área y nivel que pide la ficha (decisores e influenciadores); no cuentan analistas, asistentes ni ejecutivos.</li>
   <li><b>Datos de contacto (30%)</b>: correo, teléfono cargado por la prospectora (campos Teléfono o Móvil; no cuentan los de Lemlist, Lusha ni Clay) y LinkedIn, 10% cada uno.</li>
   <li><b>Calificación</b>: Excelente = 100% · Buena = 80% a 99% · Regular = 60% a 79% · Deficiente = bajo 60%.</li>
   <li>Vigatec, Crossnet y BullsEye tienen el ICP sin definir en su ficha: se usó la referencia pública y es provisorio.</li></ul></div>`;
  return h;
};
function modalEfe(i){
  const W=(D.efe||[]).find(e=>e.semana===S.efeSem);const f=W&&W.filas[+i];if(!f)return;
  const li=(arr,fn)=>arr&&arr.length?`<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.55">${arr.map(fn).join('')}</ul>`:'<p class="muted" style="font-size:13px">Sin observaciones.</p>';
  openModal(mtop(`${f.prospectora} · ${f.clienteId?cname(f.clienteId):f.clienteHS}`,`Semana del ${esc(niceDate(W.semana))} · índice ${efePct(f.indice)} (${esc(f.calif)})`)+
  `<div style="display:grid;gap:14px"><div><b>Empresas fuera del ICP</b> <span class="muted">${fmt(f.fueraICPTotal||0)} de ${fmt(f.empresas)}</span>${(f.motivosICP||[]).length?`<div class="muted" style="font-size:12.5px;margin-top:4px">Motivos más comunes: ${f.motivosICP.map(m=>esc(m[0])+' ('+fmt(m[1])+')').join(' · ')}</div>`:''}${li(f.fueraICP,x=>`<li><b>${esc(x[0])}</b>: ${esc(x[1])}</li>`)}${(f.fueraICPTotal||0)>(f.fueraICP||[]).length?`<p class="muted" style="font-size:12px">Se muestran las primeras ${fmt(f.fueraICP.length)}.</p>`:''}</div>
   <div><b>Contactos con cargo fuera del objetivo</b> <span class="muted">${fmt(f.cargosFueraTotal||0)} de ${fmt(f.contactos)}</span>${li(f.cargosFuera,x=>`<li>${esc(x[0])} <span class="muted">· ${esc(x[1])}${x[2]?' · '+esc(x[2]):''}</span></li>`)}${(f.cargosFueraTotal||0)>(f.cargosFuera||[]).length?`<p class="muted" style="font-size:12px">Se muestran los primeros ${fmt(f.cargosFuera.length)}.</p>`:''}</div>
   <div class="muted" style="font-size:12.5px">Teléfono contando también Lemlist, Lusha y Clay: ${efePct(f.telTodosPct)} (no entra al índice).</div></div>`,true);
}
/* ---------- feriados y días hábiles ---------- */
const DOW=['dom','lun','mar','mié','jue','vie','sáb'];
const metaBase=()=>(D.metas&&+D.metas.empresasSemana)||120;
const paisDe=em=>((D.fer&&D.fer.paises)||{})[String(em||'').toLowerCase()]||'';
function diasLab(em,wk){
  const p=paisDe(em);const fer=((D.fer&&D.fer.feriados)||{})[p]||[];const aus=((D.fer&&D.fer.ausencias)||[]).filter(a=>String(a.email||'').toLowerCase()===String(em||'').toLowerCase());
  const libres=[];let dias=0;
  for(let i=0;i<5;i++){const d=addDays(wk,i);const f=fer.find(x=>x[0]===d);const a=aus.find(x=>d>=x.desde&&d<=(x.hasta||x.desde));
    if(f)libres.push({fecha:d,motivo:f[1],tipo:'feriado'});else if(a)libres.push({fecha:d,motivo:a.motivo||'Ausencia',tipo:'ausencia'});else dias++}
  return{dias,libres,pais:p};
}
const metaAj=(em,wk)=>Math.round(metaBase()*diasLab(em,wk).dias/5);
const libTxt=l=>l.map(x=>`${DOW[new Date(x.fecha+'T12:00:00').getDay()]} ${niceDate(x.fecha)} ${x.motivo}`).join(' · ');
function ferCard(wk){
  if(!isLead())return '';const tm=team();if(!tm.length)return '';
  const rows=tm.map(em=>{const d=diasLab(em,wk);return `<tr><td class="l"><b>${esc(pname(em))}</b><div class="rt-sub">${esc(d.pais||'País sin definir')}</div></td><td>${fmt(d.dias)} de 5</td><td class="l">${d.libres.length?esc(libTxt(d.libres)):'<span class="muted">Sin feriados ni ausencias</span>'}</td><td><b>${fmt(metaAj(em,wk))}</b><span class="muted"> empresas</span></td></tr>`}).join('');
  return `<div class="card" style="margin-bottom:16px"><div class="ch"><div><h3>Días hábiles y meta ajustada</h3><p>Meta = ${fmt(metaBase())} empresas por semana ÷ 5 días × días hábiles de cada prospectora, según los feriados de su país y sus ausencias.</p></div>${isAdmin?`<button class="btn sm" data-act="fer-edit">Feriados y ausencias</button>`:''}</div><div class="tw"><table><thead><tr><th class="l">Prospectora</th><th>Días hábiles</th><th class="l">Feriados y ausencias</th><th>Meta de la semana</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function modalFer(){
  const F=D.fer||{};const paises=['Chile','Perú','Colombia'];
  const ferTxt=p=>((F.feriados||{})[p]||[]).map(x=>x[0]+' '+x[1]).join('\n');
  const ausTxt=(F.ausencias||[]).map(a=>[pname(a.email),a.desde,a.hasta||a.desde,a.motivo||''].join(', ')).join('\n');
  openModal(mtop('Feriados y ausencias','La meta semanal de cada prospectora se ajusta según los días hábiles de su país y sus ausencias.')+
  `<form class="form" id="fFer"><label class="full">País de cada prospectora <span class="hint">Una por línea: «Nombre, País»</span><textarea id="fe-p" style="min-height:80px">${esc(team().map(em=>pname(em)+', '+(paisDe(em)||'')).join('\n'))}</textarea></label>
   ${paises.map(p=>`<label>Feriados de ${p} <span class="hint">Una fecha por línea: «AAAA-MM-DD Nombre»</span><textarea id="fe-${p}" style="min-height:140px">${esc(ferTxt(p))}</textarea></label>`).join('')}
   <label class="full">Vacaciones y permisos <span class="hint">Una por línea: «Nombre, desde AAAA-MM-DD, hasta AAAA-MM-DD, motivo»</span><textarea id="fe-a" style="min-height:90px" placeholder="Nasly, 2026-12-14, 2026-12-18, Vacaciones">${esc(ausTxt)}</textarea></label>
   <p class="err-text full" id="fe-err" hidden></p>
   <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri">Guardar</button></div></form>`,true);
  $('#fFer').addEventListener('submit',async e=>{e.preventDefault();const errs=[];const tm=team();
    const byName=n=>{n=String(n||'').trim().toLowerCase();return tm.find(em=>pname(em).toLowerCase()===n||em===n||pname(em).toLowerCase().split(' ')[0]===n)||''};
    const pa={};$('#fe-p').value.split('\n').map(l=>l.trim()).filter(Boolean).forEach(l=>{const [n,p]=l.split(/[,;]/).map(x=>x.trim());const em=byName(n);if(!em)errs.push('No reconozco a «'+n+'»');else if(!paises.includes(p))errs.push('País no válido para '+n+': usa Chile, Perú o Colombia');else pa[em]=p});
    const fer={};paises.forEach(p=>{fer[p]=$('#fe-'+p).value.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const m=l.match(/^(\d{4}-\d{2}-\d{2})\s*[-,;:]?\s*(.*)$/);if(!m){errs.push('Fecha no válida en '+p+': «'+l+'»');return null}return[m[1],m[2]||'Feriado']}).filter(Boolean).sort((a,b)=>a[0].localeCompare(b[0]))});
    const aus=$('#fe-a').value.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const [n,d1,d2,...mo]=l.split(',').map(x=>x.trim());const em=byName(n);if(!em||!/^\d{4}-\d{2}-\d{2}$/.test(d1||'')||(d2&&!/^\d{4}-\d{2}-\d{2}$/.test(d2))){errs.push('Ausencia no válida: «'+l+'»');return null}return{email:em,desde:d1,hasta:d2||d1,motivo:mo.join(', ')||'Ausencia'}}).filter(Boolean);
    if(errs.length){const el=$('#fe-err');el.textContent=errs.slice(0,4).join(' · ');el.hidden=false;return}
    const ok=await write(()=>db.doc('config/feriados').set(Object.assign({},F,{tipo:'feriados',paises:pa,feriados:fer,ausencias:aus,actualizado:new Date().toISOString()})),'Feriados y ausencias guardados');if(ok)closeModal()});
}
function modalPlanAdd(){
  const tm=team();
  openModal(mtop('Agregar asignación',`Semana del ${niceDate(S.sem)}. Una asignación es un cliente para una prospectora en la semana.`)+
  `<form class="form" id="fPa"><label>Prospectora<select id="pa-p" required>${tm.map(id=>`<option value="${esc(id)}">${esc(pname(id))}</option>`).join('')}</select></label>
   <label>Cliente<select id="pa-c" required>${vigentes().map(c=>`<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}</select></label>
   <label>Meta de empresas<input id="pa-m" type="number" min="0" step="1" value="30" required></label>
   <label>Nota <span class="hint">Opcional</span><input id="pa-n" maxlength="200" placeholder="Ej.: foco en industria financiera"></label>
   <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri">Guardar asignación</button></div></form>`);
  $('#fPa').addEventListener('submit',async e=>{e.preventDefault();const em=$('#pa-p').value,c=$('#pa-c').value;
    if(D.plan.some(r=>r.semana===S.sem&&r.email===em&&r.clienteId===c)){toast('Esa prospectora ya tiene este cliente asignado esta semana.',true);return}
    const ok=await write(()=>db.collection('plan').add({semana:S.sem,email:em,clienteId:c,meta:Math.max(0,+$('#pa-m').value||0),nota:$('#pa-n').value.trim(),estado:'planificada',creado:new Date().toISOString(),actualizado:new Date().toISOString()}),'Asignación agregada');if(ok)closeModal()});
}
async function planCopy(){
  const prev=addDays(S.sem,-7);const src=D.plan.filter(r=>r.semana===prev);
  if(!src.length){toast('La semana anterior no tiene asignaciones para copiar.',true);return}
  const nuevos=src.filter(r=>!D.plan.some(x=>x.semana===S.sem&&x.email===r.email&&x.clienteId===r.clienteId));
  if(!nuevos.length){toast('Esta semana ya tiene todas las asignaciones de la anterior.');return}
  for(const r of nuevos){const ok=await write(()=>db.collection('plan').add({semana:S.sem,email:r.email,clienteId:r.clienteId,meta:+r.meta||0,nota:r.nota||'',estado:'planificada',creado:new Date().toISOString(),actualizado:new Date().toISOString()}));if(!ok)return}
  toast(`${nuevos.length} asignaciones copiadas`);
}
function modalPlanEnt(id){
  const r=D.plan.find(x=>x.id===id);if(!r)return;
  openModal(mtop('Registrar entrega',`${esc(cname(r.clienteId))} · semana del ${niceDate(r.semana)} · meta ${fmt(r.meta)} empresas`)+
  `<form class="form" id="fPe"><label>Empresas entregadas<input id="pe-e" type="number" min="0" step="1" value="${esc(r.avance!=null?r.avance:(r.meta||0))}" required></label><label>Contactos encontrados<input id="pe-c" type="number" min="0" step="1" value="${esc(r.contactosAvance||0)}"></label>
   <label class="full">Nota <span class="hint">Opcional; explica si quedaste bajo la meta</span><textarea id="pe-n" maxlength="1000"></textarea></label>
   <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri" id="pe-s">Guardar entrega</button></div></form>`);
  $('#fPe').addEventListener('submit',async e=>{e.preventDefault();const emp=Math.max(0,Math.round(+$('#pe-e').value||0)),con=Math.max(0,Math.round(+$('#pe-c').value||0));const nota=$('#pe-n').value.trim();
    if(emp<(+r.meta||0)&&!nota){toast('Quedaste bajo la meta: agrega una nota con el motivo.',true);$('#pe-n').focus();return}
    $('#pe-s').disabled=true;const now=new Date().toISOString();const rref=db.collection('registro').doc();
    const ok1=await write(()=>rref.set({por:myId||'',email:r.email,fecha:TODAY()<addDays(r.semana,4)?TODAY():addDays(r.semana,4),clienteId:r.clienteId,empresas:emp,contactos:con,cargados:0,nuevos:0,existentes:0,revisar:0,meta:+r.meta||0,fuente:'plan',planId:r.id,nota,creado:now}));
    if(!ok1){$('#pe-s').disabled=false;return}
    const ok=await write(()=>db.doc('plan/'+r.id).update({estado:'entregada',empresas:emp,contactos:con,nota,registroId:rref.id,actualizado:now}),'Entrega registrada');if(ok)closeModal()});
}
function miSemana(wk){
  const vid=`<a class="mw-vid" href="${VIDEO_AVANCE}" target="_blank" rel="noopener"><span class="mw-play">▶</span><span><b>¿Cómo registro mi avance?</b> Mira el video de 20 segundos</span></a>`;
  if(isAdmin)return`<div class="mw-vid-admin"><div class="muted" style="font-size:12px;margin-bottom:6px">Así ven las prospectoras el video en «Mi semana»:</div>${vid}</div>`;const me=myKey();if(!me)return'';
  const mine=D.plan.filter(r=>r.semana===wk&&r.email===me).sort((a,b)=>(+a.prioridad||9)-(+b.prioridad||9)||cname(a.clienteId).localeCompare(cname(b.clienteId),'es'));
  if(!mine.length)return'';
  const dl=diasLab(me,wk);const metaSem=metaAj(me,wk)||mine.reduce((s,r)=>s+(+r.meta||0),0);
  const hechas=mine.reduce((s,r)=>s+(r.estado==='entregada'?(+r.empresas||0):(+r.avance||0)),0);
  const pc=metaSem?Math.min(1,hechas/metaSem):0;const falt=Math.max(0,metaSem-hechas);
  const esta=wk===mondayOf();
  let h=`<div class="card" style="margin-bottom:16px"><div class="mw-hero"><div><div class="muted" style="font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em">${esta?'Tu semana':'Tu semana del '+niceDate(wk)}</div><div class="mw-big">${fmt(hechas)} <span>de ${fmt(metaSem)} empresas</span></div>${dl.libres.length?`<div class="muted" style="font-size:12.5px;margin-top:4px">Semana de ${dl.dias} días hábiles: ${esc(libTxt(dl.libres))}</div>`:''}</div><div style="flex:1;min-width:200px"><div class="bar" style="height:12px"><i class="${pc>=1?'g':pc>=.7?'':'y'}" style="width:${Math.round(pc*100)}%"></i></div><div class="mw-n">${pc>=1?'¡Meta cumplida! Buen trabajo.':`Te faltan ${fmt(falt)} empresas. Cuando avances en un cliente, toca «Sumar avance».`}</div></div></div>${vid}<div class="mw">`;
  mine.forEach(r=>{const av=r.estado==='entregada'?(+r.empresas||0):(+r.avance||0);const m=+r.meta||0;const p=m?Math.min(1,av/m):0;
    let cls='',btn='',info='';
    if(r.estado==='entregada'){cls='ok';info=`✓ Terminado: ${fmt(r.empresas)} empresas y ${fmt(r.contactos||0)} contactos.`;}
    else if(r.estado==='sin_gestion'){cls='sg';info=`Sin gestión: ${esc(r.motivo||'')}${r.detalle?' · '+esc(r.detalle):''}`;}
    else{info=av?`Llevas ${fmt(av)} de ${fmt(m)} empresas${r.contactosAvance?` y ${fmt(r.contactosAvance)} contactos`:''}.`:`Aún sin avance registrado.`;
      btn=`<button class="btn pri" data-plan-av="${esc(r.id)}">${ic('plus')} Sumar avance</button><button class="btn" data-plan-ent="${esc(r.id)}">Terminé este cliente</button><button class="btn ghost sm" data-plan-sg="${esc(r.id)}">No pude avanzar</button>`}
    h+=`<div class="mw-row ${cls}"><div><div class="mw-t">${r.prioridad?`<small>Prioridad ${esc(r.prioridad)}</small>`:''}${esc(cname(r.clienteId))} <span class="muted" style="font-weight:600;font-size:13px">· meta ${fmt(m)}</span></div>${r.estado==='planificada'?`<div class="bar" style="max-width:none;margin-top:8px"><i class="${p>=1?'g':''}" style="width:${Math.round(p*100)}%"></i></div>`:''}<div class="mw-n">${info}${r.nota&&!/^Prioridad \d+\.\s*Cargado/.test(r.nota)?`<br>Nota de tu líder: ${esc(String(r.nota).replace(/^Prioridad \d+\.\s*/,'').replace(/\s*Cargado desde la planilla.*$/,''))}`:''}</div></div><div class="mw-b">${btn}</div></div>`});
  return h+`</div></div><h3 style="font-family:var(--head);font-size:15px;margin:4px 0 10px">Todo el equipo</h3>`;
}
function modalPlanAv(id){
  const r=D.plan.find(x=>x.id===id);if(!r)return;const av=+r.avance||0,m=+r.meta||0;
  openModal(mtop('Sumar avance',`${esc(cname(r.clienteId))} · llevas ${fmt(av)} de ${fmt(m)} empresas`)+
  `<form class="form" id="fPv"><label>¿Cuántas empresas sumaste?<input id="pv-e" type="number" min="1" step="1" required inputmode="numeric" placeholder="Ej.: 10"></label>
   <label>¿Cuántos contactos? <span class="hint">Opcional</span><input id="pv-c" type="number" min="0" step="1" inputmode="numeric" placeholder="Ej.: 40"></label>
   <div class="full qk"><span class="muted" style="font-size:12.5px;align-self:center">Rápido:</span>${[5,10,15,20,30].map(n=>`<button type="button" class="btn sm" data-q="${n}">+${n}</button>`).join('')}${m>av?`<button type="button" class="btn sm" data-q="${m-av}">Lo que falta (${fmt(m-av)})</button>`:''}</div>
   <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri" id="pv-s">Guardar</button></div></form>`);
  document.querySelectorAll('#fPv [data-q]').forEach(b=>b.addEventListener('click',()=>{$('#pv-e').value=b.dataset.q;$('#pv-e').focus()}));
  setTimeout(()=>{try{$('#pv-e').focus()}catch(_){}},50);
  $('#fPv').addEventListener('submit',async e=>{e.preventDefault();const n=Math.max(0,Math.round(+$('#pv-e').value||0)),c=Math.max(0,Math.round(+$('#pv-c').value||0));if(!n){toast('Indica cuántas empresas sumaste.',true);return}
    $('#pv-s').disabled=true;const now=new Date().toISOString();const tot=av+n;
    const lista=(Array.isArray(r.avances)?r.avances:[]).concat([{fecha:TODAY(),empresas:n,contactos:c}]).slice(-60);
    const ok=await write(()=>db.doc('plan/'+r.id).update({avance:tot,contactosAvance:(+r.contactosAvance||0)+c,avances:lista,ultimoAvance:now,actualizado:now}),tot>=m&&m?'¡Llegaste a la meta de este cliente!':'Avance guardado');
    if(!ok){$('#pv-s').disabled=false;return}
    closeModal();
    if(m&&tot>=m)setTimeout(()=>{const x=D.plan.find(y=>y.id===r.id)||Object.assign({},r,{avance:tot,contactosAvance:(+r.contactosAvance||0)+c});if(x.estado==='planificada')modalPlanEnt(r.id)},400)});
}
function modalPlanSg(id){
  const r=D.plan.find(x=>x.id===id);if(!r)return;
  openModal(mtop('Semana sin gestión',`${esc(cname(r.clienteId))} · semana del ${niceDate(r.semana)}. El motivo es obligatorio: así sabremos qué destrabar.`)+
  `<form class="form" id="fPs"><label class="full">Motivo<select id="ps-m" required><option value="" selected disabled>Elige el motivo</option>${MOTIVOS.map(m=>`<option>${m}</option>`).join('')}</select></label>
   <label class="full">Detalle <span class="hint">Obligatorio si eliges «Otro»</span><textarea id="ps-d" maxlength="600"></textarea></label>
   <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri">Guardar</button></div></form>`);
  $('#fPs').addEventListener('submit',async e=>{e.preventDefault();const m=$('#ps-m').value,d=$('#ps-d').value.trim();if(!m){toast('Elige el motivo.',true);return}if(m==='Otro'&&!d){toast('Cuéntanos el motivo en el detalle.',true);$('#ps-d').focus();return}
    const ok=await write(()=>db.doc('plan/'+r.id).update({estado:'sin_gestion',motivo:m,detalle:d,actualizado:new Date().toISOString()}),'Guardado');if(ok)closeModal()});
}
VF.registro=function(){
  if(offline)return noConn();if(!L.r)return loading();
  const w=win(),rows=fReg(w.a,w.b);const m=metrics(w.a,w.b);
  let h=`<div class="actions" style="margin-bottom:14px;justify-content:space-between"><div class="actions"><span class="tag">${fmt(rows.length)} registros</span><span class="tag p">${fmt(m.empresas)} empresas</span><span class="tag p">${fmt(m.contactos)} contactos</span><span class="tag g">${fmt(m.nuevos)} nuevos en cruce</span></div><button class="btn pri" data-act="new-reg">${ic('plus')} Registrar avance</button></div>`;
  if(!rows.length)return h+`<div class="card empty"><h3>Sin registros en este período</h3><p>Anota al final del día o de la semana cuántas empresas investigaste y cuántos contactos encontraste. Los cruces también se pueden guardar aquí desde su módulo.</p><button class="btn pri" data-act="new-reg">${ic('plus')} Registrar avance</button></div>`;
  h+=`<div class="card"><div class="tw"><table><thead><tr><th class="l">Fecha</th><th class="l">Prospectora</th><th class="l">Cliente</th><th>Empresas</th><th>Contactos</th><th>Nuevos / existentes</th><th class="l">Origen</th><th class="l">Nota</th><th></th></tr></thead><tbody>`;
  rows.forEach(r=>{const mine=r.por&&r.por===myId;
    h+=`<tr><td class="l">${niceDate(r.fecha)}</td><td class="l">${who(keyOf(r))}</td><td class="l">${esc(cname(r.clienteId))}</td><td>${fmt(r.empresas)}</td><td>${fmt(r.contactos)}</td><td>${(+r.nuevos||+r.existentes)?fmt(r.nuevos)+' / '+fmt(r.existentes):'–'}</td><td class="l">${r.fuente==='cruce'?'<span class="tag g">Cruce</span>':r.fuente==='historico'?'<span class="tag p">Planilla</span>':r.fuente==='plan'?'<span class="tag p">Plan semanal</span>':'<span class="tag">Manual</span>'}</td><td class="l" style="max-width:260px;white-space:normal;color:var(--muted)">${esc(r.nota||'')}</td><td>${mine||isAdmin?`<button class="btn ghost sm danger" data-del-reg="${esc(r.id)}">Eliminar</button>`:''}</td></tr>`});
  return h+'</tbody></table></div></div>';
};

VF.mant=function(){
  if(offline)return noConn();if(!L.m)return loading();
  const items=D.mant.slice().sort((a,b)=>{const da=(a.estado==='resuelto'||a.estado==='descartado')?1:0,db_=(b.estado==='resuelto'||b.estado==='descartado')?1:0;return da-db_||(MPRIO[a.prioridad]?.o??9)-(MPRIO[b.prioridad]?.o??9)||(a.num||0)-(b.num||0)});
  const pend=items.filter(i=>i.estado==='pendiente'||i.estado==='en_curso').length;
  let h=`<p class="note">Documento vivo de mejoras y riesgos técnicos de este portal, con el mismo criterio de las recomendaciones técnicas de BullsEye ABM Platform. Antes de ejecutar un ítem, verifica que siga vigente: el portal puede haber cambiado desde que se anotó. <b>${pend} ${pend===1?'ítem abierto':'ítems abiertos'}.</b></p>
  <div class="actions" style="justify-content:space-between;margin:12px 0"><div class="legend"><span><i style="background:var(--r)"></i>Crítico: actuar ya</span><span><i style="background:var(--o)"></i>Alto: próxima semana</span><span><i style="background:var(--y)"></i>Medio: planificar</span><span><i style="background:var(--g)"></i>Bajo: mejora continua</span></div>${isAdmin?`<button class="btn" data-act="edit-mant">${ic('plus')} Agregar ítem</button>`:''}</div>`;
  if(!items.length)return h+`<div class="card empty"><p>Sin ítems registrados.</p></div>`;
  h+='<div class="mlist">';
  items.forEach(i=>{const p=MPRIO[i.prioridad]||MPRIO.medio;const done=i.estado==='resuelto'||i.estado==='descartado';
    h+=`<article class="mitem ${done?'done':''}"><div class="mhead"><span class="mnum">${z(i.num||0)}</span><span class="mtitle">${esc(i.titulo)}</span><span class="pill ${p.c}">${p.t}</span>${isAdmin?`<select data-mest="${esc(i.id)}" aria-label="Estado">${Object.entries(MEST).map(([k,t])=>`<option value="${k}" ${i.estado===k?'selected':''}>${t}</option>`).join('')}</select>`:`<span class="tag">${esc(MEST[i.estado]||'Pendiente')}</span>`}</div>
    <dl class="fld">${i.donde?`<dt>Dónde</dt><dd>${esc(i.donde)}</dd>`:''}${i.porque?`<dt>Por qué importa</dt><dd>${esc(i.porque)}</dd>`:''}${i.accion?`<dt>Qué hacer</dt><dd>${esc(i.accion)}</dd>`:''}${i.esfuerzo?`<dt>Esfuerzo</dt><dd>${esc(i.esfuerzo)}</dd>`:''}<dt>Actualizado</dt><dd>${niceDate(i.actualizado)}</dd></dl></article>`});
  return h+'</div>';
};

/* ---------- modales ---------- */
let lastFocus=null;
function openModal(html,wide){lastFocus=document.activeElement;const m=$('#modal'),b=$('#mbox');b.className='mbox'+(wide?' wide':'');b.innerHTML=html;m.hidden=false;const f=b.querySelector('input,select,textarea,button:not(.x)');if(f)f.focus()}
function closeModal(){$('#modal').hidden=true;$('#mbox').innerHTML='';if(lastFocus&&lastFocus.focus)lastFocus.focus()}
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
onDoc('keydown',e=>{if(e.key==='Escape'&&!$('#modal').hidden)closeModal()});
const mtop=(t,s)=>`<div class="mtop"><div><h2>${esc(t)}</h2>${s?`<p>${s}</p>`:''}</div><button class="x" data-act="close" aria-label="Cerrar">${ic('x')}</button></div>`;
const cliOpts=(sel,allowNone)=>`${allowNone?'<option value="">Sin cliente / varios</option>':''}${D.clientes.map(c=>`<option value="${esc(c.id)}" ${sel===c.id?'selected':''}>${esc(c.nombre)}</option>`).join('')}`;

function modalNewReq(cliId){
  if(readOnly){modalReqText(cliId);return}
  if(!db){toast('No hay conexión con los datos del equipo. Recarga la página para crear solicitudes.',true);return}
  openModal(mtop('Nueva solicitud de investigación','Describe qué necesitas y con qué criterios. Claude la toma de la cola y deja el resultado en esta misma solicitud.')+
  `<form class="form" id="fReq">
   <label>Cliente<select id="rq-cli" required><option value="" ${D.clientes.some(c=>c.id===(cliId||S.cli))?'':'selected'} disabled>Elige un cliente</option>${cliOpts(cliId||S.cli,false)}</select></label>
   <label>Tipo de trabajo<select id="rq-tipo">${TIPOS.map(t=>`<option>${t}</option>`).join('')}</select></label>
   <label class="full">Qué necesitas<input id="rq-tit" required maxlength="140" placeholder="Ej.: Empresas de logística en Biobío con más de 50 empleados"></label>
   <label class="full">Criterios y detalle <span class="hint">Industria, zona, tamaño, cargos, exclusiones, fuente sugerida, columnas que necesitas…</span><textarea id="rq-det" maxlength="6000" placeholder="Ej.: Excluir clientes actuales y empresas ya contactadas en septiembre. Necesito nombre, sitio web, LinkedIn de la empresa y cantidad de empleados."></textarea></label>
   <div class="full" style="display:grid;gap:10px"><div class="actions"><button type="button" class="btn" id="rq-mej">${ic('sparkle')} Mejorar solicitud</button><span class="muted" style="font-size:12.5px">Revisa qué falta y ordena el texto para que el resultado salga como lo necesitas.</span></div><div id="rq-mej-out" hidden></div></div>
   <label>Cantidad aproximada<input id="rq-cant" type="number" min="0" step="1" placeholder="Ej.: 50"></label>
   <label>Prioridad<select id="rq-prio"><option value="media">Media</option><option value="alta">Alta</option><option value="baja">Baja</option></select></label>
   <label>Fecha límite<input id="rq-fl" type="date" min="${TODAY()}"></label>
   <div class="full drop" id="rq-drop" style="min-height:96px"><input type="file" id="rq-file" accept=".xlsx,.csv" aria-label="Adjuntar lista de empresas"><span class="dico">${ic('upload',20)}</span><div class="label">Adjuntar lista (opcional)</div><div class="hint">Excel (.xlsx) o CSV, hasta ${fmt(MAX_FILAS)} filas. Haz clic o arrastra el archivo aquí.</div><div class="ok" id="rq-file-ok"></div></div>
   <p class="err-text full" id="rq-file-err" hidden></p>
   <div class="full" id="rq-enc" hidden></div>
   <label class="full" id="rq-orden-w" hidden style="display:flex;gap:10px;align-items:center;font-weight:500;color:var(--text);font-size:13.5px"><input type="checkbox" id="rq-orden" style="width:auto"> Mantener el mismo orden de filas del archivo en el resultado</label>
   <label class="full">Enlace a otro archivo <span class="hint">Opcional. Para PDF, Word u otros formatos: comparte el archivo en Drive y pega el enlace.</span><input id="rq-link" type="url" maxlength="500" placeholder="https://drive.google.com/…"></label>
   <div class="full" id="rq-dup" hidden></div>
   <div class="full" id="rq-hist" hidden></div>
   <div class="full" id="rq-cons"></div>
   <div class="full" id="rq-eta"></div>
   <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri" id="rq-send">Enviar solicitud</button></div>
  </form>`);
  let adj=null;
  const paintCons=()=>{const q=$('#rq-quitar');const fl=adj?(q&&q.checked?adj.body.length-(adj.dups||0):adj.body.length):0;const[n,why]=estimarConsumo($('#rq-tipo').value,$('#rq-cant').value,fl);const c=CONSUMO[n];
    $('#rq-cons').innerHTML=`<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:var(--${c.c==='g'?'g':c.c==='y'?'y':'r'}-soft)"><span class="pill ${c.c}">Consumo estimado: ${c.t}</span><span style="font-size:13px">${esc(why)}${n==='alto'?' <b>La solicitud quedará esperando la aprobación de tu líder antes de procesarse.</b>':''}</span></div>`};
  const paintDup=()=>{const c=$('#rq-cli').value,t=$('#rq-tipo').value,box=$('#rq-dup');const d=c?D.solicitudes.filter(r=>r.clienteId===c&&r.tipo===t&&isOpen(r)):[];
    if(!d.length){box.hidden=true;return}box.hidden=false;box.innerHTML=`<div style="padding:10px 12px;border-radius:10px;background:var(--y-soft);font-size:13px"><b>Ya hay ${d.length===1?'una solicitud abierta':d.length+' solicitudes abiertas'} de «${esc(t)}» para este cliente:</b> ${d.slice(0,3).map(r=>`«${esc(r.titulo)}» (${esc((ESTADOS[r.estado]||ESTADOS.pendiente).t.toLowerCase())})`).join(', ')}. Revisa que no estés pidiendo lo mismo.</div>`};
  const paintHist=()=>{const box=$('#rq-hist'),c=$('#rq-cli').value;if(!adj||!c){box.hidden=true;return}const H=D.hist[c];const ci=empCol(adj.cols);const n=H?adj.body.filter(r=>H.has(normEmp(r[ci]))).length:0;adj.dupIdx=ci;adj.dups=n;
    if(!n){box.hidden=false;box.innerHTML=`<div style="padding:10px 12px;border-radius:10px;background:var(--g-soft);font-size:13px">Ninguna de las ${fmt(adj.body.length)} empresas de la lista (columna «${esc(adj.cols[ci])}») aparece como ya trabajada para este cliente.</div>`;return}
    box.hidden=false;box.innerHTML=`<label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:var(--y-soft);font-size:13px;font-weight:500;color:var(--text)"><input type="checkbox" id="rq-quitar" checked style="width:auto;margin-top:2px"><span><b>${fmt(n)} de ${fmt(adj.body.length)} empresas ya fueron trabajadas para este cliente</b> (según la columna «${esc(adj.cols[ci])}»). Quitarlas de la lista antes de enviar.</span></label>`;
    $('#rq-quitar').addEventListener('change',paintCons)};
  const paintEta=()=>{const box=$('#rq-eta');const tipo=$('#rq-tipo').value;const fl0=adj?adj.body.length:0;const n=Math.max(+$('#rq-cant').value||0,fl0);const[cons]=estimarConsumo(tipo,$('#rq-cant').value,fl0);
    const fake={tipo,prioridad:$('#rq-prio').value,cantidad:n,adjunto:adj?{filas:fl0}:null};
    const d=colaETA(fake).__nueva;if(!d){box.innerHTML='';return}
    const lim=$('#rq-fl').value;const tarde=lim&&ymd(d)>lim;const runs=corridas(fake);
    box.innerHTML=`<div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;padding:10px 12px;border-radius:10px;background:var(--${tarde?'r':'surface-2'}${tarde?'-soft':''})"><span class="pill ${tarde?'r':'n'}">Entrega estimada: ${esc(fechaCorta(d))}</span><span style="font-size:13px;flex:1;min-width:220px">${tarde?`<b>No alcanza para tu fecha límite (${esc(niceDate(lim))}).</b> `:''}${runs>1?`Necesita ${runs} rondas (se avanzan ${WEB_POR_RUN} filas por hora). `:''}${cons==='alto'?'Además debe aprobarla tu líder, lo que puede sumar días. ':''}Considera las solicitudes que ya están en la cola${$('#rq-prio').value!=='alta'?'; con prioridad alta pasa adelante':''}.${tarde?' Si es urgente, avísale a tu líder.':''}</span>${tarde?`<button type="button" class="btn sm" id="rq-usaeta">Usar ${esc(niceDate(ymd(d)))} como fecha límite</button>`:''}</div>`;
    const b=$('#rq-usaeta');if(b)b.addEventListener('click',()=>{$('#rq-fl').value=ymd(d);paintEta()})};
  ['rq-tipo','rq-cant','rq-prio','rq-fl'].forEach(i=>{$('#'+i).addEventListener('input',paintEta);$('#'+i).addEventListener('change',paintEta)});
  ['rq-tipo','rq-cant'].forEach(i=>$('#'+i).addEventListener('input',paintCons));$('#rq-tipo').addEventListener('change',()=>{paintCons();paintDup()});$('#rq-cli').addEventListener('change',()=>{paintDup();paintHist();paintCons()});paintCons();paintDup();paintEta();
  const handle=async f=>{const er=$('#rq-file-err');er.hidden=true;$('#rq-file-ok').textContent='Leyendo…';
    try{adj=await parseTable(f);adj.nombre=f.name;$('#rq-file-ok').innerHTML=`✓ ${esc(f.name)}<small>${fmt(adj.body.length)} filas · ${adj.cols.length} columnas${adj.recortado?` · se tomarán las primeras ${fmt(MAX_FILAS)} de ${fmt(adj.total)}`:''}</small>`;const enc=$('#rq-enc');enc.hidden=false;enc.innerHTML=(`<label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:var(--${adj.sinEnc?'y-soft':'surface-2'});font-weight:500;font-size:13px;color:var(--text)"><input type="checkbox" id="rq-sinenc" ${adj.sinEnc?'checked':''} style="width:auto"> La primera fila ya es una empresa (el archivo no tiene títulos de columna)${adj.sinEnc?'. <b>Lo detectamos solo:</b> la primera fila parece un dato, así que se cuenta como empresa. Desmárcalo si en realidad son títulos.':''}</label>`);
      const se=$('#rq-sinenc');se.addEventListener('change',()=>{f._sinEnc=se.checked;handle(f)});
      if(!$('#rq-cant').value||+$('#rq-cant').value===adj.body.length+(adj.sinEnc?-1:1))$('#rq-cant').value=adj.body.length;$('#rq-orden-w').hidden=false;$('#rq-orden').checked=$('#rq-orden').checked||/mismo orden|orden que/i.test($('#rq-det').value);paintHist()}
    catch(e){adj=null;$('#rq-file-ok').textContent='';$('#rq-enc').hidden=true;er.textContent=e.message==='formato'?'El archivo debe ser .xlsx o .csv. Para otros formatos, compártelo en Drive y pega el enlace abajo.':e.message==='pocas'?'El archivo necesita una fila de encabezados y al menos una fila de datos.':'No se pudo leer el archivo. Revisa que sea un .xlsx o .csv válido.';er.hidden=false}
    if(!adj)paintHist();paintCons();paintEta()};
  const reglas=new Set();
  const mejorar=()=>{
    const out=$('#rq-mej-out');const tipo=$('#rq-tipo').value,tit=$('#rq-tit').value.trim(),det=$('#rq-det').value.trim(),cant=+$('#rq-cant').value||0,cid=$('#rq-cli').value;
    const ficha=D.clientes.find(c=>c.id===cid)||{};const txt=(tit+' '+det).toLowerCase();const link=$('#rq-link').value.trim();
    const paisM=txt.match(/chile|per[uú]|colombia|m[eé]xico|argentina|latam|latinoam/);const pais=paisM?paisM[0]:'';
    const necesitaLista=['Sitio web y LinkedIn','Cruce de bases','Limpieza de datos'].includes(tipo);
    const checks=[];
    if(necesitaLista&&!adj&&!link)checks.push({ok:false,t:'Falta la lista de empresas',d:'Este tipo de trabajo se hace sobre una lista: adjúntala abajo en Excel o CSV.'});
    if(!pais&&!adj)checks.push({ok:false,t:'No indica país o zona',d:ficha.zonas?`La ficha dice: ${ficha.zonas}.`:'Indica en qué país buscar.',chip:ficha.zonas?['Usar las zonas de la ficha','zona']:null});else checks.push({ok:true,t:'País o zona'+(pais?`: ${pais}`:' (según la lista)')});
    if(!cant&&!adj)checks.push({ok:false,t:'No indica la cantidad',d:'Escribe cuántas empresas necesitas en «Cantidad aproximada».'});else checks.push({ok:true,t:`Cantidad: ${fmt(cant||adj.body.length)}`});
    const pideVacios=/vac[ií]o/.test(txt),noEnc=/no encontrad/.test(txt)||reglas.has('noenc');
    if(!noEnc)checks.push({ok:false,t:pideVacios?'Pide no dejar campos vacíos, pero no dice qué hacer si un dato no existe':'No dice qué hacer si un dato no se encuentra',d:'Algunas empresas no tienen sitio web o LinkedIn. Mejor marcarlo que inventarlo.',chip:['Si no hay dato, escribir «No encontrado»','noenc']});else checks.push({ok:true,t:'Qué hacer si un dato no existe'});
    if(!/excel|xlsx|csv|planilla/.test(txt)&&!reglas.has('excel'))checks.push({ok:false,t:'No indica el formato de entrega',chip:['Entregar en Excel','excel']});else checks.push({ok:true,t:'Formato de entrega'});
    if(adj){if(!/orden/.test(txt)&&!$('#rq-orden').checked)checks.push({ok:false,t:'No indica si se mantiene el orden del archivo',chip:['Mantener el orden del archivo','orden']});else checks.push({ok:true,t:'Orden de las filas'})}
    if(!/exclu|no incluir|sin las|descart/.test(txt)&&!reglas.has('hist'))checks.push({ok:false,t:'No menciona exclusiones',d:ficha.exclusiones&&!/sin definir/i.test(ficha.exclusiones)?`La ficha dice: ${ficha.exclusiones}`:'',chip:['Excluir empresas ya trabajadas para este cliente','hist']});else checks.push({ok:true,t:'Exclusiones'});
    // columnas
    const cols=[];const add=c=>{if(!cols.some(x=>x.toLowerCase()===c.toLowerCase()))cols.push(c)};
    if(adj&&tipo!=='Listado de empresas')adj.cols.forEach(add);
    if(tipo==='Listado de empresas')['Empresa','Sitio web','LinkedIn de la empresa','País','Industria','Tamaño aproximado (empleados)','Por qué encaja'].forEach(add);
    if(/fantas/.test(txt))add('Nombre de fantasía');
    if(tipo==='Sitio web y LinkedIn'||/sitio|web|url/.test(txt))add('Sitio web');
    if(tipo==='Sitio web y LinkedIn'||/linkedin/.test(txt))add('LinkedIn de la empresa');
    if(/industr|rubro/.test(txt))add('Industria');if(/emplead|tama[nñ]o/.test(txt))add('Tamaño aproximado (empleados)');
    if(/activa|vigente|opera/.test(txt)){add(`¿Activa${pais?' en '+pais.charAt(0).toUpperCase()+pais.slice(1):''}? (Sí/No)`);add('Motivo si no está activa')}
    if(tipo==='Cruce de bases'){add('Estado (Nueva / Ya trabajada / Duplicada)');add('Motivo')}
    if(tipo==='Limpieza de datos')add('Cambios realizados');
    const R=[];if(/revis|cuidad|detall/.test(txt))R.push('Revisar cada empresa con cuidado.');
    if(reglas.has('noenc')||noEnc||pideVacios)R.push('No dejar campos vacíos: si un dato no existe, escribir «No encontrado» y no inventarlo.');
    if(reglas.has('orden')||(adj&&($('#rq-orden').checked||/orden/.test(txt))))R.push('Mantener el mismo orden de filas del archivo.');
    if(reglas.has('hist'))R.push('Excluir las empresas ya trabajadas para este cliente.');
    if(ficha.exclusiones&&!/sin definir/i.test(ficha.exclusiones)&&reglas.has('hist'))R.push('Respetar las exclusiones de la ficha del cliente.');
    if(reglas.has('zona')&&ficha.zonas)R.push(`Buscar en: ${ficha.zonas}.`);
    const fmtE=(/excel|xlsx|planilla/.test(txt)||reglas.has('excel'))?'Excel descargable.':/csv/.test(txt)?'CSV descargable.':'Excel descargable.';
    const entrada=adj?`Lista adjunta «${adj.nombre}» con ${fmt(adj.body.length)} filas; columna de empresa: «${adj.cols[empCol(adj.cols)]}». Columnas del archivo: ${adj.cols.join(', ')}.`:link?`Archivo en el enlace indicado.`:`Búsqueda nueva según la ficha de ${ficha.nombre||'el cliente'}${pais?' en '+pais:''}.`;
    const propuesta=[`OBJETIVO\n${tit||'(escribe arriba qué necesitas)'}`,`ENTRADA\n${entrada}`,`COLUMNAS A ENTREGAR\n${cols.join(' · ')||'(define las columnas)'}`,R.length?`REGLAS\n${R.map(r=>'- '+r).join('\n')}`:'',`FORMATO\n${fmtE}`,det?`DETALLE ORIGINAL\n${det.replace(/^OBJETIVO[\s\S]*?DETALLE ORIGINAL\n/,'')}`:''].filter(Boolean).join('\n\n');
    out.hidden=false;
    out.innerHTML=`<div class="card" style="padding:14px;display:grid;gap:12px;box-shadow:none;background:var(--surface-2)">
      <div><b style="font-size:14px">Revisión de la solicitud</b><ul style="margin:8px 0 0;padding:0;list-style:none;display:grid;gap:6px">${checks.map(c=>`<li style="display:flex;gap:8px;align-items:flex-start;font-size:13px"><span class="pill ${c.ok?'g':'y'}" style="padding:1px 7px">${c.ok?'Listo':'Falta'}</span><span><b style="font-weight:600">${esc(c.t)}</b>${c.d?` <span class="muted">${esc(c.d)}</span>`:''}${c.chip&&!c.ok?` <button type="button" class="btn sm" data-chip="${c.chip[1]}">${esc(c.chip[0])}</button>`:''}</span></li>`).join('')}</ul></div>
      <label style="display:grid;gap:5px;font-size:12.5px;font-weight:600;color:var(--muted)">Versión propuesta<textarea id="rq-prop" style="min-height:230px;width:100%;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--surface);color:var(--text);font:inherit;font-size:13px;line-height:1.5">${esc(propuesta)}</textarea></label>
      <div class="actions"><button type="button" class="btn pri sm" id="rq-usar">Usar esta versión</button><button type="button" class="btn ghost sm" id="rq-cerrar-mej">Seguir con mi texto</button></div></div>`;
    out.querySelectorAll('[data-chip]').forEach(b=>b.addEventListener('click',()=>{const k=b.dataset.chip;reglas.add(k);if(k==='orden'&&$('#rq-orden'))$('#rq-orden').checked=true;mejorar()}));
    $('#rq-usar').addEventListener('click',()=>{$('#rq-det').value=$('#rq-prop').value.slice(0,6000);out.hidden=true;toast('Solicitud actualizada. Revísala y envíala.');paintCons()});
    $('#rq-cerrar-mej').addEventListener('click',()=>{out.hidden=true});
  };
  $('#rq-mej').addEventListener('click',mejorar);
  const dz=$('#rq-drop'),fi=$('#rq-file');fi.addEventListener('change',()=>{if(fi.files[0])handle(fi.files[0])});
  dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag')});dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');if(e.dataTransfer.files[0])handle(e.dataTransfer.files[0])});
  $('#fReq').addEventListener('submit',async e=>{e.preventDefault();if(!$('#rq-cli').value){toast('Elige el cliente de la solicitud.',true);$('#rq-cli').focus();return}const tit=$('#rq-tit').value.trim();if(!tit){$('#rq-tit').focus();return}
    let quitadas=0;if(adj&&$('#rq-quitar')&&$('#rq-quitar').checked&&adj.dups){const H=D.hist[$('#rq-cli').value];const before=adj.body.length;adj.body=adj.body.filter(r=>!H.has(normEmp(r[adj.dupIdx])));quitadas=before-adj.body.length;if(!adj.body.length){toast('Todas las empresas de la lista ya fueron trabajadas para este cliente.',true);return}}
    const link=$('#rq-link').value.trim();if(link&&!/^https:\/\//i.test(link)){toast('El enlace debe empezar con https://',true);$('#rq-link').focus();return}
    $('#rq-send').disabled=true;$('#rq-send').textContent=adj?'Subiendo lista…':'Enviando…';const now=new Date().toISOString();
    const[cons,why]=estimarConsumo($('#rq-tipo').value,$('#rq-cant').value,adj?adj.body.length:0);
    const ref=db.collection('solicitudes').doc();let partes=0;
    if(adj){const ps=partir(adj.body,adj.cols);partes=ps.length;
      for(let i=0;i<ps.length;i++){const okp=await write(()=>db.doc(`adjuntos/${ref.id}-${i}`).set({solicitud:ref.id,parte:i,columnas:adj.cols,filas:ps[i],nombre:adj.nombre,creado:now}));if(!okp){$('#rq-send').disabled=false;$('#rq-send').textContent='Enviar solicitud';return}}}
    const ok=await write(()=>ref.set({clienteId:$('#rq-cli').value||'',tipo:$('#rq-tipo').value,titulo:tit,detalle:$('#rq-det').value.trim(),cantidad:+$('#rq-cant').value||0,prioridad:$('#rq-prio').value,fechaLimite:$('#rq-fl').value||'',estado:cons==='alto'?'revision':'pendiente',consumo:cons,consumoMotivo:why,adjunto:adj?{nombre:adj.nombre,filas:adj.body.length,columnas:adj.cols.length,partes,recortado:adj.recortado,totalOriginal:adj.total,quitadasPorHistorial:quitadas}:null,enlace:link,mantenerOrden:!!(adj&&$('#rq-orden').checked),por:myId||'',email:myMail(),creado:now,actualizado:now}),cons==='alto'?'Solicitud enviada. Quedó esperando la aprobación de tu líder por su consumo alto.':'Solicitud enviada');
    if(!ok){$('#rq-send').disabled=false;$('#rq-send').textContent='Enviar solicitud'}
    if(ok){closeModal();if(S.view!=='solicitudes'){S.view='solicitudes';S.rf='abiertas';sched()}}else $('#rq-send').disabled=false});
}

function modalReqText(cliId){
  openModal(mtop('Nueva solicitud de investigación','Completa el formulario y se arma el texto listo para enviárselo a tu líder por correo o chat.')+
  `<form class="form" id="fReqT">
   <label>Cliente<select id="rt-cli">${cliOpts(cliId||S.cli,true)}</select></label>
   <label>Tipo de trabajo<select id="rt-tipo">${TIPOS.map(t=>`<option>${t}</option>`).join('')}</select></label>
   <label class="full">Qué necesitas<input id="rt-tit" required maxlength="140" placeholder="Ej.: Empresas de logística en Biobío con más de 50 empleados"></label>
   <label class="full">Criterios y detalle <span class="hint">Industria, zona, tamaño, cargos, exclusiones, columnas que necesitas…</span><textarea id="rt-det" maxlength="4000"></textarea></label>
   <label>Cantidad aproximada<input id="rt-cant" type="number" min="0" step="1" placeholder="Ej.: 50"></label>
   <label>Prioridad<select id="rt-prio"><option value="media">Media</option><option value="alta">Alta</option><option value="baja">Baja</option></select></label>
   <label>Fecha límite<input id="rt-fl" type="date" min="${TODAY()}"></label>
   <label>Tu nombre<input id="rt-who" maxlength="80"></label>
   <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri">Preparar texto</button></div>
  </form><div id="rt-out" hidden></div>`);
  $('#fReqT').addEventListener('submit',e=>{e.preventDefault();const tit=$('#rt-tit').value.trim();if(!tit){$('#rt-tit').focus();return}
    const c=$('#rt-cli').value;const fl=$('#rt-fl').value;
    const txt=['SOLICITUD DE INVESTIGACIÓN','Qué necesito: '+tit,'Cliente: '+(c?cname(c):'Sin cliente / varios'),'Tipo: '+$('#rt-tipo').value,'Prioridad: '+PRIOS[$('#rt-prio').value].t,fl?'Fecha límite: '+fl:'',$('#rt-cant').value?'Cantidad aproximada: '+$('#rt-cant').value:'',$('#rt-det').value.trim()?'Criterios y detalle:\n'+$('#rt-det').value.trim():'',$('#rt-who').value.trim()?'Pedida por: '+$('#rt-who').value.trim():''].filter(Boolean).join('\n');
    const out=$('#rt-out');out.hidden=false;out.innerHTML=`<label class="form" style="display:grid;gap:6px;font-size:12.5px;font-weight:600;color:var(--muted)">Texto listo para enviar<textarea id="rt-txt" readonly style="min-height:180px;width:100%;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--surface-2);color:var(--text);font:inherit">${esc(txt)}</textarea></label><div class="mact" style="margin-top:10px"><button class="btn pri" id="rt-copy">Copiar texto</button></div>`;
    $('#rt-copy').addEventListener('click',()=>{const ta=$('#rt-txt');const done=()=>toast('Texto copiado. Envíaselo a tu líder.');try{navigator.clipboard.writeText(ta.value).then(done,()=>{ta.select();toast('Selecciona el texto y cópialo con Ctrl+C.')})}catch(_){ta.select();toast('Selecciona el texto y cópialo con Ctrl+C.')}});
    out.scrollIntoView({behavior:'smooth',block:'nearest'})});
}
function modalReq(id){
  const r=D.solicitudes.find(x=>x.id===id);if(!r)return;
  const e=ESTADOS[r.estado]||ESTADOS.pendiente,p=PRIOS[r.prioridad]||PRIOS.media;
  const mine=r.por&&r.por===myId;
  let h=mtop(r.titulo||'Solicitud',`<span class="pill ${e.c}">${e.t}</span> &nbsp;<span class="pill ${p.c}">Prioridad ${p.t.toLowerCase()}</span>`)+
  `<dl class="fld"><dt>Cliente</dt><dd>${esc(cname(r.clienteId))}</dd><dt>Tipo</dt><dd>${esc(r.tipo||'–')}</dd><dt>Pidió</dt><dd>${esc(pname(keyOf(r)))}</dd><dt>Creada</dt><dd>${niceDate(r.creado)}</dd><dt>Fecha límite</dt><dd>${niceDate(r.fechaLimite)}</dd>${isOpen(r)?`<dt>Entrega estimada</dt><dd>${(()=>{const et=etaTxt(r);if(r.estado==='revision')return 'Se calcula cuando tu líder la apruebe.';if(et.s==='ejecución extraordinaria')return 'Hoy. <span class="muted">Tu líder pidió procesarla completa hoy, fuera del horario normal. La barra muestra el avance real.</span>';if(!et.d)return '–';const n=corridas(r);return esc(fechaCorta(et.d))+` (tu hora). <span class="muted">La cola se procesa cada hora, de lunes a viernes, entre las 8:53 y las 20:53 de Chile (6:53 a 18:53 en Colombia y Perú)${n>1?`; esta solicitud necesita ${n} rondas porque se avanzan ${WEB_POR_RUN} filas por hora`:''}.</span>`})()}${r.estado==='en_proceso'?barra(r):''}</dd>`:''}${r.cantidad?`<dt>Cantidad aprox.</dt><dd>${fmt(r.cantidad)}</dd>`:''}${r.detalle?`<dt>Criterios</dt><dd>${esc(r.detalle)}</dd>`:''}${r.entregado?`<dt>Entregada</dt><dd>${niceDate(r.entregado)}</dd>`:''}${r.notaEntrega?`<dt>Nota de entrega</dt><dd>${esc(r.notaEntrega)}</dd>`:''}${r.consumo?`<dt>Consumo estimado</dt><dd><span class="pill ${CONSUMO[r.consumo].c}">${CONSUMO[r.consumo].t}</span> ${esc(r.consumoMotivo||'')}</dd>`:''}${r.enlace&&/^https:\/\//i.test(r.enlace)?`<dt>Enlace adjunto</dt><dd><a href="${esc(r.enlace)}" target="_blank" rel="noopener">${esc(r.enlace.replace(/^https:\/\/(www\.)?/,'').slice(0,70))}</a></dd>`:''}</dl>
  ${r.adjunto?`<div class="card" style="padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span class="kic">${ic('upload',15)}</span><div style="flex:1;min-width:180px"><b>${esc(r.adjunto.nombre)}</b><div class="muted" style="font-size:12.5px">${fmt(r.adjunto.filas)} filas · ${fmt(r.adjunto.columnas)} columnas${r.adjunto.recortado?` · recortado de ${fmt(r.adjunto.totalOriginal)} filas`:''}${r.adjunto.quitadasPorHistorial?` · se quitaron ${fmt(r.adjunto.quitadasPorHistorial)} ya trabajadas`:''}</div></div><button class="btn sm" id="adj-csv">Descargar CSV</button><button class="btn sm" id="adj-xlsx">Descargar Excel</button></div>`:''}
  ${isAdmin&&r.estado==='revision'?`<div class="card" style="padding:14px;background:var(--r-soft);display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b style="flex:1;min-width:200px">Consumo alto: esta solicitud espera tu aprobación.</b><button class="btn danger" id="rq-rech">Rechazar</button><button class="btn pri" id="rq-apr">Aprobar y enviar a la cola</button></div>`:''}
  <div id="rq-res"></div>
  ${r.estado==='lista'&&(mine||isAdmin||(r.email&&r.email===myKey()))?(r.evaluacion?`<div class="card" style="padding:12px 14px"><b>Evaluación:</b> <span class="pill ${({si:'g',parcial:'y',no:'r'})[r.evaluacion.valor]}">${({si:'Me sirvió',parcial:'Me sirvió en parte',no:'No me sirvió'})[r.evaluacion.valor]}</span>${r.evaluacion.comentario?` <span class="muted">${esc(r.evaluacion.comentario)}</span>`:''}</div>`:`<div class="card" style="padding:14px;display:grid;gap:10px"><b>¿Te sirvió esta entrega?</b><textarea id="ev-c" maxlength="600" placeholder="Opcional: qué faltó o qué estuvo bien" style="width:100%;border:1px solid var(--border);border-radius:10px;padding:9px 11px;background:var(--surface);color:var(--text);font:inherit;min-height:60px"></textarea><div class="actions"><button class="btn sm" data-eval="si">Me sirvió</button><button class="btn sm" data-eval="parcial">En parte</button><button class="btn sm danger" data-eval="no">No me sirvió</button></div></div>`):''}
  <div class="mact">`;
  if(isAdmin)h+=`<label class="muted" style="display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;margin-right:auto">Estado <select id="rq-est">${Object.entries(ESTADOS).map(([k,v])=>`<option value="${k}" ${r.estado===k?'selected':''}>${v.t}</option>`).join('')}</select></label>`;
  if((mine||isAdmin)&&(r.estado==='pendiente'||r.estado==='revision'))h+=`<button class="btn danger" id="rq-cancel">Cancelar solicitud</button>`;
  h+=`<button class="btn" data-act="close">Cerrar</button></div>`;
  openModal(h,true);
  if(r.resultadoCount||r.estado==='lista')loadResult(r);
  document.querySelectorAll('[data-eval]').forEach(b=>b.addEventListener('click',async ev=>{ev.stopPropagation();const v=b.dataset.eval;const c=$('#ev-c')?$('#ev-c').value.trim():'';if(v!=='si'&&!c){toast('Cuéntanos brevemente qué faltó.',true);$('#ev-c').focus();return}
    const ok=await write(()=>db.doc('solicitudes/'+r.id).update({evaluacion:{valor:v,comentario:c,fecha:new Date().toISOString()},actualizado:new Date().toISOString()}),'Gracias por evaluar la entrega');if(ok)closeModal()}));
  const getAdj=async()=>{const rows=[];let cols=[];for(let i=0;i<(r.adjunto.partes||1);i++){const sn=await db.doc(`adjuntos/${r.id}-${i}`).get();if(sn.exists){const d=sn.data();cols=d.columnas||cols;rows.push(...(d.filas||[]))}}return{cols,rows}};
  const base='adjunto_'+slug(r.titulo).slice(0,40);
  const ac=$('#adj-csv');if(ac)ac.addEventListener('click',async()=>{if(!db)return;try{const{cols,rows}=await getAdj();const q=v=>{v=v==null?'':String(v);return /[",;\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};saveFile(base+'.csv','\ufeff'+[cols,...rows].map(rw=>cols.map((_,i)=>q(rw[i])).join(',')).join('\r\n'))}catch(e){toast('No se pudo leer el archivo adjunto.',true)}});
  const ax=$('#adj-xlsx');if(ax)ax.addEventListener('click',async()=>{if(!db)return;try{const{cols,rows}=await getAdj();const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Adjunto');ws.addRow(cols);ws.getRow(1).font={bold:true};rows.forEach(rw=>ws.addRow(cols.map((_,i)=>rw[i]==null?'':rw[i])));const buf=await wb.xlsx.writeBuffer();saveFile(base+'.xlsx',new Blob([buf]))}catch(e){toast('No se pudo leer el archivo adjunto.',true)}});
  const apr=$('#rq-apr');if(apr)apr.addEventListener('click',async()=>{const ok=await write(()=>db.doc('solicitudes/'+r.id).update({estado:'pendiente',aprobada:new Date().toISOString(),actualizado:new Date().toISOString()}),'Solicitud aprobada');if(ok)closeModal()});
  const rch=$('#rq-rech');if(rch)rch.addEventListener('click',async()=>{if(rch.dataset.sure!=='1'){rch.dataset.sure='1';rch.textContent='Sí, rechazar';return}const ok=await write(()=>db.doc('solicitudes/'+r.id).update({estado:'cancelada',notaEntrega:'Rechazada por consumo alto. Conversa con tu líder para acotarla.',actualizado:new Date().toISOString()}),'Solicitud rechazada');if(ok)closeModal()});
  const est=$('#rq-est');if(est)est.addEventListener('change',async()=>{const v=est.value;const now=new Date().toISOString();const patch={estado:v,actualizado:now};if(v==='lista'&&!r.entregado)patch.entregado=now;await write(()=>db.doc('solicitudes/'+r.id).update(patch),'Estado actualizado')});
  const c=$('#rq-cancel');if(c)c.addEventListener('click',async()=>{if(c.dataset.sure!=='1'){c.dataset.sure='1';c.textContent='Sí, cancelar';return}const ok=await write(()=>db.doc('solicitudes/'+r.id).update({estado:'cancelada',actualizado:new Date().toISOString()}),'Solicitud cancelada');if(ok)closeModal()});
}
async function loadResult(r){
  const box=$('#rq-res');if(!box||!db)return;box.innerHTML='<div class="muted" style="display:flex;gap:8px;align-items:center"><span class="spin"></span> Cargando resultado…</div>';
  let snap;try{snap=await db.doc('resultados/'+r.id).get()}catch(e){box.innerHTML='<p class="err-text">No se pudo cargar el resultado. Cierra y vuelve a abrir la solicitud.</p>';return}
  if(!$('#rq-res'))return;
  if(!snap.exists){box.innerHTML='<p class="muted">Esta solicitud no tiene un archivo de resultado adjunto.</p>';return}
  const d=snap.data(),cols=d.columnas||[],rows=d.filas||[];
  let h=`<div class="card" style="padding:14px"><div class="ch" style="margin-bottom:10px"><div><h3>Resultado · ${fmt(rows.length)} filas</h3>${d.resumen?`<p>${esc(d.resumen)}</p>`:''}</div><div class="actions"><button class="btn sm" id="dl-csv">Descargar CSV</button><button class="btn sm pri" id="dl-xlsx">Descargar Excel</button></div></div>
  <div class="cx-table" style="max-height:340px"><table><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,200).map(rw=>`<tr>${cols.map((_,i)=>{const v=rw[i]==null?'':String(rw[i]);return /^https?:\/\//i.test(v)?`<td><a href="${esc(v)}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\/(www\.)?/,''))}</a></td>`:`<td title="${esc(v)}">${esc(v)}</td>`}).join('')}</tr>`).join('')}</tbody></table></div>${rows.length>200?`<p class="muted" style="font-size:12px;margin:8px 0 0">Se muestran 200 de ${fmt(rows.length)} filas. La descarga incluye todas.</p>`:''}</div>`;
  box.innerHTML=h;
  const base='solicitud_'+slug(r.titulo).slice(0,40);
  $('#dl-csv').addEventListener('click',()=>{const q=v=>{v=v==null?'':String(v);return /[",;\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};saveFile(base+'.csv','﻿'+[cols,...rows].map(rw=>cols.map((_,i)=>q(rw[i])).join(',')).join('\r\n'))});
  $('#dl-xlsx').addEventListener('click',async()=>{const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Resultado');ws.addRow(cols);ws.getRow(1).font={bold:true};ws.views=[{state:'frozen',ySplit:1}];rows.forEach(rw=>ws.addRow(cols.map((_,i)=>rw[i]==null?'':rw[i])));ws.columns.forEach((c,i)=>{let mx=String(cols[i]||'').length;rows.forEach(rw=>{const l=String(rw[i]==null?'':rw[i]).length;if(l>mx)mx=l});c.width=Math.min(Math.max(mx+2,10),50)});const buf=await wb.xlsx.writeBuffer();saveFile(base+'.xlsx',new Blob([buf]))});
}
async function saveFile(name,data){
  if(!dlc){
    if(readOnly||offline){try{const b=data instanceof Blob?data:new Blob([data],{type:'text/csv;charset=utf-8'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)}catch(e){toast('No se pudo descargar el archivo.',true)}return}
    toast('La descarga no está disponible. Recarga la página.',true);return}
  try{await dlc.save({filename:name,data})}catch(e){if(e&&e.code==='declined')return;if(e&&e.code==='rate_limited'){toast('Ya hay una descarga esperando confirmación.',true);return}toast('No se pudo preparar la descarga.',true)}
}

function modalCli(id){
  const c=D.clientes.find(x=>x.id===id);if(!c)return;
  const reqs=D.solicitudes.filter(r=>r.clienteId===id).slice(0,6);
  let h=mtop(c.nombre,[c.industria,c.pais].filter(Boolean).map(esc).join(' · ')+(c.actualizado?` · ficha actualizada el ${niceDate(c.actualizado)}`:''))+
  `<dl class="fld">${[['Perfil de empresa',c.icp],['Industrias',c.industrias],['Zonas',c.zonas],['Cargos objetivo',c.cargos],['Exclusiones',c.exclusiones],['Avances',c.avances],['Próximos pasos',c.proximos]].filter(x=>x[1]).map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')||'<dt>Ficha</dt><dd class="muted">Sin detalle todavía.</dd>'}${c.docUrl&&/^https:\/\//.test(c.docUrl)?`<dt>Resumen completo</dt><dd><a href="${esc(c.docUrl)}" target="_blank" rel="noopener">Abrir en Google Drive</a></dd>`:''}</dl>`;
  if(c.contexto){const body=String(c.contexto).split('\n').map(l=>{const t=l.trim();return(t.length>=4&&t.length<=80&&/[A-ZÁÉÍÓÚÑ]/.test(t)&&t===t.toUpperCase())?`<span class="ctx-h">${esc(t)}</span>`:esc(l)}).join('\n');
    h+=`<details class="ctx" open><summary>Contexto completo</summary><div class="ctx-body">${body}</div></details>`}
  if(reqs.length)h+=`<div><h3 style="font-size:15px;margin-bottom:8px">Solicitudes recientes</h3><div class="tw"><table><tbody>${reqs.map(r=>{const e=ESTADOS[r.estado]||ESTADOS.pendiente;return `<tr class="click" data-req="${esc(r.id)}"><td class="l">${esc(r.titulo)}</td><td class="l">${esc(pname(keyOf(r)))}</td><td>${niceDate(r.creado)}</td><td class="l"><span class="pill ${e.c}">${e.t}</span></td></tr>`}).join('')}</tbody></table></div></div>`;
  h+=`<div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap"><h3 style="font-size:15px">Documentos y resúmenes de reuniones</h3>${isAdmin?`<button class="btn sm" data-act="doc-add" data-id="${esc(id)}">${ic('plus')} Agregar</button>`:''}</div><div id="cli-docs" data-cid="${esc(id)}"></div></div>`;
  const kc=D.cuentas.filter(x=>x.clienteId===id);if(kc.length){const ka=kc.filter(x=>kresp(x)==='Sí').length;h+=`<div class="card" style="padding:12px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:200px"><b>Cuentas aprobadas por el cliente: ${fmt(ka)} de ${fmt(kc.length)}</b><div class="muted" style="font-size:12.5px">${fmt(kc.filter(x=>kresp(x)==='Pendiente').length)} sin respuesta · ${fmt(kc.filter(x=>kresp(x)==='Revisar').length)} por revisar</div></div><button class="btn sm pri" data-act="ver-cuentas" data-id="${esc(id)}">Ver cuentas</button></div>`}
  const nh=D.hist[id]?D.hist[id].size:0;
  h+=`<div class="card" style="padding:12px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:200px"><b>Empresas ya trabajadas: ${fmt(nh)}</b><div class="muted" style="font-size:12.5px">Las listas que se adjunten a una solicitud se comparan contra este historial para no repetir empresas.</div></div>${isAdmin?`<button class="btn sm" data-act="hist-import" data-id="${esc(id)}">Cargar empresas ya trabajadas</button>`:''}</div>`;
  h+=`<div class="mact">${isAdmin?`<button class="btn" data-act="edit-cli" data-id="${esc(id)}">Editar ficha</button>`:''}<button class="btn pri" data-act="new-req" data-cli="${esc(id)}">${ic('plus')} Nueva solicitud para este cliente</button></div>`;
  openModal(h,true);paintCliDocs();
}
const DOCCAT=['Resumen de reunión','Brochure','Presentación','Propuesta','Otro'];
function paintCliDocs(){
  const box=$('#cli-docs');if(!box)return;const cid=box.dataset.cid;
  const L=D.docs.filter(d=>d.clienteId===cid).sort((a,b)=>String(b.fecha||b.creado).localeCompare(String(a.fecha||a.creado)));
  if(!L.length){box.innerHTML=`<p class="muted" style="margin:0;font-size:13px">${isAdmin?'Aún no hay documentos. Sube brochures o presentaciones en PDF, o pega el resumen de una reunión con el cliente.':'Aún no hay documentos para este cliente.'}</p>`;return}
  box.innerHTML=`<div class="tw"><table><tbody>${L.map(d=>{const kind=d.tipo==='nota'?'Resumen escrito':d.tipo==='enlace'?'Enlace':((d.contentType||'').includes('pdf')?'PDF':(d.contentType||'').startsWith('image/')?'Imagen':'Archivo');
    const open=d.tipo==='nota'?`<button class="btn sm" data-doc-ver="${esc(d.id)}">Leer</button>`:d.tipo==='enlace'&&/^https:\/\//i.test(d.url||'')?`<a class="btn sm" href="${esc(d.url)}" target="_blank" rel="noopener">Abrir</a>`:d.assetId&&/^[0-9a-f]{32}$/.test(d.assetId)?`<a class="btn sm" href="/api/centro/assets/${d.assetId}" target="_blank" rel="noopener">Abrir</a>`:'';
    return `<tr><td class="l"><div class="rt-title">${esc(d.titulo||'Sin título')}</div><div class="rt-sub">${esc(d.categoria||'')} · ${kind}${d.tamano?' · '+(d.tamano>1048576?(Math.round(d.tamano/104857.6)/10)+' MB':Math.max(1,Math.round(d.tamano/1024))+' KB'):''}</div></td><td>${niceDate(d.fecha||d.creado)}</td><td style="white-space:nowrap">${open}${isAdmin?` <button class="btn ghost sm danger" data-doc-del="${esc(d.id)}">Eliminar</button>`:''}</td></tr><tr id="dv-${esc(d.id)}" hidden><td colspan="3" class="l"><div class="ctx-body" style="padding:10px 12px;background:var(--surface-2);border-radius:10px">${esc(d.texto||'')}</div></td></tr>`}).join('')}</tbody></table></div>`;
}
function modalDocAdd(cid){
  const back=()=>modalCli(cid);
  openModal(mtop('Agregar documento',`${esc(cname(cid))}. Lo verá tu equipo en la ficha y lo usará Claude al investigar para este cliente.`)+
  `<div class="seg" id="da-tab" style="margin-bottom:4px"><button class="on" data-t="archivo">Subir archivo</button><button data-t="nota">Pegar resumen</button><button data-t="enlace">Enlace</button></div>
  <form class="form" id="fDa">
   <label class="full">Título<input id="da-t" required maxlength="160" placeholder="Ej.: Reunión de kickoff con el cliente"></label>
   <label>Tipo de documento<select id="da-c">${DOCCAT.map(c=>`<option>${c}</option>`).join('')}</select></label>
   <label>Fecha<input id="da-f" type="date" value="${TODAY()}"></label>
   <div class="full drop" id="da-drop" data-p="archivo"><input type="file" id="da-file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv" aria-label="Archivo"><span class="dico">${ic('upload',20)}</span><div class="label">Elige el archivo</div><div class="hint">PDF, imagen o texto, hasta 20 MB. Word y PowerPoint: guárdalos como PDF o usa la pestaña «Enlace».</div><div class="ok" id="da-ok"></div></div>
   <label class="full" data-p="nota" hidden>Resumen<textarea id="da-x" maxlength="60000" style="min-height:220px" placeholder="Pega aquí el resumen de la reunión: acuerdos, perfil de empresa, cargos, exclusiones, próximos pasos…"></textarea></label>
   <label class="full" data-p="enlace" hidden>Enlace<input id="da-u" type="url" maxlength="500" placeholder="https://drive.google.com/…"></label>
   <p class="err-text full" id="da-err" hidden></p>
   <div class="mact full"><button type="button" class="btn ghost" id="da-back">Volver a la ficha</button><button class="btn pri" id="da-s">Guardar</button></div>
  </form>`,true);
  let modo='archivo',file=null;
  $('#da-back').addEventListener('click',back);
  $('#da-tab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;modo=b.dataset.t;$('#da-tab').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));document.querySelectorAll('#fDa [data-p]').forEach(el=>el.hidden=el.dataset.p!==modo);if(modo==='nota')$('#da-c').value='Resumen de reunión'});
  $('#da-file').addEventListener('change',()=>{file=$('#da-file').files[0]||null;$('#da-err').hidden=true;if(!file)return;if(!$('#da-t').value)$('#da-t').value=file.name.replace(/\.[^.]+$/,'');$('#da-ok').innerHTML=`✓ ${esc(file.name)}<small>${Math.max(1,Math.round(file.size/1024))} KB</small>`});
  const TYPES={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',txt:'text/plain',md:'text/markdown',csv:'text/csv'};
  const fail=m=>{$('#da-err').textContent=m;$('#da-err').hidden=false;$('#da-s').disabled=false;$('#da-s').textContent='Guardar'};
  $('#fDa').addEventListener('submit',async e=>{e.preventDefault();const t=$('#da-t').value.trim();if(!t){$('#da-t').focus();return}
    const base={clienteId:cid,titulo:t,categoria:$('#da-c').value,fecha:$('#da-f').value||TODAY(),creado:new Date().toISOString()};
    $('#da-s').disabled=true;$('#da-s').textContent='Guardando…';
    if(modo==='nota'){const x=$('#da-x').value.trim();if(!x)return fail('Pega el texto del resumen.');const ok=await write(()=>db.collection('docs_cliente').add(Object.assign(base,{tipo:'nota',texto:x})),'Resumen guardado');if(ok)back();else fail('No se pudo guardar.');return}
    if(modo==='enlace'){const u=$('#da-u').value.trim();if(!/^https:\/\//i.test(u))return fail('El enlace debe empezar con https://');const ok=await write(()=>db.collection('docs_cliente').add(Object.assign(base,{tipo:'enlace',url:u})),'Enlace guardado');if(ok)back();else fail('No se pudo guardar.');return}
    if(!file)return fail('Elige un archivo.');
    const ext=(file.name.split('.').pop()||'').toLowerCase();const type=TYPES[ext];
    if(!type)return fail('Formato no admitido. Sube PDF, imagen o texto; para Word o PowerPoint, guárdalo como PDF o usa un enlace.');
    if(file.size>20*1048576)return fail('El archivo pesa más de 20 MB. Comprímelo o compártelo como enlace.');
    if(!assetsCap)return fail('La subida de archivos no está disponible en esta vista. Usa la pestaña «Enlace».');
    let up;try{up=await assetsCap.upload(file,{type})}catch(err){const c=err&&err.code;return fail(c==='too_large'?'El archivo es demasiado grande.':c==='unsupported_type'?'Ese tipo de archivo no se puede subir. Guárdalo como PDF.':c==='quota_or_state'?'Se llenó el espacio de archivos del portal.':c==='rate_limited'?'Demasiadas subidas seguidas. Espera un momento.':'No se pudo subir el archivo. Intenta de nuevo.')}
    const ok=await write(()=>db.collection('docs_cliente').add(Object.assign(base,{tipo:'archivo',assetId:up.id,contentType:up.contentType,tamano:up.sizeBytes,nombreArchivo:file.name})),'Archivo guardado');
    if(ok)back();else fail('El archivo se subió, pero no se pudo registrar. Intenta guardar otra vez.');
  });
}
function histImport(cid){
  openModal(mtop('Cargar empresas ya trabajadas',`${esc(cname(cid))}. Sube un Excel o CSV con las empresas que ya se prospectaron para este cliente.`)+
  `<div class="form"><div class="full drop" id="hi-drop"><input type="file" id="hi-file" accept=".xlsx,.csv" aria-label="Archivo de empresas ya trabajadas"><span class="dico">${ic('upload',20)}</span><div class="label">Elige el archivo</div><div class="hint">Se usa la columna de empresa (o la primera columna). Las repetidas se ignoran.</div><div class="ok" id="hi-ok"></div></div><p class="err-text full" id="hi-err" hidden></p>
  <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri" id="hi-s" disabled>Agregar al historial</button></div></div>`);
  let nuevas=[];
  $('#hi-file').addEventListener('change',async()=>{const f=$('#hi-file').files[0];if(!f)return;$('#hi-err').hidden=true;
    try{const t=await parseTable(f);const ci=empCol(t.cols);const H=D.hist[cid]||new Set();const seen=new Set();nuevas=[];
      t.body.forEach(r=>{const n=normEmp(r[ci]);if(n&&!H.has(n)&&!seen.has(n)){seen.add(n);nuevas.push([n,String(r[ci]).slice(0,120),TODAY(),'carga manual'])}});
      $('#hi-ok').innerHTML=`✓ ${esc(f.name)}<small>${fmt(t.body.length)} filas · columna «${esc(t.cols[ci])}» · ${fmt(nuevas.length)} empresas nuevas para el historial</small>`;$('#hi-s').disabled=!nuevas.length}
    catch(e){$('#hi-err').textContent='No se pudo leer el archivo. Debe ser .xlsx o .csv con una fila de encabezados.';$('#hi-err').hidden=false}});
  $('#hi-s').addEventListener('click',async()=>{$('#hi-s').disabled=true;const snap=await db.collection('historial').where('clienteId','==',cid).get();let k=snap.size;
    for(let i=0;i<nuevas.length;i+=2000){const part=nuevas.slice(i,i+2000);const ok=await write(()=>db.doc(`historial/${cid}-${k}`).set({clienteId:cid,parte:k,empresas:part,actualizado:new Date().toISOString()}));if(!ok)return;k++}
    toast(`${fmt(nuevas.length)} empresas agregadas al historial`);closeModal()});
}
function modalEditCli(id){
  const c=D.clientes.find(x=>x.id===id)||{};
  const F=[['nombre','Nombre del cliente','input',1],['industria','Industria del cliente','input'],['pais','País o mercado','input'],['estado','Estado','estado'],['icp','Perfil de empresa a prospectar','text',1],['industrias','Industrias objetivo','text'],['zonas','Zonas','text'],['cargos','Cargos objetivo','text'],['exclusiones','Exclusiones','text'],['avances','Avances','text',1],['proximos','Próximos pasos','text',1],['contexto','Contexto completo','long',1],['docUrl','Enlace al resumen en Drive','input',1]];
  openModal(mtop(id?'Editar ficha':'Agregar cliente','Lo normal es que Claude actualice estas fichas desde los resúmenes de Drive. Úsalo para ajustes puntuales.')+
  `<form class="form" id="fCli">${F.map(([k,t,ty,full])=>`<label class="${full||ty==='text'?'full':''}">${t}${ty==='input'?`<input id="cl-${k}" value="${esc(c[k]||'')}" ${k==='nombre'?'required':''} maxlength="${k==='docUrl'?500:140}">`:ty==='estado'?`<select id="cl-${k}"><option value="activo">Activo</option><option value="pausado" ${c.estado==='pausado'?'selected':''}>Pausado</option></select>`:ty==='long'?`<textarea id="cl-${k}" maxlength="120000" style="min-height:220px">${esc(c[k]||'')}</textarea>`:`<textarea id="cl-${k}" maxlength="4000">${esc(c[k]||'')}</textarea>`}</label>`).join('')}
  <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri">Guardar ficha</button></div></form>`,true);
  $('#fCli').addEventListener('submit',async e=>{e.preventDefault();const o={};F.forEach(([k])=>o[k]=$('#cl-'+k).value.trim());if(!o.nombre)return;o.actualizado=new Date().toISOString();const cid=id||slug(o.nombre);
    const ok=await write(()=>db.doc('clientes/'+cid).set(o),'Ficha guardada');if(ok)closeModal()});
}
function modalNewReg(){
  if(readOnly){toast('En la versión de consulta el avance no se guarda. Envíale tus cifras a tu líder.',true);return}
  if(!db){toast('No hay conexión con los datos del equipo. Recarga la página para registrar avance.',true);return}
  openModal(mtop('Registrar avance','Anota lo que hiciste en el día o la semana. Esto alimenta la reportería del equipo.')+
  `<form class="form" id="fReg">
   <label>Fecha<input id="rg-f" type="date" value="${TODAY()}" max="${TODAY()}" required></label>
   <label>Cliente<select id="rg-c">${cliOpts(S.cli,true)}</select></label>
   <label>Empresas investigadas<input id="rg-e" type="number" min="0" step="1" value="0"></label>
   <label>Contactos encontrados<input id="rg-k" type="number" min="0" step="1" value="0"></label>
   <label class="full">Nota <span class="hint">Opcional: fuentes usadas, problemas, ideas</span><textarea id="rg-n" maxlength="1000"></textarea></label>
   <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri" id="rg-s">Guardar registro</button></div></form>`);
  $('#fReg').addEventListener('submit',async e=>{e.preventDefault();const n=x=>Math.max(0,Math.round(+$(x).value||0));
    const o={por:myId||'',email:myMail(),fecha:$('#rg-f').value||TODAY(),clienteId:$('#rg-c').value,empresas:n('#rg-e'),contactos:n('#rg-k'),cargados:0,nuevos:0,existentes:0,revisar:0,fuente:'manual',nota:$('#rg-n').value.trim(),creado:new Date().toISOString()};
    if(!o.empresas&&!o.contactos){toast('Anota al menos una cifra mayor que cero.',true);return}
    $('#rg-s').disabled=true;const ok=await write(()=>db.collection('registro').add(o),'Avance registrado');if(ok)closeModal();else $('#rg-s').disabled=false});
}
function modalConfig(){
  const m=D.metas||{};
  openModal(mtop('Configurar equipo y metas','Quiénes forman el equipo de prospección y sus metas semanales. La reportería ajusta las metas al período elegido.')+
  `<form class="form" id="fCfg"><label class="full">Prospectoras del equipo <span class="hint">Una por línea, con el formato «Nombre, correo»</span><textarea id="cf-eq" style="min-height:110px">${esc(roster().map(x=>(x.nombre||'')+', '+x.email).join('\n'))}</textarea></label><fieldset class="full" style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:grid;gap:6px"><legend style="font-size:12.5px;font-weight:600;color:var(--muted);padding:0 4px">Clientes vigentes sin ficha <span class="hint">Los no marcados se muestran como ex clientes</span></legend><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:4px 12px">${allClients().filter(c=>!c.ficha).map(c=>`<label style="display:flex;gap:8px;align-items:center;font-weight:500;color:var(--text);font-size:13px"><input type="checkbox" class="cf-act" value="${esc(c.id)}" ${ACTIVOS.includes(c.id)?'checked':''} style="width:auto">${esc(c.nombre)}</label>`).join('')||'<span class="muted">Todos los clientes tienen ficha.</span>'}</div></fieldset><label>Empresas investigadas por semana<input id="cf-e" type="number" min="0" step="1" value="${esc(m.empresasSemana||'')}" placeholder="Ej.: 60"></label><label>Contactos encontrados por semana<input id="cf-c" type="number" min="0" step="1" value="${esc(m.contactosSemana||'')}" placeholder="Ej.: 150"></label>
  <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri">Guardar metas</button></div></form>`);
  $('#fCfg').addEventListener('submit',async e=>{e.preventDefault();
    const mem=$('#cf-eq').value.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const mm=l.match(/^(.*?)[,;]?\s*<?([\w.+-]+@[\w-]+\.[\w.-]+)>?\s*$/);return mm?{nombre:mm[1].replace(/[,;(]\s*$/,'').trim(),email:mm[2].toLowerCase()}:null}).filter(Boolean);
    const okEq=await write(()=>db.doc('config/equipo').set({miembros:mem,actualizado:new Date().toISOString()}));if(!okEq)return;
    const act=[...document.querySelectorAll('.cf-act:checked')].map(x=>x.value);const okAc=await write(()=>db.doc('config/clientes').set({activos:act,actualizado:new Date().toISOString()}));if(!okAc)return;
    const ok=await write(()=>db.doc('config/metas').set({empresasSemana:Math.max(0,+$('#cf-e').value||0),contactosSemana:Math.max(0,+$('#cf-c').value||0),actualizado:new Date().toISOString()}),'Configuración guardada');if(ok)closeModal()});
}
function modalEditMant(){
  openModal(mtop('Agregar ítem de mantenimiento','Registra un riesgo o mejora del portal para decidir cuándo ejecutarlo.')+
  `<form class="form" id="fMt"><label class="full">Título<input id="mt-t" required maxlength="160"></label><label>Prioridad<select id="mt-p">${Object.entries(MPRIO).map(([k,v])=>`<option value="${k}" ${k==='medio'?'selected':''}>${v.t}</option>`).join('')}</select></label><label>Esfuerzo<input id="mt-e" maxlength="120" placeholder="Ej.: Bajo, una tarde"></label><label class="full">Dónde<input id="mt-d" maxlength="200"></label><label class="full">Por qué importa<textarea id="mt-w" maxlength="2000"></textarea></label><label class="full">Qué hacer<textarea id="mt-a" maxlength="2000"></textarea></label>
  <div class="mact full"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button class="btn pri">Guardar ítem</button></div></form>`);
  $('#fMt').addEventListener('submit',async e=>{e.preventDefault();const num=D.mant.reduce((m,i)=>Math.max(m,i.num||0),0)+1;const ok=await write(()=>db.collection('mantenimiento').add({num,titulo:$('#mt-t').value.trim(),prioridad:$('#mt-p').value,esfuerzo:$('#mt-e').value.trim(),donde:$('#mt-d').value.trim(),porque:$('#mt-w').value.trim(),accion:$('#mt-a').value.trim(),estado:'pendiente',actualizado:new Date().toISOString()}),'Ítem agregado');if(ok)closeModal()});
}

/* ---------- eventos delegados ---------- */
onDoc('click',async e=>{
  const t=e.target.closest('[data-kf],[data-kl],[data-cuenta],[data-k-tomar],[data-view],[data-act],[data-per],[data-rf],[data-req],[data-cli],[data-who],[data-del-reg],[data-plan-av],[data-plan-ent],[data-plan-sg],[data-plan-reopen],[data-plan-del],[data-efe-det],[data-pp-del],[data-pp-act],[data-eval],[data-doc-ver],[data-doc-del]');if(!t)return;
  if(t.dataset.kf){S.kf=t.dataset.kf;renderAll();return}
  if(t.dataset.kl){S.kl=t.dataset.kl;renderAll();return}
  if(t.dataset.cuenta){modalCuenta(t.dataset.cuenta);return}
  if(t.dataset.kTomar){const me=myKey();if(!me||!me.includes('@')){toast('Primero elige tu nombre en el aviso «¿Quién eres?».',true);return}await write(()=>db.doc('cuentas/'+t.dataset.kTomar).update({prospectora:me,estadoTrabajo:'asignada',actualizado:new Date().toISOString()}),'Cuenta asignada a ti');return}
  if(t.dataset.docVer){const r=document.getElementById('dv-'+t.dataset.docVer);if(r){r.hidden=!r.hidden;t.textContent=r.hidden?'Leer':'Ocultar'}return}
  if(t.dataset.docDel){const d=D.docs.find(x=>x.id===t.dataset.docDel);if(!d)return;if(t.dataset.sure!=='1'){t.dataset.sure='1';t.textContent='¿Eliminar?';return}
    if(d.assetId&&assetsCap){try{await assetsCap.delete(d.assetId)}catch(e){toast('No se pudo borrar el archivo.',true);return}}
    await write(()=>db.doc('docs_cliente/'+d.id).delete(),'Documento eliminado');return}
  if(t.dataset.efeDet!=null){modalEfe(t.dataset.efeDet);return}
  if(t.dataset.ppAct){propAct(t);return}
  if(t.dataset.ppDel){if(t.dataset.sure!=='1'){t.dataset.sure='1';t.textContent='¿Quitar?';return}await write(()=>db.doc('plan/'+t.dataset.ppDel).delete(),'Fila quitada');return}
  if(t.dataset.planAv){modalPlanAv(t.dataset.planAv);return}
  if(t.dataset.planEnt){modalPlanEnt(t.dataset.planEnt);return}
  if(t.dataset.planSg){modalPlanSg(t.dataset.planSg);return}
  if(t.dataset.planReopen){const r=D.plan.find(x=>x.id===t.dataset.planReopen);if(!r)return;if(t.dataset.sure!=='1'){t.dataset.sure='1';t.textContent=r.registroId?'¿Reabrir y borrar la entrega?':'¿Reabrir?';return}if(r.registroId)await write(()=>db.doc('registro/'+r.registroId).delete());await write(()=>db.doc('plan/'+r.id).update({estado:'planificada',empresas:0,contactos:0,motivo:'',detalle:'',registroId:'',actualizado:new Date().toISOString()}),'Asignación reabierta');return}
  if(t.dataset.planDel){if(t.dataset.sure!=='1'){t.dataset.sure='1';t.textContent='¿Quitar?';return}await write(()=>db.doc('plan/'+t.dataset.planDel).delete(),'Asignación quitada');return}
  if(t.dataset.view){S.view=t.dataset.view;try{history.replaceState(null,'','#'+S.view)}catch(_){}closeModalIfOpen();renderAll();scrollMain(0,0);return}
  if(t.dataset.per){S.per=t.dataset.per;renderAll();return}
  if(t.dataset.rf){S.rf=t.dataset.rf;renderAll();return}
  if(t.dataset.delReg){if(t.dataset.sure!=='1'){t.dataset.sure='1';t.textContent='¿Eliminar?';return}await write(()=>db.doc('registro/'+t.dataset.delReg).delete(),'Registro eliminado');return}
  const a=t.dataset.act;
  if(a==='close'){closeModal();return}
  if(a==='sem-prev'){S.sem=addDays(S.sem,-7);renderAll();return}
  if(a==='sem-next'){S.sem=addDays(S.sem,7);renderAll();return}
  if(a==='sem-hoy'){S.sem=mondayOf();renderAll();return}
  if(a==='plan-add'){modalPlanAdd();return}
  if(a==='fer-edit'){modalFer();return}
  if(a==='plan-copy'){planCopy();return}
  if(a==='ver-cuentas'){S.cli=t.dataset.id;S.kf='aprobadas';S.view='cuentas';try{history.replaceState(null,'','#cuentas')}catch(_){}closeModalIfOpen();renderAll();scrollMain(0,0);return}
  if(a==='hist-import'){histImport(t.dataset.id);return}
  if(a==='doc-add'){modalDocAdd(t.dataset.id);return}
  if(a==='new-req'){modalNewReq(t.dataset.cli);return}
  if(a==='new-reg'){modalNewReg();return}
  if(a==='config'){modalConfig();return}
  if(a==='edit-cli'){modalEditCli(t.dataset.id);return}
  if(a==='edit-mant'){modalEditMant();return}
  if(a==='clear'){S.cli='';S.who='';renderAll();return}
  if(t.dataset.req){modalReq(t.dataset.req);return}
  if(t.dataset.cli&&!a){modalCli(t.dataset.cli);return}
  if(t.dataset.who){S.who=t.dataset.who;renderAll();return}
});
function closeModalIfOpen(){if(!$('#modal').hidden)closeModal()}
onDoc('change',async e=>{
  const t=e.target;
  if(t.dataset&&t.dataset.pp){const k=t.dataset.pp;let v=t.value;if(k==='meta'||k==='prioridad')v=Math.max(0,Math.round(+v||0));await write(()=>db.doc('plan/'+t.dataset.id).update({[k]:v,actualizado:new Date().toISOString()}),'Cambio guardado');return}
  if(t.id==='fCli'){S.cli=t.value;renderAll();return}
  if(t.id==='fWho'){S.who=t.value;renderAll();return}
  if(t.id==='efeSem'){S.efeSem=t.value;renderAll();return}
  if(t.dataset&&t.dataset.kPro!==undefined){const v=t.value;const r=D.cuentas.find(x=>x.id===t.dataset.kPro);const patch={prospectora:v,actualizado:new Date().toISOString()};if(v&&r&&(!r.estadoTrabajo||r.estadoTrabajo==='por_asignar'))patch.estadoTrabajo='asignada';if(!v)patch.estadoTrabajo='por_asignar';await write(()=>db.doc('cuentas/'+t.dataset.kPro).update(patch),v?'Prospectora asignada':'Asignación quitada');return}
  if(t.dataset&&t.dataset.kEst!==undefined){await write(()=>db.doc('cuentas/'+t.dataset.kEst).update({estadoTrabajo:t.value,actualizado:new Date().toISOString()}),'Estado actualizado');return}
  if(t.dataset&&t.dataset.mest){await write(()=>db.doc('mantenimiento/'+t.dataset.mest).update({estado:t.value,actualizado:new Date().toISOString()}),'Estado actualizado')}
});

/* ================= Módulo de cruce Lemlist ↔ HubSpot ================= */
const CX=(function(){
  const FIELDS=['nombre','apellido','empresa','email','linkedin'];
  const LBL={nombre:'Nombre',apellido:'Apellido',empresa:'Empresa',email:'Email',linkedin:'LinkedIn URL'};
  const KW={nombre:['first name','firstname','nombre','name'],apellido:['last name','lastname','apellido','surname'],empresa:['company','empresa','organization','organización','account'],email:['email','e-mail','correo','mail'],linkedin:['linkedin','li url','profile url','perfil']};
  let st={hubspot:null,lemlist:null,hubspotMap:{},lemlistMap:{}},res=null,saved=false;
  const fold=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'');
  const nT=t=>fold((t==null?'':String(t)).trim().toLowerCase()).replace(/\s+/g,' ');
  const nE=e=>(e==null?'':String(e)).trim().toLowerCase();
  const nL=u=>{if(u==null)return '';let s=String(u).trim().toLowerCase();if(!s)return '';s=s.replace(/^https?:\/\//,'').replace(/^www\./,'').split('?')[0].split('#')[0].replace(/\/+$/,'');return s};
  function cellText(c){try{const t=c.text;if(t!=null)return String(t)}catch(e){}const v=c.value;if(v==null)return '';if(typeof v==='object'){if(v.richText)return v.richText.map(x=>x.text).join('');if(v.text)return String(v.text);if(v.result!=null)return String(v.result);if(v instanceof Date)return ymd(v)}return String(v)}
  async function parse(file){
    let rows;
    if(/\.csv$/i.test(file.name)){let txt=await file.text();if(txt.charCodeAt(0)===0xFEFF)txt=txt.slice(1);rows=Papa.parse(txt,{skipEmptyLines:'greedy'}).data}
    else if(/\.xlsx$/i.test(file.name)){const wb=new ExcelJS.Workbook();await wb.xlsx.load(await file.arrayBuffer());const ws=wb.worksheets[0];if(!ws)throw new Error('vacío');rows=[];ws.eachRow({includeEmpty:false},row=>{const v=[];row.eachCell({includeEmpty:true},(c,col)=>{v[col-1]=cellText(c)});rows.push(Array.from(v,x=>x==null?'':x))})}
    else throw new Error('formato');
    rows=rows.filter(r=>r.some(c=>String(c).trim()!==''));
    if(rows.length<2)throw new Error('pocas');
    const headers=rows[0].map(h=>String(h).trim());
    return{headers,rows:rows.slice(1).map(r=>{const o=r.slice(0,Math.max(r.length,headers.length));while(o.length<headers.length)o.push('');return o})};
  }
  function guess(h){const m={},lw=h.map(x=>x.toLowerCase());FIELDS.forEach(f=>{let i=-1;for(const k of KW[f]){i=lw.findIndex(x=>x.includes(k));if(i!==-1)break}m[f]=i});return m}
  function setupDrop(dropId,inputId,side){const d=$('#'+dropId),inp=$('#'+inputId);d.querySelector('.dico').innerHTML=ic('upload',22);
    inp.addEventListener('change',()=>{if(inp.files[0])handle(inp.files[0],side)});
    d.addEventListener('dragover',e=>{e.preventDefault();d.classList.add('drag')});d.addEventListener('dragleave',()=>d.classList.remove('drag'));
    d.addEventListener('drop',e=>{e.preventDefault();d.classList.remove('drag');if(e.dataTransfer.files[0])handle(e.dataTransfer.files[0],side)})}
  async function handle(file,side){const er=$('#cx-upload-err');er.hidden=true;const nm=side==='hubspot'?'HubSpot':'Lemlist';
    try{const r=await parse(file);st[side]=r;$('#'+side+'-ok').innerHTML=`✓ ${esc(file.name)}<small>${fmt(r.rows.length)} filas · ${r.headers.length} columnas</small>`;if(st.hubspot&&st.lemlist){$('#cx2').dataset.disabled='false';mapping()}}
    catch(e){const m=e.message;er.textContent=`${nm}: `+(m==='formato'?'el archivo debe ser .xlsx o .csv. Si tienes un .xls antiguo, ábrelo en Excel y guárdalo como .xlsx.':m==='pocas'?'el archivo no tiene datos suficientes (se espera una fila de encabezado y al menos una fila de datos).':'no se pudo leer el archivo. Verifica que sea un .xlsx o .csv válido.');er.hidden=false}}
  function mapping(){st.hubspotMap=guess(st.hubspot.headers);st.lemlistMap=guess(st.lemlist.headers);mapCol('map-hubspot',st.hubspot.headers,'hubspotMap','h');mapCol('map-lemlist',st.lemlist.headers,'lemlistMap','l')}
  function mapCol(cid,headers,key,pre){const c=$('#'+cid);c.innerHTML='';FIELDS.forEach(f=>{const row=document.createElement('div');row.className='map-row';const lb=document.createElement('label');lb.textContent=LBL[f];lb.htmlFor='m'+pre+f;const s=document.createElement('select');s.id='m'+pre+f;
    const o0=document.createElement('option');o0.value=-1;o0.textContent='No disponible';s.appendChild(o0);
    headers.forEach((h,i)=>{const o=document.createElement('option');o.value=i;o.textContent=h||`(columna ${i+1})`;if(st[key][f]===i)o.selected=true;s.appendChild(o)});
    s.addEventListener('change',()=>{st[key][f]=parseInt(s.value,10)});row.append(lb,s);c.appendChild(row)})}
  function rec(row,map){const g=f=>{const i=map[f];return(i==null||i<0)?'':(row[i]!=null?row[i]:'')};const raw={nombre:g('nombre'),apellido:g('apellido'),empresa:g('empresa'),email:g('email'),linkedin:g('linkedin')};
    return{raw,e:nE(raw.email),l:nL(raw.linkedin),n:nT(raw.nombre),a:nT(raw.apellido),c:nT(raw.empresa)}}
  const nc=r=>`${r.n}|${r.a}|${r.c}`;
  function dedupe(rows,map){const seen=new Set(),kept=[];let rm=0;rows.forEach(row=>{const r=rec(row,map);const k=`${r.e}||${r.l}||${nc(r)}`;if(seen.has(k)){rm++;return}seen.add(k);kept.push(row)});return{rows:kept,removed:rm}}
  function idx(rows,map){const E=new Map(),Li=new Map(),N=new Map();const add=(m,k,r)=>{if(!m.has(k))m.set(k,[]);m.get(k).push(r)};rows.forEach(row=>{const r=rec(row,map);if(r.e)add(E,r.e,r);if(r.l)add(Li,r.l,r);if(r.n&&r.a&&r.c)add(N,nc(r),r)});return{E,Li,N}}
  function classify(l,I){const cand=[];const push=a=>{if(a)a.forEach(c=>{if(!cand.includes(c))cand.push(c)})};push(I.E.get(l.e));push(I.Li.get(l.l));if(l.n&&l.a&&l.c)push(I.N.get(nc(l)));
    if(!cand.length)return{s:'Nuevo',m:'Sin coincidencia con ningún contacto de HubSpot'};
    for(const h of cand){const em=(l.e&&h.e)?l.e===h.e:null,lm=(l.l&&h.l)?l.l===h.l:null,nm=!!(l.n&&l.a&&l.c&&l.n===h.n&&l.a===h.a&&l.c===h.c);
      if(em===true&&lm!==false)return{s:'Ya existe en HubSpot',m:lm===true?'Email y LinkedIn coinciden':'Email coincide (identificador único)'};
      if(lm===true&&em!==false)return{s:'Ya existe en HubSpot',m:'URL de LinkedIn coincide (identificador único)'};
      if(nm&&em!==false&&lm!==false)return{s:'Ya existe en HubSpot',m:'Nombre, apellido y empresa coinciden'};
      if(em===true&&lm===false)return{s:'Revisar manualmente',m:'Mismo email pero LinkedIn distinta'};
      if(lm===true&&em===false)return{s:'Revisar manualmente',m:'Misma LinkedIn pero email distinto'};
      if(nm&&em===false)return{s:'Revisar manualmente',m:'Mismo nombre y empresa pero email distinto'}}
    return{s:'Revisar manualmente',m:'Coincidencia parcial detectada, requiere revisión'}}
  const okMap=m=>!(m.email<0&&m.linkedin<0&&(m.nombre<0||m.apellido<0||m.empresa<0));
  function process(){const er=$('#cx-map-err');er.hidden=true;
    if(!okMap(st.hubspotMap)||!okMap(st.lemlistMap)){er.textContent=`En ${!okMap(st.hubspotMap)?'HubSpot':'Lemlist'} necesitas mapear al menos Email, LinkedIn URL, o Nombre + Apellido + Empresa.`;er.hidden=false;return}
    const hd=dedupe(st.hubspot.rows,st.hubspotMap),ld=dedupe(st.lemlist.rows,st.lemlistMap);const I=idx(hd.rows,st.hubspotMap);
    const empresas=new Set();
    const rows=ld.rows.map(row=>{const r=rec(row,st.lemlistMap);if(r.c)empresas.add(r.c);const c=classify(r,I);return{cells:row,status:c.s,motivo:c.m}});
    res={headers:st.lemlist.headers,rows,hRm:hd.removed,lRm:ld.removed,empresas:empresas.size};saved=false;show()}
  function counts(){const c=s=>res.rows.filter(r=>r.status===s).length;return{total:res.rows.length,ex:c('Ya existe en HubSpot'),nw:c('Nuevo'),rv:c('Revisar manualmente')}}
  function show(){$('#cx3').hidden=false;const k=counts();$('#cx-total').textContent=fmt(k.total);$('#cx-exists').textContent=fmt(k.ex);$('#cx-new').textContent=fmt(k.nw);$('#cx-review').textContent=fmt(k.rv);
    const n=[];if(res.lRm)n.push(`${res.lRm} duplicado(s) removido(s) del archivo de Lemlist`);if(res.hRm)n.push(`${res.hRm} duplicado(s) removido(s) del archivo de HubSpot`);$('#cx-dedup').textContent=n.length?n.join(' · '):'Sin duplicados internos detectados';
    document.querySelectorAll('#cx-filter button').forEach(b=>b.classList.toggle('on',b.dataset.f==='todos'));table('todos');paintSave();$('#cx3').scrollIntoView({behavior:'smooth',block:'start'})}
  function table(f){const hd=[...res.headers,'Estado del cruce','Motivo'];$('#cx-head').innerHTML=hd.map(h=>`<th>${esc(h)}</th>`).join('');
    const rows=f==='todos'?res.rows:res.rows.filter(r=>r.status===f);const cls={'Ya existe en HubSpot':'st-ex','Nuevo':'st-nw','Revisar manualmente':'st-rv'};
    let h=rows.slice(0,500).map(r=>`<tr class="${r.status==='Revisar manualmente'?'rv':''}">${res.headers.map((_,i)=>`<td title="${esc(r.cells[i])}">${esc(r.cells[i])}</td>`).join('')}<td class="${cls[r.status]}">${esc(r.status)}</td><td class="muted">${esc(r.motivo)}</td></tr>`).join('');
    if(rows.length>500)h+=`<tr><td colspan="${hd.length}" class="muted" style="text-align:center;padding:12px">Se muestran 500 de ${fmt(rows.length)} filas. El Excel descargado incluye todas.</td></tr>`;
    $('#cx-body').innerHTML=h}
  async function download(){const b=$('#cx-download');b.disabled=true;const old=b.innerHTML;b.innerHTML='<span class="spin"></span> Preparando…';
    try{const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Cruce Lemlist-HubSpot');const hd=[...res.headers,'Estado del cruce','Motivo'];ws.addRow(hd);const h1=ws.getRow(1);h1.font={bold:true,color:{argb:'FF151A36'}};h1.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE9EDF6'}};ws.views=[{state:'frozen',ySplit:1}];
      const amber={type:'pattern',pattern:'solid',fgColor:{argb:'FFFCE383'}};const col={'Ya existe en HubSpot':'FF12A970','Nuevo':'FF3D5AFE','Revisar manualmente':'FF8A6A10'};
      res.rows.forEach(r=>{const v=[...r.cells];while(v.length<res.headers.length)v.push('');v.push(r.status,r.motivo);const row=ws.addRow(v);if(r.status==='Revisar manualmente')row.eachCell({includeEmpty:true},c=>{c.fill=amber});row.getCell(hd.length-1).font={bold:true,color:{argb:col[r.status]}}});
      ws.columns.forEach((c,i)=>{let mx=String(hd[i]||'').length;res.rows.forEach(r=>{const v=i<res.headers.length?r.cells[i]:(i===hd.length-2?r.status:r.motivo);if(v&&String(v).length>mx)mx=String(v).length});c.width=Math.min(Math.max(mx+2,10),45)});
      const buf=await wb.xlsx.writeBuffer();const d=new Date();await saveFile(`cruce_lemlist_hubspot_${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}.xlsx`,new Blob([buf]))}
    catch(e){toast('No se pudo generar el Excel. Intenta de nuevo.',true)}finally{b.disabled=false;b.innerHTML=old}}
  function paintSave(){const box=$('#cx-save');if(!res){return}box.hidden=false;const msg=$('#cx-save-msg'),btn=$('#cx-save-btn');
    if(readOnly){btn.hidden=true;$('#cx-client').hidden=true;msg.textContent=`Esta versión no guarda datos. Envía a tu líder los totales: ${fmt(res.empresas)} empresas, ${fmt(res.rows.length)} contactos, ${fmt(counts().nw)} nuevos, ${fmt(counts().ex)} ya en HubSpot.`;return}
    if(!db){btn.disabled=true;msg.textContent='Disponible con conexión a los datos del equipo. Recarga la página.';return}
    if(saved){btn.disabled=true;msg.textContent='Guardado en tu registro de avance.';return}
    btn.disabled=false;msg.textContent=`Se guardan solo los totales: ${fmt(res.empresas)} empresas, ${fmt(res.rows.length)} contactos, ${fmt(counts().nw)} nuevos.`}
  async function saveReg(){if(!res||saved)return;const k=counts();const btn=$('#cx-save-btn');btn.disabled=true;
    const ok=await write(()=>db.collection('registro').add({por:myId||'',email:myMail(),fecha:TODAY(),clienteId:$('#cx-client').value||'',empresas:res.empresas,contactos:k.total,cargados:0,nuevos:k.nw,existentes:k.ex,revisar:k.rv,fuente:'cruce',nota:`Cruce Lemlist ↔ HubSpot: ${k.rv} contactos a revisar manualmente`,creado:new Date().toISOString()}),'Cruce guardado en la reportería');
    if(ok)saved=true;paintSave()}
  function reset(){st={hubspot:null,lemlist:null,hubspotMap:{},lemlistMap:{}};res=null;saved=false;$('#file-hubspot').value='';$('#file-lemlist').value='';$('#hubspot-ok').innerHTML='';$('#lemlist-ok').innerHTML='';$('#cx2').dataset.disabled='true';$('#cx3').hidden=true;$('#map-hubspot').innerHTML='';$('#map-lemlist').innerHTML='';$('#cx-upload-err').hidden=true;scrollMain({top:0,behavior:'smooth'})}
  setupDrop('drop-hubspot','file-hubspot','hubspot');setupDrop('drop-lemlist','file-lemlist','lemlist');
  $('#cx-process').addEventListener('click',process);$('#cx-download').addEventListener('click',download);$('#cx-reset').addEventListener('click',reset);$('#cx-save-btn').addEventListener('click',saveReg);
  $('#cx-filter').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!res)return;document.querySelectorAll('#cx-filter button').forEach(x=>x.classList.toggle('on',x===b));table(b.dataset.f)});
  return{paintSave};
})();
function fillCxClients(){const s=$('#cx-client');const h=cliOpts(s.value,true);if(s.dataset.k!==h){const v=s.value;s.innerHTML=h;s.value=v;s.dataset.k=h}CX.paintSave()}

/* ---------- arranque ---------- */
$('#brandMark').innerHTML=ic('target',18);
async function ensureLink(){
  if(!db||readOnly||!myId||!eqLoaded||!vincLoaded||linkTried)return;
  if(VINC[myId]){hideWhoBox();return}
  if(isAdmin)return;
  if(myEmail&&rosterBy(myEmail)){linkTried=true;try{await db.doc('vinculos/'+myId).set({email:myEmail,auto:true,creado:new Date().toISOString()})}catch(e){}return}
  if(roster().length&&canWrite!==false)showWhoBox();
}
function hideWhoBox(){const b=$('#whoBox');if(b)b.remove()}
function showWhoBox(){
  if($('#whoBox'))return;
  const box=document.createElement('div');box.id='whoBox';box.className='banner';box.style.background='var(--primary-soft)';box.style.borderColor='color-mix(in srgb,var(--primary) 35%,transparent)';
  box.innerHTML=`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>¿Quién eres?</b><span class="muted">Elige tu nombre para que tus solicitudes y avances queden a tu nombre en la reportería.</span><select id="whoSel" aria-label="Tu nombre"><option value="">Elige tu nombre</option>${roster().map(m=>`<option value="${esc(String(m.email).toLowerCase())}">${esc(m.nombre||m.email)}</option>`).join('')}</select><button class="btn pri sm" id="whoOk">Confirmar</button></div>`;
  $('#banner').after(box);
  $('#whoOk').addEventListener('click',async()=>{const v=$('#whoSel').value;if(!v){$('#whoSel').focus();return}
    const ok=await write(()=>db.doc('vinculos/'+myId).set({email:v,auto:false,creado:new Date().toISOString()}),'Listo, tu trabajo quedará a tu nombre');if(ok){linkTried=true;hideWhoBox()}});
}
async function boot(){
  renderAll();
  const cl=DEPS.claude;
  if((!cl||typeof cl.use!=='function')&&SNAP){
    readOnly=true;connected=true;
    D.clientes=(SNAP.clientes||[]).slice().sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es'));
    D.solicitudes=(SNAP.solicitudes||[]).slice().sort((a,b)=>String(b.creado).localeCompare(String(a.creado)));
    D.registro=(SNAP.registro||[]).slice().sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)));
    D.mant=SNAP.mantenimiento||[];D.metas=SNAP.metas||null;D.equipo=SNAP.equipo||[];ACTIVOS=SNAP.activos||[];Object.assign(VINC,SNAP.vinculos||{});Object.assign(PROF,SNAP.personas||{});
    D.cuentas=SNAP.cuentas||[];L.c=L.s=L.r=L.m=L.p=L.k=true;
    setBanner(`Versión de consulta con datos al ${niceDate(SNAP.generado)}. El cruce funciona completo. Para pedir una investigación usa «Nueva solicitud» y envíale el texto a tu líder.`);
    renderAll();return}
  if(!cl||typeof cl.use!=='function'){offline=true;setBanner('No pudimos conectar con los datos del equipo. Recarga la página. El cruce de contactos funciona igual.');renderAll();return}
  let dbn,un,dn;
  try{[dbn,un,dn]=await Promise.all([cl.use('db'),cl.use('user'),cl.use('downloads')])}catch(e){}
  cl.use('assets').then(a=>{assetsCap=a||null}).catch(()=>{});
  db=dbn||null;user=un||null;dlc=dn||null;
  if(user){try{const m=await user.me();myId=m.id;isAdmin=!!m.isOwner;if(!isAdmin){let h='';try{h=location.hash}catch(_){}if(!h)S.view='plan'}myEmail=m.email?String(m.email).toLowerCase():null;const c=await user.can('data.write');canWrite=c===null?null:c}catch(e){}}
  if(!db){offline=true;setBanner('No pudimos conectar con los datos del equipo. Vuelve a iniciar sesión en el portal con tu correo corporativo.');renderAll();return}
  connected=true;
  if(canWrite===false)setBanner('Tienes acceso de solo lectura. Para crear solicitudes o registrar avance, pide acceso al líder de prospección.');
  const err=e=>{if(e&&e.code==='revoked')return;setBanner('Se perdió la conexión con los datos del equipo. Recarga la página para reconectar.')};
  const docs=s=>s.docs.map(d=>Object.assign({id:d.id},d.data()));
  db.collection('clientes').onSnapshot(s=>{D.clientes=docs(s).sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es'));L.c=true;sched()},err);
  db.collection('solicitudes').orderBy('creado','desc').limit(500).onSnapshot(s=>{D.solicitudes=docs(s);L.s=true;sched()},err);
  db.collection('registro').orderBy('fecha','desc').limit(1000).onSnapshot(s=>{D.registro=docs(s);L.r=true;sched()},err);
  db.doc('config/metas').onSnapshot(s=>{D.metas=s.exists?s.data():null;sched()},err);
  db.doc('config/feriados').onSnapshot(s=>{D.fer=s.exists?s.data():null;sched()},err);
  db.collection('mantenimiento').onSnapshot(s=>{D.mant=docs(s);L.m=true;sched()},err);
  db.collection('docs_cliente').onSnapshot(s=>{D.docs=docs(s);if(!$('#modal').hidden&&$('#cli-docs'))paintCliDocs();},err);
  db.collection('cuentas').onSnapshot(s=>{D.cuentas=docs(s);L.k=true;sched()},err);
  db.collection('plan').orderBy('semana','desc').limit(1000).onSnapshot(s=>{const allP=docs(s);D.plan=allP.filter(r=>r.estado!=='propuesta');D.prop=allP.filter(r=>r.estado==='propuesta');L.p=true;sched()},err);
  db.collection('historial').onSnapshot(s=>{const H={};s.docs.forEach(d=>{const x=d.data();const c=x.clienteId;if(!c)return;if(!H[c])H[c]=new Set();(x.empresas||[]).forEach(e=>{if(e&&e[0])H[c].add(e[0])})});D.hist=H;sched()},err);
  db.doc('config/equipo').onSnapshot(s=>{D.equipo=(s.exists&&Array.isArray(s.data().miembros))?s.data().miembros:[];eqLoaded=true;ensureLink();sched()},err);
  db.doc('config/cola').onSnapshot(s=>{D.extra=(s.exists&&s.data().extra)||{};_etaKey='';sched()},err);
  db.doc('config/clientes').onSnapshot(s=>{ACTIVOS=(s.exists&&Array.isArray(s.data().activos))?s.data().activos:[];sched()},err);
  db.collection('vinculos').onSnapshot(s=>{Object.keys(VINC).forEach(k=>delete VINC[k]);s.docs.forEach(d=>{const e=d.data().email;if(e)VINC[d.id]=String(e).toLowerCase()});vincLoaded=true;ensureLink();sched()},err);
  renderAll();
}
boot();
return function unmount(){__ac.abort();try{charts.forEach(c=>{try{c.destroy()}catch(e){}})}catch(e){}if(DEPS.claude&&DEPS.claude.__stop)DEPS.claude.__stop()};
}
