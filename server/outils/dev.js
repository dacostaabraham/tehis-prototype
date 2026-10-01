// Mode développeur (allégé) : lire et écrire sur GitHub, créer et déployer des services Render.
// Aucun code n'est exécuté sur nos serveurs. Toute action qui modifie quelque chose attend la validation de l'utilisateur.

const GITHUB = 'https://api.github.com';
const RENDER = 'https://api.render.com/v1';
const MAX_FICHIERS = 30;
const MAX_OCTETS = 300_000;

export const OUTILS_A_VALIDER = new Set(['github_creer_depot', 'github_ecrire_fichiers', 'render_creer_service', 'render_variables', 'render_deployer']);

const depotValide = (d) => typeof d === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(d);
const cheminValide = (p) => typeof p === 'string' && p.length > 0 && p.length < 300 && !p.startsWith('/') && !p.split('/').some((s) => s === '..' || s === '' || s === '.git');

export const SCHEMAS_DEV = [
  { name: 'github_depots', description: "Liste les dépôts GitHub de l'utilisateur (les plus récents d'abord).", input_schema: { type: 'object', properties: {} } },
  {
    name: 'github_lire',
    description: "Lit un fichier d'un dépôt GitHub, ou liste un dossier. Utilise-le pour comprendre le code existant avant de le modifier.",
    input_schema: { type: 'object', properties: { depot: { type: 'string', description: 'propriétaire/nom' }, chemin: { type: 'string', description: 'Chemin du fichier ou du dossier ; vide pour la racine' }, branche: { type: 'string' } }, required: ['depot'] }
  },
  {
    name: 'github_creer_depot',
    description: "Crée un nouveau dépôt GitHub sur le compte de l'utilisateur, avec un README. Nécessite la validation de l'utilisateur.",
    input_schema: { type: 'object', properties: { nom: { type: 'string' }, description: { type: 'string' }, prive: { type: 'boolean' } }, required: ['nom'] }
  },
  {
    name: 'github_ecrire_fichiers',
    description: "Crée ou remplace des fichiers dans un dépôt, en un seul commit. Envoie le contenu complet de chaque fichier. Nécessite la validation de l'utilisateur. Jamais de clé secrète dans le code : utilise des variables d'environnement.",
    input_schema: {
      type: 'object',
      properties: {
        depot: { type: 'string', description: 'propriétaire/nom' },
        branche: { type: 'string', description: 'Branche cible (par défaut la branche principale). Une branche absente est créée depuis la principale.' },
        message: { type: 'string', description: 'Message de commit, en français' },
        fichiers: { type: 'array', items: { type: 'object', properties: { chemin: { type: 'string' }, contenu: { type: 'string' } }, required: ['chemin', 'contenu'] } }
      },
      required: ['depot', 'message', 'fichiers']
    }
  },
  { name: 'render_services', description: "Liste les services Render de l'utilisateur avec leur adresse et leur dépôt.", input_schema: { type: 'object', properties: {} } },
  {
    name: 'render_creer_service',
    description: "Crée un service web Render (offre gratuite, Francfort) relié à un dépôt GitHub, avec déploiement automatique. Le dépôt doit être public ou accessible au compte Render. Nécessite la validation de l'utilisateur.",
    input_schema: {
      type: 'object',
      properties: {
        nom: { type: 'string' },
        depot: { type: 'string', description: 'propriétaire/nom' },
        branche: { type: 'string' },
        environnement: { type: 'string', enum: ['node', 'python', 'docker', 'go', 'ruby'] },
        commandeBuild: { type: 'string', description: 'ex. npm install' },
        commandeStart: { type: 'string', description: 'ex. node server.js' }
      },
      required: ['nom', 'depot', 'environnement', 'commandeBuild', 'commandeStart']
    }
  },
  {
    name: 'render_variables',
    description: "Définit des variables d'environnement d'un service Render. Pour une valeur secrète que tu ne connais pas, laisse la valeur vide : l'utilisateur la saisira dans Render. Nécessite la validation de l'utilisateur.",
    input_schema: {
      type: 'object',
      properties: { serviceId: { type: 'string' }, variables: { type: 'array', items: { type: 'object', properties: { cle: { type: 'string' }, valeur: { type: 'string' } }, required: ['cle', 'valeur'] } } },
      required: ['serviceId', 'variables']
    }
  },
  { name: 'render_deployer', description: "Lance un nouveau déploiement d'un service Render. Nécessite la validation de l'utilisateur.", input_schema: { type: 'object', properties: { serviceId: { type: 'string' } }, required: ['serviceId'] } },
  { name: 'render_statut', description: "Donne l'état des derniers déploiements d'un service Render.", input_schema: { type: 'object', properties: { serviceId: { type: 'string' } }, required: ['serviceId'] } }
];

