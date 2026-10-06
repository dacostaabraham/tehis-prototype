// Stockage : PostgreSQL si DATABASE_URL est défini, sinon mémoire vive (perdue au redémarrage).
// Chaque donnée appartient à un compte (user_id). store.pour(uid) renvoie une vue limitée à ce compte :
// le reste du serveur (outils, agents) l'utilise sans jamais voir les données des autres.
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const SENSIBLE = /(sant[ée]|maladie|diagnostic|m[ée]dicament|IBAN|num[ée]ro de (compte|carte)|CNI|passeport|mot de passe|token|cl[ée] api)/i;
const tri = (k, sens = -1) => (a, b) => (String(a[k]) < String(b[k]) ? -sens : String(a[k]) > String(b[k]) ? sens : 0);
const nomListe = (n) => String(n || '').trim().toLowerCase().slice(0, 60);
const MAX_CONVERSATION = 300_000; // caractères JSON par agent

// Méthodes qui reçoivent l'identifiant du compte en premier argument.
const PAR_COMPTE = new Set([
  'getProfile', 'setProfile', 'listMemories', 'addMemory', 'deleteMemory',
  'addDocument', 'listDocuments', 'getDocument', 'deleteDocument',
  'addReminder', 'listReminders', 'deleteReminder', 'updateReminder',
  'getList', 'getListById', 'saveList', 'listLists', 'deleteList',
  'addAction', 'getAction', 'updateAction', 'getSecret', 'setSecret',
  'listCustomAgents', 'getCustomAgent', 'saveCustomAgent', 'deleteCustomAgent',
  'incrementUsage', 'getUsage', 'addSubscription', 'listSubscriptions',
  'getConversation', 'saveConversation', 'deleteConversations', 'getProgression', 'saveProgression'
]);

function vue(store, uid) {
  if (!uid) throw new Error('Compte manquant');
  return new Proxy(store, {
    get(cible, cle) {
      const v = cible[cle];
      if (typeof v !== 'function') return v;
      return PAR_COMPTE.has(cle) ? (...args) => v.call(cible, uid, ...args) : v.bind(cible);
    }
  });
}
const cleSecret = (uid, nom) => `u:${uid}:${nom}`;
const PUBLIC = ['id', 'telephone', 'offre', 'role', 'data', 'created_at', 'derniere_visite'];
const publicUser = (u) => u && Object.fromEntries(PUBLIC.map((k) => [k, u[k]]));

class MemoryStore {
  constructor() {
    this.users = []; this.memories = []; this.documents = []; this.reminders = []; this.lists = [];
    this.actions = []; this.secrets = new Map(); this.subs = new Map();
    this.persos = []; this.usage = new Map(); this.conversations = new Map();
  }
  async init() {}
  get kind() { return 'memoire-vive'; }
  pour(uid) { return vue(this, uid); }
  #a(liste, uid) { return liste.filter((x) => x.user_id === uid); }

  /* Comptes */
  async countUsers() { return this.users.length; }
  async createUser({ telephone, pin_hash, offre, role, data = {} }) {
    const u = { id: randomUUID(), telephone, pin_hash, offre, role, data: { ...data }, created_at: new Date().toISOString(), derniere_visite: null };
    this.users.push(u); return publicUser(u);
  }
  async getUserAuth(telephone) { return this.users.find((u) => u.telephone === telephone) || null; }
  async getUserAuthById(id) { return this.users.find((u) => u.id === id) || null; }
  async getUser(id) { return publicUser(this.users.find((u) => u.id === id)) || null; }
  async updateUser(id, champs) {
    const u = this.users.find((x) => x.id === id); if (!u) return null;
    const { data, ...reste } = champs;
    Object.assign(u, reste); if (data) u.data = { ...u.data, ...data };
    return publicUser(u);
  }
  async listUsers() { return [...this.users].sort(tri('created_at', 1)).map(publicUser); }
  async deleteUser(id) {
    for (const k of ['memories', 'documents', 'reminders', 'lists', 'actions', 'persos']) this[k] = this[k].filter((x) => x.user_id !== id);
    for (const [e, s] of this.subs) if (s.user_id === id) this.subs.delete(e);
    for (const k of [...this.conversations.keys()]) if (k.startsWith(`${id}|`)) this.conversations.delete(k);
    for (const k of [...this.secrets.keys()]) if (k.startsWith(`u:${id}:`)) this.secrets.delete(k);
    this.users = this.users.filter((u) => u.id !== id);
  }
  /** Données de l'ancien prototype (sans compte) rattachées au compte administrateur. */
  async rattacherAnciennesDonnees(uid) {
    for (const k of ['memories', 'documents', 'reminders', 'lists', 'actions', 'persos']) this[k].forEach((x) => { x.user_id ??= uid; });
    for (const s of this.subs.values()) s.user_id ??= uid;
  }

