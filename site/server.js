// Site de prélancement de Tehis : page publique, liste d'attente avec parrainage, espace admin.
// Partage la base PostgreSQL de l'app (table « waitlist »). Sans DATABASE_URL : mémoire vive.
import express from 'express';
import pg from 'pg';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3100);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const APP_URL = process.env.APP_URL || 'https://tehis-prototype.onrender.com';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';
const ACTIVITES = ['commerce', 'vente-en-ligne', 'services', 'restauration', 'artisanat', 'salarie', 'etudiant', 'developpeur', 'autre'];

/* ---------- Stockage ---------- */
function creerStockage() {
  if (!process.env.DATABASE_URL) {
    const lignes = [];
    return {
      kind: 'memoire-vive',
      async init() {},
      async parTelephone(t) { return lignes.find((l) => l.whatsapp === t) || null; },
      async parCode(c) { return lignes.find((l) => l.code === c) || null; },
      async ajouter(l) { const x = { id: lignes.length + 1, ...l, created_at: new Date().toISOString() }; lignes.push(x); return x; },
      async rang(id) { return lignes.filter((l) => l.id <= id).length; },
      async filleuls(code) { return lignes.filter((l) => l.parrain === code).length; },
      async total() { return lignes.length; },
      async tous() { return [...lignes].reverse(); }
    };
  }
  const url = process.env.DATABASE_URL;
  const pool = new pg.Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  const q = (s, p) => pool.query(s, p);
  return {
    kind: 'postgresql',
    async init() {
      await q(`create table if not exists waitlist (
        id serial primary key, prenom text not null, whatsapp text unique not null, activite text not null,
        ville text, testeur boolean not null default false, code text unique not null, parrain text,
        created_at timestamptz not null default now())`);
    },
    async parTelephone(t) { return (await q('select * from waitlist where whatsapp = $1', [t])).rows[0] || null; },
    async parCode(c) { return (await q('select * from waitlist where code = $1', [c])).rows[0] || null; },
    async ajouter(l) {
      return (await q('insert into waitlist (prenom, whatsapp, activite, ville, testeur, code, parrain) values ($1,$2,$3,$4,$5,$6,$7) returning *',
        [l.prenom, l.whatsapp, l.activite, l.ville, l.testeur, l.code, l.parrain])).rows[0];
    },
    async rang(id) { return Number((await q('select count(*) from waitlist where id <= $1', [id])).rows[0].count); },
    async filleuls(code) { return Number((await q('select count(*) from waitlist where parrain = $1', [code])).rows[0].count); },
    async total() { return Number((await q('select count(*) from waitlist')).rows[0].count); },
    async tous() { return (await q('select * from waitlist order by id desc limit 5000')).rows; }
  };
}
const db = creerStockage();

/* ---------- Outils ---------- */
const texte = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

// Numéro WhatsApp : 10 chiffres ivoiriens (01, 05, 07, 21, 25, 27…) ou format international.
export function normaliserTelephone(brut) {
  let t = String(brut || '').replace(/[\s.\-()]/g, '');
  if (t.startsWith('00')) t = `+${t.slice(2)}`;
  if (/^0\d{9}$/.test(t)) t = `+225${t}`;
  if (/^225\d{10}$/.test(t)) t = `+${t}`;
  return /^\+\d{8,15}$/.test(t) ? t : null;
}
const nouveauCode = () => randomBytes(4).toString('base64url').replace(/[-_]/g, 'x').slice(0, 6).toUpperCase();

const visites = new Map();
function limite(req, res, next) {
  const cle = req.ip; const now = Date.now();
  const l = (visites.get(cle) || []).filter((t) => now - t < 10 * 60_000);
  if (l.length >= 8) return res.status(429).json({ erreur: 'Trop de tentatives. Réessaie dans quelques minutes.' });
  l.push(now); visites.set(cle, l); next();
}

/* ---------- Application ---------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/stats', async (_req, res) => {
  const total = await db.total();
  res.json({ inscrits: total >= 30 ? total : null }); // affiché seulement à partir de 30 inscrits
});

app.post('/api/inscription', limite, async (req, res) => {
  const b = req.body || {};
  if (b.site) return res.json({ ok: true }); // champ piège pour les robots
  const prenom = texte(b.prenom, 40);
  const whatsapp = normaliserTelephone(b.whatsapp);
  const activite = ACTIVITES.includes(b.activite) ? b.activite : null;
  if (prenom.length < 2) return res.status(400).json({ erreur: 'Indique ton prénom.' });
  if (!whatsapp) return res.status(400).json({ erreur: 'Numéro WhatsApp invalide. Exemple : 07 00 00 00 00.' });
  if (!activite) return res.status(400).json({ erreur: 'Choisis ton activité.' });
  if (b.consentement !== true) return res.status(400).json({ erreur: 'Coche la case pour accepter d\'être contacté.' });

  let l = await db.parTelephone(whatsapp);
  let deja = true;
  if (!l) {
    deja = false;
    const parrainCode = texte(b.parrain, 12).toUpperCase();
    const parrain = parrainCode ? await db.parCode(parrainCode) : null;
    let code = nouveauCode();
    while (await db.parCode(code)) code = nouveauCode();
    try {
      l = await db.ajouter({ prenom, whatsapp, activite, ville: texte(b.ville, 60) || null, testeur: b.testeur === true, code, parrain: parrain?.code || null });
    } catch (e) {
      if (e.code === '23505') { l = await db.parTelephone(whatsapp); deja = true; } else throw e;
    }
  }
  res.json({ ok: true, deja, prenom: l.prenom, rang: await db.rang(l.id), code: l.code, filleuls: await db.filleuls(l.code) });
});

/* ---------- Admin (mot de passe ADMIN_PASSWORD, identifiant libre) ---------- */
function admin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).send('Espace admin désactivé : définis ADMIN_PASSWORD dans Render.');
  const [, b64] = (req.headers.authorization || '').split(' ');
  const mdp = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
  const h = (s) => createHash('sha256').update(s).digest();
  if (mdp && timingSafeEqual(h(mdp), h(ADMIN_PASSWORD))) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Tehis admin", charset="UTF-8"');
  res.status(401).send('Accès réservé.');
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