/** Vérifie les entrées et prépare le résumé affiché sur la carte de validation. */
export function preparerAction(nom, input = {}) {
  if (nom === 'github_creer_depot') {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(input.nom || '')) return { erreur: 'Nom de dépôt invalide (lettres, chiffres, - _ . seulement).' };
    return { resume: `Créer le dépôt GitHub « ${input.nom} » (${input.prive === false ? 'public' : 'privé'})`, details: input.description ? [input.description] : [] };
  }
  if (nom === 'github_ecrire_fichiers') {
    if (!depotValide(input.depot)) return { erreur: 'Dépôt invalide : format propriétaire/nom.' };
    const fichiers = Array.isArray(input.fichiers) ? input.fichiers : [];
    if (!fichiers.length) return { erreur: 'Aucun fichier à écrire.' };
    if (fichiers.length > MAX_FICHIERS) return { erreur: `${MAX_FICHIERS} fichiers au plus par commit.` };
    const invalide = fichiers.find((f) => !cheminValide(f.chemin) || typeof f.contenu !== 'string');
    if (invalide) return { erreur: `Chemin ou contenu invalide : ${invalide.chemin}` };
    const octets = fichiers.reduce((s, f) => s + Buffer.byteLength(f.contenu, 'utf8'), 0);
    if (octets > MAX_OCTETS) return { erreur: 'Commit trop gros (300 Ko au plus) : découpe-le.' };
    const alertes = [];
    if (fichiers.some((f) => f.chemin.startsWith('.github/workflows/'))) alertes.push('Modifie un workflow GitHub Actions');
    if (fichiers.some((f) => /(sk-ant-|ghp_|github_pat_|rnd_|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(f.contenu))) return { erreur: 'Un fichier contient ce qui ressemble à une clé secrète : retire-la et utilise une variable d\'environnement.' };
    return {
      resume: `Envoyer ${fichiers.length} fichier${fichiers.length > 1 ? 's' : ''} sur ${input.depot}${input.branche ? ` (branche ${input.branche})` : ''}`,
      details: [`Commit : ${input.message || 'sans message'}`, ...alertes],
      fichiers: fichiers.map((f) => ({ chemin: f.chemin, contenu: f.contenu }))
    };
  }
  if (nom === 'render_creer_service') {
    if (!depotValide(input.depot)) return { erreur: 'Dépôt invalide : format propriétaire/nom.' };
    return {
      resume: `Créer le service Render « ${input.nom} » depuis ${input.depot}`,
      details: [`Environnement : ${input.environnement}`, `Build : ${input.commandeBuild}`, `Démarrage : ${input.commandeStart}`, 'Offre gratuite, Francfort, déploiement automatique à chaque commit']
    };
  }
  if (nom === 'render_variables') {
    const vars = Array.isArray(input.variables) ? input.variables : [];
    if (!input.serviceId || !vars.length) return { erreur: 'Service ou variables manquants.' };
    if (vars.some((v) => !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(v.cle || ''))) return { erreur: 'Nom de variable invalide.' };
    return { resume: `Définir ${vars.length} variable${vars.length > 1 ? 's' : ''} sur le service ${input.serviceId}`, details: vars.map((v) => `${v.cle} = ${v.valeur ? '••••' : '(à remplir dans Render)'}`) };
  }
  if (nom === 'render_deployer') {
    if (!input.serviceId) return { erreur: 'Service manquant.' };
    return { resume: `Déployer le service Render ${input.serviceId}`, details: [] };
  }
  return { erreur: `Action inconnue : ${nom}` };
}

