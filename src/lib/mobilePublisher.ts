import { PacModel, PublishConfig } from '../types/pac';
import { fmtDateFr, fmtShortDateFr } from './pacEngine';

const roundOpt = (x: number | null | undefined, n = 2): number | null =>
  x === null || x === undefined || Number.isNaN(x) ? null : Number(x.toFixed(n));

export interface MobilePayload {
  maj: string;
  kpi: {
    jours: number;
    hy: string;
    eco: [number | null, number | null, number | null];
    benef: [number | null, number | null, number | null];
    obj_eur: number;
    obj_pct: number;
    cop_rentab: number | null;
    cop_cible: number | null;
  };
  last: {
    date: string;
    dep: number | null;
    ref_n1: number | null;
    ref_mean: number | null;
    cop: number | null;
    verdict: string;
    temp: number | null;
    temp_ref: number | null;
    refs: (number | null)[];
    eco_n1: number | null;
    benef_n1: number | null;
    hors_pac: number | null;
    elec_ref_kwh: number | null;
  } | null;
  traj: { d: string; n1: number | null; obj: number | null; reel: number | null }[];
  mois: {
    l: string;
    j: number;
    t: number | null;
    n1: number | null;
    mm: number | null;
    n1f: number | null;
    eco: number | null;
    cop: number | null;
  }[];
  jours: {
    d: string;
    dep: number | null;
    n1: number | null;
    obj: number | null;
    cum: number | null;
  }[];
  cops: { d: string; cop: number | null; aff: number | null }[];
  year_n1: {
    labels: string[];
    gaz: (number | null)[];
    elec: (number | null)[];
    total_n1: (number | null)[];
    pac: (number | null)[];
  } | null;
}

export function buildMobilePayload(model: PacModel): MobilePayload {
  const k = model.kpi;
  const last = model.last;
  const ds = model.hy_days.slice(-60);
  const allc = model.days.filter((r) => r.cop !== null).slice(-60);
  const obj = k.obj_pct;

  let year_n1: MobilePayload['year_n1'] = null;
  if (model.year_n1) {
    const yn = model.year_n1;
    const order = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const hy0Year = Number(k.hy0.slice(0, 4));
    const monthly = new Map<number, number>();
    for (const m of model.months) {
      if (!(m.y === hy0Year && m.m === 9)) {
        monthly.set(m.m, m.reel);
      }
    }
    const pacVals = order.map((mn) => monthly.get(mn) ?? null);
    year_n1 = {
      labels: yn.labels,
      gaz: yn.gaz.map((x) => roundOpt(x)),
      elec: yn.elec.map((x) => roundOpt(x)),
      total_n1: yn.gaz.map((g, idx) => roundOpt((g || 0) + (yn.elec[idx] || 0))),
      pac: pacVals.map((v) => roundOpt(v)),
    };
  }

  const now = new Date();
  const maj = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')}`;

  return {
    maj,
    kpi: {
      jours: k.jours,
      hy: `${fmtDateFr(k.hy0)} au ${fmtDateFr(k.hy1)}`,
      eco: [roundOpt(k.eco_cumul), roundOpt(k.eco_mois), roundOpt(k.eco_jour)],
      benef: [roundOpt(k.benef_cumul, 3), roundOpt(k.benef_mois, 3), roundOpt(k.benef_jour, 3)],
      obj_eur: k.obj_eur,
      obj_pct: obj,
      cop_rentab: roundOpt(k.cop_rentab),
      cop_cible: roundOpt(k.cop_cible),
    },
    last: last
      ? {
          date: fmtDateFr(last.date),
          dep: roundOpt(last.depense),
          ref_n1: roundOpt(last.ref_n1),
          ref_mean: roundOpt(last.ref_mean),
          cop: roundOpt(last.cop),
          verdict: last.verdict,
          temp: last.entry.temp,
          temp_ref: roundOpt(last.temp_ref, 1),
          refs: last.refs.map((v) => roundOpt(v)),
          eco_n1: roundOpt(last.eco_n1),
          benef_n1: roundOpt(last.benef_n1, 3),
          hors_pac: roundOpt(last.hors_pac, 1),
          elec_ref_kwh: roundOpt(last.elec_ref_kwh, 1),
        }
      : null,
    traj: model.traj.map((t) => ({
      d: fmtShortDateFr(t.date),
      n1: roundOpt(t.n1, 1),
      obj: roundOpt(t.obj, 1),
      reel: roundOpt(t.reel, 1),
    })),
    mois: model.months.map((m) => ({
      l: m.label + (m.partiel ? ` (${m.jours}/${m.jours_mois} j)` : ''),
      j: m.jours,
      t: roundOpt(m.reel),
      n1: roundOpt(m.ref_n1),
      mm: roundOpt(m.ref_mean),
      n1f: m.partiel ? roundOpt(m.ref_n1_full) : null,
      eco: roundOpt(m.eco),
      cop: roundOpt(m.cop),
    })),
    jours: ds.map((r) => ({
      d: fmtShortDateFr(r.date),
      dep: roundOpt(r.depense),
      n1: roundOpt(r.ref_n1),
      obj: r.ref_n1 !== null ? roundOpt(r.ref_n1 * (1 - obj)) : null,
      cum: roundOpt(r.cumul),
    })),
    cops: allc.map((r) => ({
      d: fmtShortDateFr(r.date),
      cop: roundOpt(r.cop),
      aff: roundOpt(r.entry.cop_aff),
    })),
    year_n1,
  };
}