app.get('/admin', admin, async (_req, res) => {
  const lignes = await db.tous();
  const parActivite = lignes.reduce((m, l) => ({ ...m, [l.activite]: (m[l.activite] || 0) + 1 }), {});
  const testeurs = lignes.filter((l) => l.testeur).length;
  res.setHeader('Cache-Control', 'no-store');
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tehis · liste d'attente</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:20px;background:#F3F0E8;color:#1A1916}h1{font-size:22px;margin:0 0 4px}.k{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.k div{background:#fff;border-radius:12px;padding:10px 14px}.k b{display:block;font-size:20px}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:12px;overflow:hidden}th,td{padding:8px 10px;border-bottom:1px solid #E2DDD2;text-align:left;white-space:nowrap}th{background:#EDE8DD}.wrap{overflow-x:auto}a{color:#0E7C86}</style></head><body>
<h1>Liste d'attente Tehis</h1><a href="/admin/export.csv">Télécharger en CSV</a> · stockage ${esc(db.kind)}
<div class="k"><div><b>${lignes.length}</b>inscrits</div><div><b>${testeurs}</b>veulent tester</div>${Object.entries(parActivite).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><b>${v}</b>${esc(k)}</div>`).join('')}</div>
<div class="wrap"><table><thead><tr><th>#</th><th>Date</th><th>Prénom</th><th>WhatsApp</th><th>Activité</th><th>Ville</th><th>Testeur</th><th>Code</th><th>Parrain</th></tr></thead><tbody>
${lignes.map((l) => `<tr><td>${l.id}</td><td>${new Date(l.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' })}</td><td>${esc(l.prenom)}</td><td><a href="https://wa.me/${esc(l.whatsapp.replace('+', ''))}" target="_blank" rel="noopener">${esc(l.whatsapp)}</a></td><td>${esc(l.activite)}</td><td>${esc(l.ville)}</td><td>${l.testeur ? 'oui' : ''}</td><td>${esc(l.code)}</td><td>${esc(l.parrain)}</td></tr>`).join('')}
</tbody></table></div></body></html>`);
});

app.get('/admin/export.csv', admin, async (_req, res) => {
  const lignes = await db.tous();
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
  const csv = ['id;date;prenom;whatsapp;activite;ville;testeur;code;parrain',
    ...lignes.map((l) => [l.id, new Date(l.created_at).toISOString(), l.prenom, l.whatsapp.replace('+', ''), l.activite, l.ville, l.testeur ? 'oui' : 'non', l.code, l.parrain].map(cell).join(';'))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tehis-liste-attente.csv"');
  res.send(`﻿${csv}`);
});

/* ---------- Pages ---------- */
// Les modèles 3D, images et calculs viennent de l'app (même dépôt) : aucune copie.
const pub = join(here, '..', 'public');
const longCache = { maxAge: '7d' };
app.use('/models', express.static(join(pub, 'models'), { ...longCache, setHeaders: (r) => r.setHeader('Content-Type', 'model/gltf-binary') }));
app.use('/pets', express.static(join(pub, 'pets'), longCache));
app.use('/icons', express.static(join(pub, 'icons'), longCache));
app.use('/shared', express.static(join(pub, 'shared')));

function page(fichier) {
  const brut = readFileSync(join(here, 'public', fichier), 'utf8');
  return (req, res) => {
    const origine = `${req.protocol}://${req.get('host')}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(brut.replaceAll('{{ORIGINE}}', origine).replaceAll('{{APP_URL}}', APP_URL)
      .replaceAll('{{CONTACT}}', CONTACT_EMAIL ? `<a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a>` : 'réponds simplement à l\'un de nos messages WhatsApp'));
  };
}
app.get('/', page('index.html'));
app.get('/confidentialite', page('confidentialite.html'));
app.use(express.static(join(here, 'public'), { index: false }));
app.use((_req, res) => res.status(404).redirect('/'));

await db.init();
app.listen(PORT, () => console.log(`Site Tehis sur le port ${PORT} · stockage ${db.kind}${ADMIN_PASSWORD ? '' : ' · admin désactivé (ADMIN_PASSWORD absent)'}`));