  /* Profil = données libres du compte (prénom, compagnon, mode dev…) */
  async getProfile(uid) { return { ...(this.users.find((u) => u.id === uid)?.data || {}) }; }
  async setProfile(uid, p) { return (await this.updateUser(uid, { data: p }))?.data || {}; }

  async listMemories(uid) { return this.#a(this.memories, uid).sort(tri('created_at')); }
  async addMemory(uid, { fait, categorie }) {
    const m = { id: randomUUID(), user_id: uid, fait, categorie, created_at: new Date().toISOString() };
    this.memories.push(m); return m;
  }
  async deleteMemory(uid, id) { this.memories = this.memories.filter((m) => !(m.id === id && m.user_id === uid)); }

  async addDocument(uid, d) { const doc = { id: randomUUID(), user_id: uid, ...d, created_at: new Date().toISOString() }; this.documents.push(doc); return doc; }
  async listDocuments(uid) { return this.#a(this.documents, uid).sort(tri('created_at')).map(({ contenu, ...r }) => ({ ...r, apercu: contenu.slice(0, 140) })); }
  async getDocument(uid, id) { return this.documents.find((d) => d.id === id && d.user_id === uid) || null; }
  async deleteDocument(uid, id) { this.documents = this.documents.filter((d) => !(d.id === id && d.user_id === uid)); }

  async addReminder(uid, r) { const x = { id: randomUUID(), user_id: uid, envoye: false, ...r, created_at: new Date().toISOString() }; this.reminders.push(x); return x; }
  async listReminders(uid, { aVenir = false } = {}) { return this.#a(this.reminders, uid).filter((r) => !aVenir || !r.envoye).sort(tri('quand', 1)); }
  async deleteReminder(uid, id) { const n = this.reminders.length; this.reminders = this.reminders.filter((r) => !(r.id === id && r.user_id === uid)); return n !== this.reminders.length; }
  /** Tous comptes confondus (vérification périodique des rappels). */
  async dueReminders(maintenant) { return this.reminders.filter((r) => !r.envoye && r.quand <= maintenant); }
  async updateReminder(uid, id, champs) { const r = this.reminders.find((x) => x.id === id && x.user_id === uid); if (r) Object.assign(r, champs); return r; }
  async updateReminderGlobal(id, champs) { const r = this.reminders.find((x) => x.id === id); if (r) Object.assign(r, champs); return r; }

  async getList(uid, nom) { return this.lists.find((l) => l.user_id === uid && l.nom === nomListe(nom)) || null; }
  async getListById(uid, id) { return this.lists.find((l) => l.user_id === uid && l.id === id) || null; }
  async saveList(uid, liste) {
    const l = { ...liste, user_id: uid };
    const i = this.lists.findIndex((x) => x.id === l.id && x.user_id === uid);
    if (i >= 0) this.lists[i] = l; else this.lists.push(l);
    return liste;
  }
  async listLists(uid) { return this.#a(this.lists, uid); }
  async deleteList(uid, id) { this.lists = this.lists.filter((l) => !(l.id === id && l.user_id === uid)); }

  async addAction(uid, a) { const x = { id: randomUUID(), user_id: uid, statut: 'en_attente', resultat: null, ...a, created_at: new Date().toISOString() }; this.actions.push(x); return x; }
  async getAction(uid, id) { return this.actions.find((a) => a.id === id && a.user_id === uid) || null; }
  async updateAction(uid, id, champs) { const a = await this.getAction(uid, id); if (a) Object.assign(a, champs); return a; }

  /* Secrets : ceux d'un compte (clés GitHub, Render) et ceux du serveur (clés VAPID). */
  async getSecret(uid, nom) { return this.secrets.get(cleSecret(uid, nom)) ?? null; }
  async setSecret(uid, nom, valeur) { const k = cleSecret(uid, nom); if (valeur === null) this.secrets.delete(k); else this.secrets.set(k, valeur); }
  async getSecretServeur(nom) { return this.secrets.get(nom) ?? null; }
  async setSecretServeur(nom, valeur) { if (valeur === null) this.secrets.delete(nom); else this.secrets.set(nom, valeur); }

  async listCustomAgents(uid) { return this.#a(this.persos, uid).sort(tri('created_at', 1)); }
  async getCustomAgent(uid, id) { return this.persos.find((a) => a.id === id && a.user_id === uid) || null; }
  async saveCustomAgent(uid, a) {
    const maintenant = new Date().toISOString();
    const i = this.persos.findIndex((x) => x.id === a.id && x.user_id === uid);
    const x = { ...a, user_id: uid, created_at: i >= 0 ? this.persos[i].created_at : maintenant, updated_at: maintenant };
    if (i >= 0) this.persos[i] = x; else this.persos.push(x);
    return x;
  }
  async deleteCustomAgent(uid, id) { this.persos = this.persos.filter((a) => !(a.id === id && a.user_id === uid)); }

  async incrementUsage(uid, jour, cle, n = 1) { const k = `${uid}|${jour}|${cle}`; const v = (this.usage.get(k) || 0) + n; this.usage.set(k, v); return v; }
  async getUsage(uid, jour, cle) { return this.usage.get(`${uid}|${jour}|${cle}`) || 0; }

  async addSubscription(uid, sub) { this.subs.set(sub.endpoint, { ...sub, user_id: uid }); }
  async listSubscriptions(uid) { return [...this.subs.values()].filter((s) => s.user_id === uid).map(({ user_id, ...s }) => s); }
  async deleteSubscription(endpoint) { this.subs.delete(endpoint); }

  async getConversation(uid, agent) { return this.conversations.get(`${uid}|${agent}`) || null; }
  async saveConversation(uid, agent, items) {
    const c = { items, updated_at: new Date().toISOString() };
    this.conversations.set(`${uid}|${agent}`, c); return c;
  }
  async deleteConversations(uid) { for (const k of [...this.conversations.keys()]) if (k.startsWith(`${uid}|`)) this.conversations.delete(k); }

  async getProgression(uid) { return this.users.find((u) => u.id === uid)?.progression || null; }
  async saveProgression(uid, p) { const u = this.users.find((x) => x.id === uid); if (u) u.progression = p; return p; }
}

const TABLES_COMPTE = ['memories', 'documents', 'reminders', 'lists', 'actions', 'push_subscriptions', 'custom_agents'];

class PgStore {
  constructor(url) {
    this.pool = new pg.Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  }
  get kind() { return 'postgresql'; }
  pour(uid) { return vue(this, uid); }
  q(sql, params) { return this.pool.query(sql, params); }
  async init() {
    await this.q(`
      create table if not exists profile (id int primary key default 1, data jsonb not null default '{}'::jsonb);
      create table if not exists memories (id uuid primary key, fait text not null, categorie text not null, created_at timestamptz not null default now());
      create table if not exists documents (id uuid primary key, type text not null, titre text not null, contenu text not null, agent text, created_at timestamptz not null default now());
      create table if not exists reminders (id uuid primary key, texte text not null, quand timestamptz not null, repetition text not null default 'aucune', envoye boolean not null default false, created_at timestamptz not null default now());
      create table if not exists lists (id uuid primary key, nom text not null, titre text not null, items jsonb not null default '[]'::jsonb, updated_at timestamptz not null default now());
      create table if not exists actions (id uuid primary key, outil text not null, input jsonb not null, resume text not null, statut text not null, resultat jsonb, created_at timestamptz not null default now());
      create table if not exists secrets (nom text primary key, valeur text not null);
      create table if not exists push_subscriptions (endpoint text primary key, data jsonb not null);
      create table if not exists custom_agents (id uuid primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
      create table if not exists usage (jour text not null, cle text not null, n int not null default 0, primary key (jour, cle));
      create table if not exists users (
        id uuid primary key, telephone text unique not null, pin_hash text not null,
        offre text not null default 'gratuit', role text not null default 'testeur',
        data jsonb not null default '{}'::jsonb, progression jsonb,
        created_at timestamptz not null default now(), derniere_visite timestamptz);
      create table if not exists conversations (user_id uuid not null, agent text not null, items jsonb not null, updated_at timestamptz not null default now(), primary key (user_id, agent));
      alter table users add column if not exists progression jsonb;
      ${TABLES_COMPTE.map((t) => `alter table ${t} add column if not exists user_id uuid; create index if not exists ${t}_user on ${t} (user_id);`).join('\n')}
      alter table lists drop constraint if exists lists_nom_key;
      create unique index if not exists lists_user_nom on lists (user_id, nom);
      insert into profile (id) values (1) on conflict do nothing;`);
  }

  /* Comptes */
  async countUsers() { return Number((await this.q('select count(*) from users')).rows[0].count); }
  async createUser({ telephone, pin_hash, offre, role, data = {} }) {
    return publicUser((await this.q('insert into users (id, telephone, pin_hash, offre, role, data) values ($1,$2,$3,$4,$5,$6) returning *', [randomUUID(), telephone, pin_hash, offre, role, JSON.stringify(data)])).rows[0]);
  }
  async getUserAuth(telephone) { return (await this.q('select * from users where telephone = $1', [telephone])).rows[0] || null; }
  async getUserAuthById(id) { return (await this.q('select * from users where id = $1', [id])).rows[0] || null; }
  async getUser(id) { return publicUser((await this.q('select * from users where id = $1', [id])).rows[0]) || null; }
  async updateUser(id, { data, ...reste }) {
    const cols = Object.keys(reste).filter((k) => ['offre', 'role', 'pin_hash', 'derniere_visite'].includes(k));
    const sets = cols.map((k, i) => `${k} = $${i + 3}`);
    const r = await this.q(`update users set data = data || $2::jsonb${sets.length ? `, ${sets.join(', ')}` : ''} where id = $1 returning *`, [id, JSON.stringify(data || {}), ...cols.map((k) => reste[k])]);
    return publicUser(r.rows[0]) || null;
  }
  async listUsers() { return (await this.q('select * from users order by created_at asc')).rows.map(publicUser); }
  async deleteUser(id) {
    for (const t of TABLES_COMPTE) await this.q(`delete from ${t} where user_id = $1`, [id]);
    await this.q('delete from conversations where user_id = $1', [id]);
    await this.q('delete from secrets where nom like $1', [`u:${id}:%`]);
    await this.q('delete from usage where cle like $1', [`${id}|%`]);
    await this.q('delete from users where id = $1', [id]);
  }
  async rattacherAnciennesDonnees(uid) {
    for (const t of TABLES_COMPTE) await this.q(`update ${t} set user_id = $1 where user_id is null`, [uid]);
    const ancien = (await this.q('select data from profile where id = 1')).rows[0]?.data || {};
    if (Object.keys(ancien).length) await this.q("update users set data = $2::jsonb || data where id = $1", [uid, JSON.stringify(ancien)]);
    for (const nom of ['github', 'render']) await this.q('update secrets set nom = $2 where nom = $1 and not exists (select 1 from secrets where nom = $2)', [nom, cleSecret(uid, nom)]);
  }

  async getProfile(uid) { return (await this.q('select data from users where id = $1', [uid])).rows[0]?.data ?? {}; }
  async setProfile(uid, p) { return (await this.q('update users set data = data || $2::jsonb where id = $1 returning data', [uid, JSON.stringify(p)])).rows[0]?.data ?? {}; }

  async listMemories(uid) { return (await this.q('select id, fait, categorie, created_at from memories where user_id = $1 order by created_at desc limit 200', [uid])).rows; }
  async addMemory(uid, { fait, categorie }) { return (await this.q('insert into memories (id, user_id, fait, categorie) values ($1,$2,$3,$4) returning *', [randomUUID(), uid, fait, categorie])).rows[0]; }
  async deleteMemory(uid, id) { await this.q('delete from memories where id = $1 and user_id = $2', [id, uid]); }

  async addDocument(uid, { type, titre, contenu, agent }) { return (await this.q('insert into documents (id, user_id, type, titre, contenu, agent) values ($1,$2,$3,$4,$5,$6) returning *', [randomUUID(), uid, type, titre, contenu, agent])).rows[0]; }
  async listDocuments(uid) { return (await this.q('select id, type, titre, agent, created_at, left(contenu, 140) as apercu from documents where user_id = $1 order by created_at desc limit 100', [uid])).rows; }
  async getDocument(uid, id) { return (await this.q('select * from documents where id = $1 and user_id = $2', [id, uid])).rows[0] || null; }
  async deleteDocument(uid, id) { await this.q('delete from documents where id = $1 and user_id = $2', [id, uid]); }

  async addReminder(uid, { texte, quand, repetition }) { return this.#rappel((await this.q('insert into reminders (id, user_id, texte, quand, repetition) values ($1,$2,$3,$4,$5) returning *', [randomUUID(), uid, texte, quand, repetition])).rows[0]); }
  async listReminders(uid, { aVenir = false } = {}) { return (await this.q(`select * from reminders where user_id = $1 ${aVenir ? 'and not envoye' : ''} order by quand asc limit 200`, [uid])).rows.map((r) => this.#rappel(r)); }
  async deleteReminder(uid, id) { return (await this.q('delete from reminders where id = $1 and user_id = $2', [id, uid])).rowCount > 0; }
  async dueReminders(maintenant) { return (await this.q('select * from reminders where not envoye and quand <= $1 and user_id is not null', [maintenant])).rows.map((r) => this.#rappel(r)); }
  async updateReminder(uid, id, champs) { return this.#majRappel(id, champs, uid); }
  async updateReminderGlobal(id, champs) { return this.#majRappel(id, champs, null); }
  async #majRappel(id, { quand, envoye }, uid) {
    return this.#rappel((await this.q(`update reminders set quand = coalesce($2, quand), envoye = coalesce($3, envoye) where id = $1 ${uid ? 'and user_id = $4' : ''} returning *`, [id, quand ?? null, envoye ?? null, ...(uid ? [uid] : [])])).rows[0]);
  }
  #rappel(r) { return r && { ...r, quand: new Date(r.quand).toISOString() }; }

  async getList(uid, nom) { return (await this.q('select * from lists where nom = $1 and user_id = $2', [nomListe(nom), uid])).rows[0] || null; }
  async getListById(uid, id) { return (await this.q('select * from lists where id = $1 and user_id = $2', [id, uid])).rows[0] || null; }
  async saveList(uid, l) {
    await this.q('insert into lists (id, user_id, nom, titre, items, updated_at) values ($1,$2,$3,$4,$5,now()) on conflict (id) do update set titre = excluded.titre, items = excluded.items, updated_at = now() where lists.user_id = $2', [l.id, uid, l.nom, l.titre, JSON.stringify(l.items)]);
    return l;
  }
  async listLists(uid) { return (await this.q('select * from lists where user_id = $1 order by updated_at desc', [uid])).rows; }
  async deleteList(uid, id) { await this.q('delete from lists where id = $1 and user_id = $2', [id, uid]); }

  async addAction(uid, { outil, input, resume }) { return (await this.q("insert into actions (id, user_id, outil, input, resume, statut) values ($1,$2,$3,$4,$5,'en_attente') returning *", [randomUUID(), uid, outil, JSON.stringify(input), resume])).rows[0]; }
  async getAction(uid, id) { return (await this.q('select * from actions where id = $1 and user_id = $2', [id, uid])).rows[0] || null; }
  async updateAction(uid, id, { statut, resultat }) { return (await this.q('update actions set statut = $3, resultat = $4 where id = $1 and user_id = $2 returning *', [id, uid, statut, JSON.stringify(resultat ?? null)])).rows[0]; }

  async getSecret(uid, nom) { return this.getSecretServeur(cleSecret(uid, nom)); }
  async setSecret(uid, nom, valeur) { return this.setSecretServeur(cleSecret(uid, nom), valeur); }
  async getSecretServeur(nom) { return (await this.q('select valeur from secrets where nom = $1', [nom])).rows[0]?.valeur ?? null; }
  async setSecretServeur(nom, valeur) {
    if (valeur === null) await this.q('delete from secrets where nom = $1', [nom]);
    else await this.q('insert into secrets (nom, valeur) values ($1,$2) on conflict (nom) do update set valeur = excluded.valeur', [nom, valeur]);
  }

  #perso(r) { return r && { ...r.data, id: r.id, created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString() }; }
  async listCustomAgents(uid) { return (await this.q('select * from custom_agents where user_id = $1 order by created_at asc', [uid])).rows.map((r) => this.#perso(r)); }
  async getCustomAgent(uid, id) { return this.#perso((await this.q('select * from custom_agents where id = $1 and user_id = $2', [id, uid])).rows[0]); }
  async saveCustomAgent(uid, a) {
    const { id, created_at, updated_at, user_id, ...data } = a;
    return this.#perso((await this.q('insert into custom_agents (id, user_id, data) values ($1,$2,$3) on conflict (id) do update set data = excluded.data, updated_at = now() where custom_agents.user_id = $2 returning *', [id, uid, JSON.stringify(data)])).rows[0]);
  }
  async deleteCustomAgent(uid, id) { await this.q('delete from custom_agents where id = $1 and user_id = $2', [id, uid]); }

  async incrementUsage(uid, jour, cle, n = 1) { return (await this.q('insert into usage (jour, cle, n) values ($1,$2,$3) on conflict (jour, cle) do update set n = usage.n + $3 returning n', [jour, `${uid}|${cle}`, n])).rows[0].n; }
  async getUsage(uid, jour, cle) { return (await this.q('select n from usage where jour = $1 and cle = $2', [jour, `${uid}|${cle}`])).rows[0]?.n || 0; }

  async addSubscription(uid, sub) { await this.q('insert into push_subscriptions (endpoint, user_id, data) values ($1,$2,$3) on conflict (endpoint) do update set data = excluded.data, user_id = excluded.user_id', [sub.endpoint, uid, JSON.stringify(sub)]); }
  async listSubscriptions(uid) { return (await this.q('select data from push_subscriptions where user_id = $1', [uid])).rows.map((r) => r.data); }
  async deleteSubscription(endpoint) { await this.q('delete from push_subscriptions where endpoint = $1', [endpoint]); }

  async getConversation(uid, agent) {
    const r = (await this.q('select items, updated_at from conversations where user_id = $1 and agent = $2', [uid, agent])).rows[0];
    return r ? { items: r.items, updated_at: new Date(r.updated_at).toISOString() } : null;
  }
  async saveConversation(uid, agent, items) {
    const r = (await this.q('insert into conversations (user_id, agent, items, updated_at) values ($1,$2,$3,now()) on conflict (user_id, agent) do update set items = excluded.items, updated_at = now() returning updated_at', [uid, agent, JSON.stringify(items)])).rows[0];
    return { items, updated_at: new Date(r.updated_at).toISOString() };
  }
  async deleteConversations(uid) { await this.q('delete from conversations where user_id = $1', [uid]); }

  async getProgression(uid) { return (await this.q('select progression from users where id = $1', [uid])).rows[0]?.progression || null; }
  async saveProgression(uid, p) { await this.q('update users set progression = $2 where id = $1', [uid, JSON.stringify(p)]); return p; }
}

export function createStore() {
  return process.env.DATABASE_URL ? new PgStore(process.env.DATABASE_URL) : new MemoryStore();
}

export function memoireAutorisee(fait) {
  return typeof fait === 'string' && fait.trim().length > 2 && fait.length <= 300 && !SENSIBLE.test(fait);
}

export { nomListe, MAX_CONVERSATION };
