// Stockage : PostgreSQL si DATABASE_URL est défini, sinon mémoire vive (perdue au redémarrage).
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const SENSIBLE = /(sant[ée]|maladie|diagnostic|m[ée]dicament|IBAN|num[ée]ro de (compte|carte)|CNI|passeport|mot de passe|token|cl[ée] api)/i;
const tri = (k, sens = -1) => (a, b) => (String(a[k]) < String(b[k]) ? -sens : String(a[k]) > String(b[k]) ? sens : 0);
const nomListe = (n) => String(n || '').trim().toLowerCase().slice(0, 60);

class MemoryStore {
  constructor() {
    this.profile = {}; this.memories = []; this.documents = []; this.reminders = []; this.lists = [];
    this.actions = []; this.secrets = new Map(); this.subs = new Map();
  }
  async init() {}
  get kind() { return 'memoire-vive'; }

  async getProfile() { return this.profile; }
  async setProfile(p) { this.profile = { ...this.profile, ...p }; return this.profile; }

  async listMemories() { return [...this.memories].sort(tri('created_at')); }
  async addMemory({ fait, categorie }) {
    const m = { id: randomUUID(), fait, categorie, created_at: new Date().toISOString() };
    this.memories.push(m); return m;
  }
  async deleteMemory(id) { this.memories = this.memories.filter((m) => m.id !== id); }

  async addDocument(d) { const doc = { id: randomUUID(), ...d, created_at: new Date().toISOString() }; this.documents.push(doc); return doc; }
  async listDocuments() { return [...this.documents].sort(tri('created_at')).map(({ contenu, ...r }) => ({ ...r, apercu: contenu.slice(0, 140) })); }
  async getDocument(id) { return this.documents.find((d) => d.id === id) || null; }
  async deleteDocument(id) { this.documents = this.documents.filter((d) => d.id !== id); }

  async addReminder(r) { const x = { id: randomUUID(), envoye: false, ...r, created_at: new Date().toISOString() }; this.reminders.push(x); return x; }
  async listReminders({ aVenir = false } = {}) {
    return this.reminders.filter((r) => !aVenir || !r.envoye).sort(tri('quand', 1));
  }
  async deleteReminder(id) { const n = this.reminders.length; this.reminders = this.reminders.filter((r) => r.id !== id); return n !== this.reminders.length; }
  async dueReminders(maintenant) { return this.reminders.filter((r) => !r.envoye && r.quand <= maintenant); }
  async updateReminder(id, champs) { const r = this.reminders.find((x) => x.id === id); if (r) Object.assign(r, champs); return r; }

  async getList(nom) { return this.lists.find((l) => l.nom === nomListe(nom)) || null; }
  async getListById(id) { return this.lists.find((l) => l.id === id) || null; }
  async saveList(liste) {
    const i = this.lists.findIndex((l) => l.id === liste.id);
    if (i >= 0) this.lists[i] = liste; else this.lists.push(liste);
    return liste;
  }
  async listLists() { return [...this.lists]; }
  async deleteList(id) { this.lists = this.lists.filter((l) => l.id !== id); }

  async addAction(a) { const x = { id: randomUUID(), statut: 'en_attente', resultat: null, ...a, created_at: new Date().toISOString() }; this.actions.push(x); return x; }
  async getAction(id) { return this.actions.find((a) => a.id === id) || null; }
  async updateAction(id, champs) { const a = await this.getAction(id); if (a) Object.assign(a, champs); return a; }

  async getSecret(nom) { return this.secrets.get(nom) ?? null; }
  async setSecret(nom, valeur) { if (valeur === null) this.secrets.delete(nom); else this.secrets.set(nom, valeur); }

  async addSubscription(sub) { this.subs.set(sub.endpoint, sub); }
  async listSubscriptions() { return [...this.subs.values()]; }
  async deleteSubscription(endpoint) { this.subs.delete(endpoint); }
}

class PgStore {
  constructor(url) {
    this.pool = new pg.Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  }
  get kind() { return 'postgresql'; }
  q(sql, params) { return this.pool.query(sql, params); }
  async init() {
    await this.q(`
      create table if not exists profile (id int primary key default 1, data jsonb not null default '{}'::jsonb);
      create table if not exists memories (id uuid primary key, fait text not null, categorie text not null, created_at timestamptz not null default now());
      create table if not exists documents (id uuid primary key, type text not null, titre text not null, contenu text not null, agent text, created_at timestamptz not null default now());
      create table if not exists reminders (id uuid primary key, texte text not null, quand timestamptz not null, repetition text not null default 'aucune', envoye boolean not null default false, created_at timestamptz not null default now());
      create table if not exists lists (id uuid primary key, nom text unique not null, titre text not null, items jsonb not null default '[]'::jsonb, updated_at timestamptz not null default now());
      create table if not exists actions (id uuid primary key, outil text not null, input jsonb not null, resume text not null, statut text not null, resultat jsonb, created_at timestamptz not null default now());
      create table if not exists secrets (nom text primary key, valeur text not null);
      create table if not exists push_subscriptions (endpoint text primary key, data jsonb not null);
      insert into profile (id) values (1) on conflict do nothing;`);
  }
  async getProfile() { return (await this.q('select data from profile where id = 1')).rows[0]?.data ?? {}; }
  async setProfile(p) { return (await this.q("update profile set data = data || $1::jsonb where id = 1 returning data", [JSON.stringify(p)])).rows[0].data; }

