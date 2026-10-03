// Dreamotion Control — daily email digest.
// Reads the 3 index sites (read-only, public anon keys), builds a morning
// summary + the same alert rules as the dashboard, and emails it via Resend.
//
// Runs in GitHub Actions. Secrets:
//   RESEND_API_KEY  (required) — https://resend.com API key
//   DIGEST_TO       (required) — recipient email (kept out of the public repo)
//   DIGEST_FROM     (optional) — sender; defaults to Resend's onboarding sender
//
// No dependencies — native fetch (Node >= 20).

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_TO = process.env.DIGEST_TO;
const DIGEST_FROM = process.env.DIGEST_FROM || 'Dreamotion Control <onboarding@resend.dev>';
const DASHBOARD = 'https://tony4110.github.io/DREAMOTIONINDEX.COM/';

if (!RESEND_API_KEY || !DIGEST_TO) {
  console.error('Missing RESEND_API_KEY or DIGEST_TO env.');
  process.exit(1);
}

// Public anon/publishable keys (read-only; RLS protects the data) — same as the dashboard.
const SITES = [
  { key:'electra', name:'ELECTRA', tag:'AI Agents', cadence:'daily',
    url:'https://rqgnjavfbahderwxykox.supabase.co',
    anon:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxZ25qYXZmYmFoZGVyd3h5a294Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0NTMyOTUsImV4cCI6MjEwNjAyOTI5NX0.wBIk4-xCS1geQ9xZ-JX-PJxQ71t4q8aXp53FE6pIkh0',
    load:electra },
  { key:'maia', name:'MAIA', tag:'Longevity Credibility', cadence:'daily',
    url:'https://acdzxnokhersmnpxvdtu.supabase.co',
    anon:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjZHp4bm9raGVyc21ucHh2ZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4Njg2NTksImV4cCI6MjEwNjQ0NDY1OX0.HOo9CvpxhAYCX5u9-UjsOUpZECY8odElHaWBTWMIfLw',
    load:maia },
  { key:'alcyone', name:'ALCYONE', tag:'Space Economy', cadence:'weekly',
    url:'https://jlvghejppvlmrchuchqj.supabase.co',
    anon:'sb_publishable_YP3KkPpAFc2Bwlp7pvOmvA_3Wj2hkD8',
    load:alcyone },
];