function client(base, jeton, fetchImpl, nomService) {
  return async (chemin, { method = 'GET', body } = {}) => {
    if (!jeton) throw new Error(`Clé ${nomService} absente : ajoute-la dans Réglages › Mode développeur.`);
    const r = await fetchImpl(`${base}${chemin}`, {
      method,
      headers: {
        Authorization: `Bearer ${jeton}`, Accept: base === GITHUB ? 'application/vnd.github+json' : 'application/json',
        'Content-Type': 'application/json', 'User-Agent': 'Tehis-Prototype',
        ...(base === GITHUB ? { 'X-GitHub-Api-Version': '2022-11-28' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const texte = await r.text();
    let data; try { data = texte ? JSON.parse(texte) : null; } catch { data = texte; }
    if (!r.ok) {
      const detail = data?.message || (typeof data === 'string' ? data.slice(0, 200) : '');
      const err = new Error(`${nomService} ${r.status}${detail ? ` : ${detail}` : ''}`);
      err.status = r.status; throw err;
    }
    return data;
  };
}

/** Exécute un outil du mode développeur. cles = { github, render }. */
export async function executerDev(nom, input = {}, cles = {}, fetchImpl = fetch) {
  const gh = client(GITHUB, cles.github, fetchImpl, 'GitHub');
  const rd = client(RENDER, cles.render, fetchImpl, 'Render');
  try {
    switch (nom) {
      case 'github_depots': {
        const depots = await gh('/user/repos?sort=updated&per_page=30');
        return { depots: depots.map((d) => ({ nom: d.full_name, prive: d.private, branche: d.default_branch, maj: d.updated_at, description: d.description })) };
      }
      case 'github_lire': {
        if (!depotValide(input.depot)) return { erreur: 'Dépôt invalide : format propriétaire/nom.' };
        const chemin = String(input.chemin || '').replace(/^\/+/, '');
        const ref = input.branche ? `?ref=${encodeURIComponent(input.branche)}` : '';
        const data = await gh(`/repos/${input.depot}/contents/${chemin.split('/').map(encodeURIComponent).join('/')}${ref}`);
        if (Array.isArray(data)) return { dossier: chemin || '/', elements: data.map((e) => ({ nom: e.name, type: e.type === 'dir' ? 'dossier' : 'fichier', taille: e.size })) };
        if (data.size > 60_000) return { fichier: chemin, taille: data.size, erreur: 'Fichier trop gros pour être lu ici (60 Ko au plus).' };
        return { fichier: chemin, contenu: Buffer.from(data.content || '', 'base64').toString('utf8') };
      }
      case 'github_creer_depot': {
        const d = await gh('/user/repos', { method: 'POST', body: { name: input.nom, description: input.description || '', private: input.prive !== false, auto_init: true } });
        return { cree: true, depot: d.full_name, url: d.html_url, branche: d.default_branch };
      }
      case 'github_ecrire_fichiers': {
        const p = preparerAction(nom, input);
        if (p.erreur) return p;
        const repo = await gh(`/repos/${input.depot}`);
        const principale = repo.default_branch;
        const branche = input.branche || principale;
        let ref;
        try { ref = await gh(`/repos/${input.depot}/git/ref/heads/${encodeURIComponent(branche)}`); } catch (e) {
          if (e.status !== 404 || branche === principale) throw e;
          const base = await gh(`/repos/${input.depot}/git/ref/heads/${encodeURIComponent(principale)}`);
          ref = await gh(`/repos/${input.depot}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branche}`, sha: base.object.sha } });
        }
        const parent = await gh(`/repos/${input.depot}/git/commits/${ref.object.sha}`);
        const arbre = await gh(`/repos/${input.depot}/git/trees`, { method: 'POST', body: { base_tree: parent.tree.sha, tree: input.fichiers.map((f) => ({ path: f.chemin, mode: '100644', type: 'blob', content: f.contenu })) } });
        const commit = await gh(`/repos/${input.depot}/git/commits`, { method: 'POST', body: { message: input.message || 'Mise à jour par Tehis', tree: arbre.sha, parents: [ref.object.sha] } });
        await gh(`/repos/${input.depot}/git/refs/heads/${encodeURIComponent(branche)}`, { method: 'PATCH', body: { sha: commit.sha } });
        return { envoye: true, depot: input.depot, branche, commit: commit.sha.slice(0, 7), url: `https://github.com/${input.depot}/commit/${commit.sha}`, fichiers: input.fichiers.map((f) => f.chemin) };
      }
      case 'render_services': {
        const liste = await rd('/services?limit=20');
        return { services: liste.map(({ service: s }) => ({ id: s.id, nom: s.name, type: s.type, depot: s.repo, branche: s.branch, url: s.serviceDetails?.url, suspendu: s.suspended })) };
      }
      case 'render_creer_service': {
        const owners = await rd('/owners?limit=20');
        const owner = owners[0]?.owner;
        if (!owner) return { erreur: 'Aucun compte Render trouvé pour cette clé.' };
        const s = await rd('/services', {
          method: 'POST',
          body: {
            type: 'web_service', name: input.nom, ownerId: owner.id, repo: `https://github.com/${input.depot}`, branch: input.branche || undefined, autoDeploy: 'yes',
            serviceDetails: { runtime: input.environnement, plan: 'free', region: 'frankfurt', envSpecificDetails: { buildCommand: input.commandeBuild, startCommand: input.commandeStart } }
          }
        });
        const svc = s.service || s;
        return { cree: true, serviceId: svc.id, nom: svc.name, url: svc.serviceDetails?.url, tableauDeBord: svc.dashboardUrl };
      }
      case 'render_variables': {
        for (const v of input.variables || []) {
          if (!v.valeur) continue;
          await rd(`/services/${encodeURIComponent(input.serviceId)}/env-vars/${encodeURIComponent(v.cle)}`, { method: 'PUT', body: { value: v.valeur } });
        }
        const aRemplir = (input.variables || []).filter((v) => !v.valeur).map((v) => v.cle);
        return { defini: (input.variables || []).filter((v) => v.valeur).map((v) => v.cle), aRemplirDansRender: aRemplir };
      }
      case 'render_deployer': {
        const d = await rd(`/services/${encodeURIComponent(input.serviceId)}/deploys`, { method: 'POST', body: { clearCache: 'do_not_clear' } });
        return { lance: true, deployId: d.id, statut: d.status };
      }
      case 'render_statut': {
        const liste = await rd(`/services/${encodeURIComponent(input.serviceId)}/deploys?limit=3`);
        return { deploiements: liste.map(({ deploy: d }) => ({ id: d.id, statut: d.status, debut: d.createdAt, fin: d.finishedAt, commit: d.commit?.message?.split('\n')[0] })) };
      }
      default: return { erreur: `Outil inconnu : ${nom}` };
    }
  } catch (e) {
    return { erreur: e.message };
  }
}