  async listMemories() { return (await this.q('select id, fait, categorie, created_at from memories order by created_at desc limit 200')).rows; }
  async addMemory({ fait, categorie }) { return (await this.q('insert into memories (id, fait, categorie) values ($1, $2, $3) returning *', [randomUUID(), fait, categorie])).rows[0]; }
  async deleteMemory(id) { await this.q('delete from memories where id = $1', [id]); }

  async addDocument({ type, titre, contenu, agent }) { return (await this.q('insert into documents (id, type, titre, contenu, agent) values ($1,$2,$3,$4,$5) returning *', [randomUUID(), type, titre, contenu, agent])).rows[0]; }
  async listDocuments() { return (await this.q('select id, type, titre, agent, created_at, left(contenu, 140) as apercu from documents order by created_at desc limit 100')).rows; }
  async getDocument(id) { return (await this.q('select * from documents where id = $1', [id])).rows[0] || null; }
  async deleteDocument(id) { await this.q('delete from documents where id = $1', [id]); }

  async addReminder({ texte, quand, repetition }) { return this.#rappel((await this.q('insert into reminders (id, texte, quand, repetition) values ($1,$2,$3,$4) returning *', [randomUUID(), texte, quand, repetition])).rows[0]); }
  async listReminders({ aVenir = false } = {}) { return (await this.q(`select * from reminders ${aVenir ? 'where not envoye' : ''} order by quand asc limit 200`)).rows.map((r) => this.#rappel(r)); }
  async deleteReminder(id) { return (await this.q('delete from reminders where id = $1', [id])).rowCount > 0; }
  async dueReminders(maintenant) { return (await this.q('select * from reminders where not envoye and quand <= $1', [maintenant])).rows.map((r) => this.#rappel(r)); }
  async updateReminder(id, { quand, envoye }) { return this.#rappel((await this.q('update reminders set quand = coalesce($2, quand), envoye = coalesce($3, envoye) where id = $1 returning *', [id, quand ?? null, envoye ?? null])).rows[0]); }
  #rappel(r) { return r && { ...r, quand: new Date(r.quand).toISOString() }; }

  async getList(nom) { return (await this.q('select * from lists where nom = $1', [nomListe(nom)])).rows[0] || null; }
  async getListById(id) { return (await this.q('select * from lists where id = $1', [id])).rows[0] || null; }
  async saveList(l) {
    await this.q('insert into lists (id, nom, titre, items, updated_at) values ($1,$2,$3,$4,now()) on conflict (id) do update set titre = excluded.titre, items = excluded.items, updated_at = now()', [l.id, l.nom, l.titre, JSON.stringify(l.items)]);
    return l;
  }
  async listLists() { return (await this.q('select * from lists order by updated_at desc')).rows; }
  async deleteList(id) { await this.q('delete from lists where id = $1', [id]); }

  async addAction({ outil, input, resume }) { return (await this.q("insert into actions (id, outil, input, resume, statut) values ($1,$2,$3,$4,'en_attente') returning *", [randomUUID(), outil, JSON.stringify(input), resume])).rows[0]; }
  async getAction(id) { return (await this.q('select * from actions where id = $1', [id])).rows[0] || null; }
  async updateAction(id, { statut, resultat }) { return (await this.q('update actions set statut = $2, resultat = $3 where id = $1 returning *', [id, statut, JSON.stringify(resultat ?? null)])).rows[0]; }

  async getSecret(nom) { return (await this.q('select valeur from secrets where nom = $1', [nom])).rows[0]?.valeur ?? null; }
  async setSecret(nom, valeur) {
    if (valeur === null) await this.q('delete from secrets where nom = $1', [nom]);
    else await this.q('insert into secrets (nom, valeur) values ($1,$2) on conflict (nom) do update set valeur = excluded.valeur', [nom, valeur]);
  }

  async addSubscription(sub) { await this.q('insert into push_subscriptions (endpoint, data) values ($1,$2) on conflict (endpoint) do update set data = excluded.data', [sub.endpoint, JSON.stringify(sub)]); }
  async listSubscriptions() { return (await this.q('select data from push_subscriptions')).rows.map((r) => r.data); }
  async deleteSubscription(endpoint) { await this.q('delete from push_subscriptions where endpoint = $1', [endpoint]); }
}

export function createStore() {
  return process.env.DATABASE_URL ? new PgStore(process.env.DATABASE_URL) : new MemoryStore();
}

export function memoireAutorisee(fait) {
  return typeof fait === 'string' && fait.trim().length > 2 && fait.length <= 300 && !SENSIBLE.test(fait);
}

export { nomListe };