const DAY = 86400000;
const daysAgo = (d) => d ? Math.floor((Date.now() - new Date(d)) / DAY) : null;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function freshness(days, cadence) {
  if (days == null) return { cls:'unknown', txt:'—' };
  const txt = days === 0 ? "aujourd'hui" : days === 1 ? 'hier' : 'il y a ' + days + ' j';
  if (cadence === 'weekly') return { cls: days<=8?'ok':days<=14?'warn':'crit', txt };
  return { cls: days<=1?'ok':days<=3?'warn':'crit', txt };
}
async function q(site, path) {
  const r = await fetch(`${site.url}/rest/v1/${path}`, { headers: { apikey: site.anon, Authorization: `Bearer ${site.anon}` } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function maia(site) {
  const rows = await q(site, 'score_meta?select=credibility_score,confidence_level,trend_30d,last_captured_at,ingredients(name)&order=credibility_score.desc.nullslast');
  const last = rows.map(r => r.last_captured_at).filter(Boolean).sort().pop();
  const strong = rows.filter(r => r.credibility_score >= 70).length;
  const movers = rows.filter(r => r.trend_30d != null && Math.round(r.trend_30d) !== 0)
    .sort((a,b) => Math.abs(b.trend_30d) - Math.abs(a.trend_30d)).slice(0,3);
  const strongMovers = rows.filter(r => r.trend_30d != null && Math.abs(r.trend_30d) >= 20)
    .map(r => ({ name: r.ingredients?.name, delta: r.trend_30d }));
  const note = movers.length
    ? 'Bouge : ' + movers.map(m => `${m.ingredients?.name} ${m.trend_30d>0?'+':''}${m.trend_30d}`).join(', ')
    : 'Tendances actives dès 2 jours d\'historique.';
  return { days: daysAgo(last), headline: `${rows.length} interventions`, sub: `${strong} à preuve solide (≥70)`, note, strongMovers };
}
async function alcyone(site) {
  const [eds, sats] = await Promise.all([
    q(site, 'weekly_editions?select=week_label,edition_date,index_value,connectivity,infrastructure,launch,market,narrative,auto_summary,confidence&order=edition_date.desc&limit=1'),
    q(site, 'satellite_history?select=date&order=date.desc&limit=1').catch(() => []),
  ]);
  const e = eds[0] || {}; const lastSat = sats[0]?.date;
  const last = [e.edition_date, lastSat].filter(Boolean).sort().pop();
  const narr = (e.narrative || e.auto_summary || '').slice(0, 240);
  return { days: daysAgo(last), headline: `Index ${e.index_value ?? '—'}/100`,
    sub: `Confiance ${e.confidence ?? '—'} · C ${e.connectivity} · I ${e.infrastructure} · L ${e.launch} · M ${e.market}`,
    note: narr || '—', strongMovers: [] };
}
async function electra(site) {
  const stats = await q(site, 'v_site_stats?select=mcp_servers,agents,tasks,capabilities,signals_24h,last_update&limit=1');
  const s = stats[0] || {};
  return { days: daysAgo(s.last_update), headline: `${s.mcp_servers ?? '—'} serveurs MCP`,
    sub: `${s.agents ?? 0} agents · ${s.tasks ?? 0} tâches · ${s.capabilities ?? 0} capacités`,
    note: `${s.signals_24h ?? 0} signaux sur 24 h.`, strongMovers: [] };
}

function card(site, d, f) {
  const color = f.cls==='ok' ? '#0E7C5A' : f.cls==='warn' ? '#B5791A' : f.cls==='crit' ? '#C0432E' : '#7E867F';
  return `<tr><td style="padding:14px 0;border-top:1px solid #E3E9E4">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><span style="font-family:Georgia,serif;font-size:18px;font-weight:bold;color:#16211C">${esc(site.name)}</span>
          <span style="font-size:11px;color:#5B6B63;text-transform:uppercase;letter-spacing:.08em">&nbsp; ${esc(site.tag)}</span></td>
      <td align="right"><span style="font-size:12px;color:${color};font-weight:bold">● ${esc(f.txt)}</span></td>
    </tr></table>
    <div style="font-size:22px;font-weight:bold;color:#16211C;margin:6px 0 2px">${esc(d.headline)}</div>
    <div style="font-size:13px;color:#5B6B63">${esc(d.sub)}</div>
    <div style="font-size:13px;color:#16211C;margin-top:6px">${esc(d.note)}</div>
  </td></tr>`;
}

async function main() {
  const today = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  const alerts = [];
  const cards = [];
  for (const site of SITES) {
    try {
      const d = await site.load(site);
      const f = freshness(d.days, site.cadence);
      if (f.cls === 'crit') alerts.push({ sev:'crit', site:site.name, msg:`Données en retard — ${f.txt}` });
      else if (f.cls === 'warn') alerts.push({ sev:'warn', site:site.name, msg:`À surveiller — ${f.txt}` });
      (d.strongMovers||[]).forEach(m => alerts.push({ sev:'warn', site:site.name, msg:`Variation forte : ${m.name} (${m.delta>0?'+':''}${m.delta})` }));
      cards.push(card(site, d, f));
    } catch (e) {
      alerts.push({ sev:'crit', site:site.name, msg:`Base injoignable (${e.message})` });
      cards.push(card(site, { headline:'—', sub:'lecture impossible', note:String(e.message) }, { cls:'crit', txt:'erreur' }));
    }
  }
  alerts.sort((a,b) => (a.sev==='crit'?0:1) - (b.sev==='crit'?0:1));

  const alertsHTML = alerts.length
    ? `<div style="background:#FBF0EC;border-left:3px solid #C0432E;border-radius:8px;padding:12px 14px;margin:0 0 8px">
         <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#C0432E;font-weight:bold;margin-bottom:6px">${alerts.length} alerte${alerts.length>1?'s':''}</div>
         ${alerts.map(a => `<div style="font-size:13.5px;color:#16211C;margin:3px 0"><b style="color:${a.sev==='crit'?'#C0432E':'#B5791A'}">●</b> <b>${esc(a.site)}</b> — ${esc(a.msg)}</div>`).join('')}
       </div>`
    : `<div style="background:#E9F5EF;border-left:3px solid #0E7C5A;border-radius:8px;padding:12px 14px;margin:0 0 8px;font-size:14px;color:#16211C"><b>Rien à signaler</b> — tous les index sont à jour.</div>`;

  const html = `<div style="background:#F4F7F4;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <table align="center" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E3E9E4;border-radius:14px">
      <tr><td style="padding:22px 24px 8px">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#16211C">✦ Dreamotion Control</div>
        <div style="font-size:12px;color:#5B6B63;text-transform:capitalize">${esc(today)}</div>
      </td></tr>
      <tr><td style="padding:10px 24px">${alertsHTML}</td></tr>
      <tr><td style="padding:0 24px 10px"><table width="100%" cellpadding="0" cellspacing="0">${cards.join('')}</table></td></tr>
      <tr><td style="padding:8px 24px 22px;border-top:1px solid #E3E9E4">
        <a href="${DASHBOARD}" style="color:#0E7C5A;font-size:13px;text-decoration:none">Ouvrir le tableau de bord →</a>
      </td></tr>
    </table></div>`;

  const text = `Dreamotion Control — ${today}\n\n` +
    (alerts.length ? alerts.map(a => `[${a.sev}] ${a.site} — ${a.msg}`).join('\n') : 'Rien à signaler — tous les index sont à jour.') +
    `\n\n${DASHBOARD}`;

  const subject = `Dreamotion — digest · ${alerts.length ? `${alerts.length} alerte${alerts.length>1?'s':''}` : 'tout OK'}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: DIGEST_FROM, to: [DIGEST_TO], subject, html, text }),
  });
  const body = await res.text();
  if (!res.ok) { console.error('Resend error', res.status, body); process.exit(1); }
  console.log('Digest sent:', subject, '|', body.slice(0, 120));
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