const MOBILE_HTML_TEMPLATE = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0F172A">
<title>Suivi PAC</title><style>
body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a}
header{background:#0f172a;color:#fff;padding:14px 16px;position:sticky;top:0;z-index:10;box-shadow:0 2px 4px rgba(0,0,0,.15)}header h1{margin:0;font-size:20px}header small{opacity:.85}
.k{background:#0f766e;color:#fff;border-radius:10px;padding:12px;margin:10px}.k h3{margin:0 0 6px;font-size:13px;font-weight:600;opacity:.9}
.k .big{font-size:28px;font-weight:700}.k .row{display:flex;justify-content:space-between;margin-top:8px;font-size:13px}.k .row b{display:block;font-size:16px}
.bar{height:8px;background:rgba(255,255,255,.25);border-radius:4px;margin-top:10px;overflow:hidden}.bar i{display:block;height:100%;background:#a7f3d0}
.k small{display:block;margin-top:4px;opacity:.85}
.card{background:#fff;border-radius:10px;margin:10px;padding:12px;border:1px solid #e2e8f0}
.card h2{font-size:15px;margin:0 0 8px;color:#0f172a}canvas{width:100%;height:220px;display:block}
.v{font-size:16px;font-weight:700}.ok{color:#16a34a}.no{color:#dc2626}.mid{color:#d97706}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:6px 4px;text-align:right;border-bottom:1px solid #e2e8f0}th:first-child,td:first-child{text-align:left}
</style></head><body>
<header><h1>Suivi PAC</h1><small id="maj"></small></header>
<div id="login" style="display:none;padding:16px"><div class="card"><h2>Accès protégé</h2>
<p>Entrez le mot de passe pour afficher le suivi.</p>
<input id="pw" type="password" autocomplete="current-password" style="width:100%;font-size:18px;padding:10px;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:6px">
<label style="display:block;margin:10px 0"><input id="rem" type="checkbox" checked> Rester connecté sur cet appareil</label>
<button id="go" style="width:100%;font-size:18px;padding:12px;background:#0f766e;color:#fff;border:0;border-radius:8px">Ouvrir</button>
<p id="err" class="no"></p></div></div>
<div id="app">
<div id="cards"></div>
<div class="card" id="last"></div>
<div class="card" id="c_day_wrap"><h2>Aujourd'hui (EDF) vs références gaz + élec (€)</h2><canvas id="c_day"></canvas></div>
<div class="card"><h2>1. Dépense de chauffage cumulée sur l'année (€)</h2><canvas id="c1"></canvas></div>
<div class="card"><h2>2. Économie cumulée vs N-1 (€) et objectif</h2><canvas id="c2"></canvas></div>
<div class="card"><h2>3. Économie par mois vs N-1 (€) : mêmes jours</h2><canvas id="c_m_eco"></canvas></div>
<div class="card" id="c_year_wrap"><h2>4. Année de chauffage : N-1 gaz, élec et PAC (€)</h2><canvas id="c_year"></canvas></div>
<div class="card"><h2>5. Dépense du jour (EDF) vs N-1 et objectif (€)</h2><canvas id="c3"></canvas></div>
<div class="card"><h2>6. COP réel (barres) et COP affiché (points)</h2><canvas id="c4"></canvas></div>
<div class="card"><h2>Détail mensuel</h2><table id="tab"></table></div>
</div>
<script>
function render(D){
const f=(x,n=0)=>x==null?'–':x.toLocaleString('fr-FR',{minimumFractionDigits:n,maximumFractionDigits:n});
const sg=(x,n=0)=>x==null?'–':(x>0?'+':'')+f(x,n);
document.getElementById('maj').textContent='Année '+D.kpi.hy+' · Màj '+D.maj;
const K=D.kpi,L=D.last;
const pc=Math.max(0,Math.min(100,(K.eco[0]||0)/K.obj_eur*100));
document.getElementById('cards').innerHTML=
\`<div class="k"><h3>Économie cumulée vs N-1</h3><div class="big">\${sg(K.eco[0])} €</div>
<div class="row"><span>Ce mois<b>\${sg(K.eco[1])} €</b></span><span>Dernier jour<b>\${sg(K.eco[2],2)} €</b></span><span>Objectif<b>\${f(K.obj_eur)} €</b></span></div>
<div class="bar"><i style="width:\${pc}%"></i></div><small>\${f(pc)} % de l'objectif annuel (\${f(K.obj_eur)} €)</small></div>
<div class="k"><h3>Bénéfice vs N-1</h3><div class="big">\${K.benef[0]==null?'–':sg(K.benef[0]*100)} %</div>
<div class="row"><span>Ce mois<b>\${K.benef[1]==null?'–':sg(K.benef[1]*100)} %</b></span><span>Dernier jour<b>\${K.benef[2]==null?'–':sg(K.benef[2]*100)} %</b></span><span>Objectif<b>\${f(K.obj_pct*100)} %</b></span></div></div>\`;
if(L){const cl=L.verdict.startsWith('Moins')?'ok':L.verdict.startsWith('Plus')?'no':'mid';
document.getElementById('last').innerHTML=\`<h2>Dernier jour saisi : \${L.date}</h2><div class="v \${cl}">\${L.verdict||'–'}</div>
<p style="margin:8px 0 0;line-height:1.45">Dépense EDF : <b>\${f(L.dep,2)} €</b> (N-1 gaz+élec : \${f(L.ref_n1,2)} €, moy. : \${f(L.ref_mean,2)} €)<br>
COP réel : <b>\${f(L.cop,2)}</b> · Élec hors PAC : <b>\${f(L.hors_pac,1)} kWh</b><br>Température : <b>\${f(L.temp,1)} °C</b> (habituel \${f(L.temp_ref,1)} °C)</p>\`;}
function setup(id){const c=document.getElementById(id),r=window.devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;
c.width=w*r;c.height=h*r;const g=c.getContext('2d');g.scale(r,r);g.font='11px sans-serif';return [g,w,h];}
function frame(g,w,h,min,max,labels){const m={l:38,r:8,t:18,b:30};const pw=w-m.l-m.r,ph=h-m.t-m.b;
g.strokeStyle='#e2e8f0';g.fillStyle='#64748b';g.textAlign='right';
for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,y=m.t+ph-ph*i/4;g.beginPath();g.moveTo(m.l,y);g.lineTo(w-m.r,y);g.stroke();g.fillText(f(v,max-min<10?1:0),m.l-4,y+4);}
g.textAlign='center';const step=Math.max(1,Math.ceil(labels.length/7));labels.forEach((t,i)=>{if(i%step==0||i===labels.length-1)g.fillText(t,m.l+pw*(i+.5)/labels.length,h-10);});
return {m,pw,ph,y:v=>m.t+ph-ph*(v-min)/((max-min)||1)};}
function legend(g,items){let x=40;items.forEach(([n,c])=>{g.fillStyle=c;g.fillRect(x,3,10,10);g.fillStyle='#334155';g.textAlign='left';g.fillText(n,x+13,12);x+=g.measureText(n).width+24;});}
function bars(id,labels,series,extra){const [g,w,h]=setup(id);let vals=series.flatMap(s=>s.v).concat(extra||[]).filter(v=>v!=null);
const max=Math.max(1,...vals)*1.1,min=Math.min(0,...vals);const F=frame(g,w,h,min,max,labels);const n=series.length,bw=F.pw/labels.length*.8/n;
series.forEach((s,j)=>{g.fillStyle=s.c;s.v.forEach((v,i)=>{if(v==null)return;const x=F.m.l+F.pw*i/labels.length+F.pw/labels.length*.1+j*bw;g.fillRect(x,Math.min(F.y(v),F.y(0)),bw,Math.abs(F.y(v)-F.y(0)));});});
legend(g,series.map(s=>[s.n,s.c]));return [g,F,labels];}
function line(g,F,labels,v,c,dash){g.strokeStyle=c;g.lineWidth=2;g.setLineDash(dash||[]);g.beginPath();let st=false;
v.forEach((y,i)=>{if(y==null)return;const x=F.m.l+F.pw*(i+.5)/labels.length;if(!st){g.moveTo(x,F.y(y));st=true}else g.lineTo(x,F.y(y));});g.stroke();g.setLineDash([]);}
if(L&&L.dep!=null&&L.refs){
  const lab=['N-1','N-2','N-3','Moyenne'];
  const refVals=[L.refs[0],L.refs[1],L.refs[2],L.ref_mean];
  bars('c_day',lab,[{n:"Aujourd'hui (EDF)",c:'#0f766e',v:[L.dep,L.dep,L.dep,L.dep]},{n:'Référence (gaz+élec)',c:'#0284c7',v:refVals}]);
}else{document.getElementById('c_day_wrap').style.display='none';}
{const [g,w,h]=setup('c1');const lab=D.traj.map(t=>t.d);const all=D.traj.flatMap(t=>[t.n1,t.reel]).filter(v=>v!=null);
const F=frame(g,w,h,0,Math.max(1,...all)*1.05,lab);
line(g,F,lab,D.traj.map(t=>t.n1),'#0284c7');line(g,F,lab,D.traj.map(t=>t.obj),'#16a34a',[5,4]);line(g,F,lab,D.traj.map(t=>t.reel),'#0f766e');
legend(g,[['N-1','#0284c7'],['Obj. -'+f(K.obj_pct*100)+'%','#16a34a'],['Cette année','#0f766e']]);}
{const [g,w,h]=setup('c2');const lab=D.jours.map(j=>j.d),v=D.jours.map(j=>j.cum),vv=v.filter(x=>x!=null).concat([K.obj_eur]);
const F=frame(g,w,h,Math.min(0,...vv),Math.max(1,...vv)*1.1,lab);line(g,F,lab,v,'#16a34a');line(g,F,lab,lab.map(()=>K.obj_eur),'#d97706',[5,4]);
legend(g,[['Économie','#16a34a'],['Objectif '+f(K.obj_eur)+' €','#d97706']]);}
{const valid=D.mois.filter(m=>m.eco!=null);
if(valid.length){
const lab=valid.map(m=>m.l);const v=valid.map(m=>m.eco);const [g,w,h]=setup('c_m_eco');
const max=Math.max(1,...v)*1.15,min=Math.min(0,...v)*1.15;const F=frame(g,w,h,min,max,lab);
const bw=F.pw/lab.length*.65;
valid.forEach((m,i)=>{g.fillStyle=m.eco>=0?'#16a34a':'#dc2626';const x=F.m.l+F.pw*i/lab.length+F.pw/lab.length*.17;
g.fillRect(x,Math.min(F.y(m.eco),F.y(0)),bw,Math.abs(F.y(m.eco)-F.y(0)));
g.fillStyle='#334155';g.textAlign='center';g.fillText(sg(m.eco)+' €',x+bw/2,F.y(m.eco)+(m.eco>=0?-4:12));});
legend(g,[['Gain mensuel','#16a34a'],['Surcoût','#dc2626']]);}}
if(D.year_n1){
  const yn=D.year_n1;const lab=yn.labels;
  const [g,F]=bars('c_year',lab,[{n:'Gaz N-1',c:'#ea580c',v:yn.gaz},{n:'Élec N-1',c:'#0284c7',v:yn.elec}]);
  line(g,F,lab,yn.total_n1,'#0f172a');line(g,F,lab,yn.pac,'#0f766e');
  g.fillStyle='#0f766e';yn.pac.forEach((v,i)=>{if(v==null)return;const x=F.m.l+F.pw*(i+.5)/lab.length;g.beginPath();g.arc(x,F.y(v),3.5,0,7);g.fill();});
}else{document.getElementById('c_year_wrap').style.display='none';}
{const lab=D.jours.map(j=>j.d);const [g,F]=bars('c3',lab,[{n:'EDF du jour',c:'#0f766e',v:D.jours.map(j=>j.dep)}],D.jours.map(j=>j.n1));
line(g,F,lab,D.jours.map(j=>j.n1),'#0284c7');line(g,F,lab,D.jours.map(j=>j.obj),'#16a34a',[5,4]);}
{const lab=D.cops.map(c=>c.d);const [g,F]=bars('c4',lab,[{n:'COP réel',c:'#0284c7',v:D.cops.map(c=>c.cop)}]);
g.fillStyle='#dc2626';D.cops.forEach((c,i)=>{if(c.aff==null)return;g.beginPath();g.arc(F.m.l+F.pw*(i+.5)/lab.length,F.y(c.aff),3,0,7);g.fill();});
if(K.cop_rentab)line(g,F,lab,lab.map(()=>K.cop_rentab),'#d97706',[5,4]);}
document.getElementById('tab').innerHTML='<tr><th>Mois</th><th>Jours</th><th>Réel €</th><th>N-1</th><th>Économie</th><th>COP</th></tr>'+
D.mois.map(m=>\`<tr><td>\${m.l}</td><td>\${m.j}</td><td>\${f(m.t)}</td><td>\${f(m.n1)}</td><td>\${sg(m.eco)}</td><td>\${f(m.cop,2)}</td></tr>\`).join('');
}
__BOOT__
</script></body></html>`;

const BOOT_ENC = `
const ENV=__ENV__;
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function decryptWith(pw){
  const enc=new TextEncoder();
  const km=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(ENV.salt),iterations:ENV.iter,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt']);
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(ENV.iv)},key,b64(ENV.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function tryUnlock(pw,remember){
  try{
    const D=await decryptWith(pw);
    if(remember){try{localStorage.setItem('spw',pw)}catch(e){}}
    document.getElementById('login').style.display='none';
    document.getElementById('app').style.display='block';
    render(D);return true;
  }catch(e){return false;}
}
document.getElementById('app').style.display='none';
(async()=>{
  let p=null;try{p=localStorage.getItem('spw')}catch(e){}
  if(p&&await tryUnlock(p,false))return;
  document.getElementById('login').style.display='block';
  if(!(window.crypto&&window.crypto.subtle)){document.getElementById('err').textContent="Ouvrez cette page en https:// (le déchiffrement n'est pas possible en http).";return;}
  const go=async()=>{
    const ok=await tryUnlock(document.getElementById('pw').value,document.getElementById('rem').checked);
    if(!ok)document.getElementById('err').textContent='Mot de passe incorrect.';
  };
  document.getElementById('go').onclick=go;
  document.getElementById('pw').addEventListener('keydown',e=>{if(e.key==='Enter')go()});
})();
`;

export interface EncryptedEnvelope {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: 200000;
  cipher: 'AES-256-GCM';
  salt: string;
  iv: string;
  ct: string;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export async function encryptPayload(
  payload: MobilePayload,
  password: string
): Promise<EncryptedEnvelope> {
  const iter = 200000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const ctBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(payload))
  );

  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter,
    cipher: 'AES-256-GCM',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ctBuffer)),
  };
}

export function generateMobileHtml(model: PacModel): {
  html: string;
  dataJson: string;
} {
  const payload = buildMobilePayload(model);
  const html = MOBILE_HTML_TEMPLATE.replace(
    '__BOOT__',
    `render(${JSON.stringify(payload)});`
  );
  return {
    html,
    dataJson: JSON.stringify(payload, null, 1),
  };
}

export async function generateEncryptedMobileHtml(
  model: PacModel,
  password: string
): Promise<{ html: string; dataJson: string }> {
  const payload = buildMobilePayload(model);
  const env = await encryptPayload(payload, password);
  const html = MOBILE_HTML_TEMPLATE.replace(
    '__BOOT__',
    BOOT_ENC.replace('__ENV__', JSON.stringify(env))
  );
  return {
    html,
    dataJson: JSON.stringify(env, null, 1),
  };
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return toBase64(bytes);
}

export async function publishToGitHubPages(
  model: PacModel,
  cfg: PublishConfig
): Promise<string> {
  const user = cfg.github_user.trim();
  const repo = cfg.github_repo.trim();
  const token = cfg.github_token.trim();
  const branch = (cfg.github_branch || 'main').trim();
  if (!user || !repo || !token) {
    throw new Error(
      'Identifiant GitHub, nom du dépôt et jeton d’accès sont requis.'
    );
  }

  const bundle = cfg.github_password
    ? await generateEncryptedMobileHtml(model, cfg.github_password)
    : generateMobileHtml(model);

  const files: Record<string, string> = {
    'index.html': bundle.html,
    'data.json': bundle.dataJson,
  };

  const apiBase = `https://api.github.com/repos/${encodeURIComponent(
    user
  )}/${encodeURIComponent(repo)}/contents/`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  for (const [path, content] of Object.entries(files)) {
    let sha: string | undefined;
    const getResp = await fetch(`${apiBase}${path}?ref=${encodeURIComponent(branch)}`, {
      headers,
    });
    if (getResp.ok) {
      const json = (await getResp.json()) as { sha?: string };
      sha = json.sha;
    } else if (getResp.status !== 404) {
      const errBody = await getResp.text();
      throw new Error(`Erreur GitHub (${getResp.status}) : ${errBody}`);
    }

    const body: Record<string, unknown> = {
      message: `Mise à jour Suivi PAC ${new Date().toLocaleString('fr-FR')}`,
      content: utf8ToBase64(content),
      branch,
      author: {
        name: 'Suivi PAC',
        email: 'suivi-pac@users.noreply.github.com',
      },
      committer: {
        name: 'Suivi PAC',
        email: 'suivi-pac@users.noreply.github.com',
      },
    };
    if (sha) body.sha = sha;

    const putResp = await fetch(`${apiBase}${path}`, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!putResp.ok) {
      const errBody = await putResp.text();
      throw new Error(`Échec de publication sur ${path} (${putResp.status}) : ${errBody}`);
    }
  }

  return `https://${user}.github.io/${repo}/`;
}
