// Cartes affichées dans la discussion et dans les calculs : résultats chiffrés, documents,
// rappels, listes, suggestions d'agent, validations du mode développeur, sources.
import { lineChart, fcfa } from './charts.js';
import { markdown, echapper } from './shared/markdown.js';
import { AGENTS } from './shared/agents.js';

const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);
const signe = (n) => (n < 0 ? 'neg' : '');
const DATE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
export const dateFr = (iso) => DATE.format(new Date(iso)).replace(':', ' h ');
const REPETITIONS = { quotidien: 'tous les jours', hebdomadaire: 'chaque semaine', mensuel: 'chaque mois' };

function kv(lignes) {
  return `<dl class="kv">${lignes.filter(Boolean).map(([k, v, fort]) => `<dt>${echapper(k)}</dt><dd class="${fort ? 'strong' : ''}">${v}</dd>`).join('')}</dl>`;
}
const TITRES = {
  cascade: 'Cascade de rentabilité', point_mort: 'Point mort', prix: 'Fixer mon prix', projection: 'Prévisionnel mois par mois', bfr: 'Besoin en fonds de roulement',
  budget: 'Budget du mois', epargne: "Plan d'épargne", tontine: 'Tontine', rappel: 'Rappel programmé', rappels: 'Rappels à venir', liste: 'Liste', listes: 'Mes listes'
};
const ETIQUETTE = { rappel: 'enregistré', rappels: '', liste: 'enregistrée', listes: '' };

function carte(titre, sousTitre = 'calcul exact') {
  const el = document.createElement('div');
  el.className = 'result';
  el.innerHTML = `<div class="result-head"><span class="result-title">${echapper(titre)}</span><span class="muted small">${echapper(sousTitre)}</span></div>`;
  return el;
}

/** Carte d'un résultat d'outil (calculs, rappels, listes). ctx : { api } */
export function carteResultat(r, ctx = {}) {
  if (r?.erreur) { const el = document.createElement('div'); el.className = 'result'; el.innerHTML = `<div class="alert">${echapper(r.erreur)}</div>`; return el; }
  const el = carte(TITRES[r.type] || 'Calcul', r.type in ETIQUETTE ? ETIQUETTE[r.type] : 'calcul exact');
  let corps = '';
  const apres = [];

  if (r.type === 'cascade') {
    corps = `<div class="table-wrap"><table class="nums"><thead><tr><th>Étape</th><th>Montant</th><th>% du CA</th></tr></thead><tbody>${r.etapes.map((e) => {
      const fort = /Marge|EBITDA|Chiffre/.test(e.libelle);
      return `<tr${fort ? ' class="fort"' : ''}><td>${e.libelle}</td><td class="${signe(e.montant)}">${fcfa(e.montant)}</td><td>${pct(Math.abs(e.partDuCA ?? 0))}</td></tr>`;
    }).join('')}</tbody></table></div><div class="alert${r.margeNette > 0 ? ' ok' : ''}">${echapper(r.alerte)}</div>`;
  }

  if (r.type === 'point_mort') {
    if (r.unites === null) corps = `<div class="alert">${echapper(r.alerte)}</div>`;
    else {
      corps = `<div class="big">${r.unites.toLocaleString('fr-FR')}<small>ventes par période</small></div>
        ${kv([['Coût variable unitaire', fcfa(r.coutVariableUnitaire)], ['Marge de contribution unitaire', fcfa(r.margeContribution), true], ['Calcul exact', `${fcfa(r.chargesFixes)} ÷ ${fcfa(r.margeContribution)} = ${r.pointMortExact.toLocaleString('fr-FR')}`], ["Chiffre d'affaires au point mort", fcfa(r.chiffreAffairesPointMort), true]])}
        <canvas class="chart"></canvas>
        <div class="legend"><span><i style="background:var(--chart-a)"></i>Revenus</span><span><i style="background:var(--chart-b)"></i>Coûts totaux</span></div>
        <p class="lecture">${echapper(r.lecture)}</p>`;
      apres.push((c) => {
        const idx = r.courbe.findIndex((p) => p.unites >= r.unites);
        lineChart(c, {
          etiquettes: r.courbe.map((p) => String(p.unites)),
          series: [{ couleur: '--chart-a', valeurs: r.courbe.map((p) => p.revenus) }, { couleur: '--chart-b', valeurs: r.courbe.map((p) => p.coutsTotaux) }],
          marqueur: idx >= 0 ? { index: idx, valeur: r.courbe[idx].revenus, texte: `Point mort : ${r.unites}` } : null
        });
      });
    }
  }

  if (r.type === 'prix') {
    corps = `${r.prixCible !== null ? `<div class="big">${fcfa(r.prixCible)}<small>prix cible</small></div>` : ''}
      ${kv([
        ['Coût complet par unité', fcfa(r.coutComplet)],
        r.tempsDirigeant ? ['dont temps du dirigeant', fcfa(r.tempsDirigeant)] : null,
        ['Plancher (coût plus)', fcfa(r.plancher), true],
        r.tempsDirigeant ? ['Plancher sans compter ton temps', fcfa(r.plancherSansTempsDirigeant)] : null,
        r.plafond !== null ? ['Plafond (valeur perçue)', fcfa(r.plafond), true] : null,
        r.marche ? ['Marché : informel → haut de gamme', `${fcfa(r.marche.bas)} → ${fcfa(r.marche.haut)}`] : null,
        r.fourchetteRecommandee ? ['Fourchette recommandée', `${fcfa(r.fourchetteRecommandee.min)} → ${r.fourchetteRecommandee.max !== null ? fcfa(r.fourchetteRecommandee.max) : '…'}`, true] : null,
        r.margeNegociation ? [`Prix affiché (+${pct(r.margeNegociation)} de négociation)`, fcfa(r.prixAffiche), true] : null
      ])}
      ${r.alerte ? `<div class="alert">${echapper(r.alerte)}</div>` : ''}
      <p class="lecture muted">${echapper(r.rappel)}</p>`;
  }

  if (r.type === 'projection') {
    const pb = r.pointBasTresorerie;
    corps = `${kv([
      ['Point bas de trésorerie', `${fcfa(pb.montant)} (${pb.libelle})`, true],
      ['Besoin de financement', fcfa(r.besoinFinancement), true],
      ['Perte cumulée la plus forte', fcfa(r.perteCumuleeMaximale)],
      ['Premier mois rentable', r.premierMoisRentable ? `mois ${r.premierMoisRentable.mois} (${r.premierMoisRentable.libelle})` : 'pas sur la période'],
      ['Encaissement des ventes', `${r.hypotheses.decalageEncaissementMois} mois après la vente`]
    ])}
      <canvas class="chart"></canvas>
      <div class="legend"><span><i style="background:var(--chart-a)"></i>Trésorerie</span><span><i style="background:var(--chart-b)"></i>Résultat cumulé</span></div>
      <p class="lecture">${echapper(r.lecture)}</p>
      <details><summary>Voir le détail mois par mois</summary><div class="table-wrap"><table class="nums"><thead><tr><th>Mois</th><th>Clients</th><th>CA</th><th>Résultat</th><th>Encaissé</th><th>Trésorerie</th></tr></thead><tbody>${r.lignes.map((l) =>
        `<tr><td>${l.libelle}</td><td>${l.clients}</td><td>${fcfa(l.chiffreAffaires)}</td><td class="${signe(l.resultat)}">${fcfa(l.resultat)}</td><td>${fcfa(l.encaissements)}</td><td class="${signe(l.tresorerie)}">${fcfa(l.tresorerie)}</td></tr>`).join('')}</tbody></table></div></details>`;
    apres.push((c) => {
      const idx = r.lignes.findIndex((l) => l.mois === pb.mois);
      lineChart(c, {
        etiquettes: r.lignes.map((l) => l.libelle),
        series: [{ couleur: '--chart-a', valeurs: r.lignes.map((l) => l.tresorerie) }, { couleur: '--chart-b', valeurs: r.lignes.map((l) => l.resultatCumule) }],
        marqueur: { index: idx, valeur: pb.montant, texte: `Point bas : ${fcfa(pb.montant)}` }
      });
    });
  }

  if (r.type === 'bfr') {
    corps = `<div class="big">${fcfa(r.bfr)}<small>à financer</small></div>
      ${kv([['Créances clients (argent attendu)', fcfa(r.creancesClients)], ['Stock', fcfa(r.stock)], ['Dettes fournisseurs (argent dû plus tard)', `− ${fcfa(r.dettesFournisseurs)}`]])}
      <p class="lecture">${echapper(r.lecture)}</p><div class="alert">${echapper(r.question)}</div>`;
  }

  if (r.type === 'budget') {
    corps = `<div class="big ${signe(r.reste)}">${fcfa(r.reste)}<small>${r.reste >= 0 ? 'reste à la fin du mois' : 'de déficit'}</small></div>
      ${kv([['Revenus', fcfa(r.revenus)], ['Dépenses', fcfa(r.totalDepenses)], ["Taux d'épargne", pct(r.tauxEpargne), true]])}
      <div class="barres">${r.repartition.map((g) => {
        const largeur = Math.min(100, Math.round((g.part || 0) * 100));
        const repere = Math.round(g.repere * 100);
        return `<div class="barre-ligne"><div class="barre-texte"><span>${echapper(g.libelle)}</span><span class="num">${pct(g.part)} <span class="muted">· repère ${repere} %</span></span></div>
          <div class="barre-piste" role="img" aria-label="${echapper(g.libelle)} : ${pct(g.part)}, repère ${repere} %"><div class="barre-val b-${g.groupe}" style="width:${largeur}%"></div><div class="barre-repere" style="left:${repere}%"></div></div></div>`;
      }).join('')}</div>
      ${r.alertes.map((a) => `<div class="alert">${echapper(a)}</div>`).join('')}
      <p class="lecture">${echapper(r.lecture)}</p><p class="small muted">${echapper(r.rappel)}</p>`;
  }

  if (r.type === 'epargne') {
    corps = `${r.mensualiteNecessaire !== undefined ? `<div class="big">${fcfa(r.mensualiteNecessaire)}<small>par mois</small></div>` : r.moisNecessaires ? `<div class="big">${r.moisNecessaires}<small>mois</small></div>` : ''}
      ${kv([['Objectif', fcfa(r.objectif)], ['Déjà épargné', fcfa(r.dejaEpargne)], ['Reste à réunir', fcfa(r.restant), true], r.epargneMensuelle !== undefined ? ['Épargne par mois', fcfa(r.epargneMensuelle)] : null, r.atteintEn ? ['Objectif atteint', `fin ${r.atteintEn}`, true] : null])}
      <p class="lecture">${echapper(r.lecture)}</p>`;
  }

  if (r.type === 'tontine') {
    corps = `<div class="big">${fcfa(r.cagnotte)}<small>reçus au tour ${r.position}</small></div>
      <div class="tours" role="img" aria-label="Tu reçois au tour ${r.position} sur ${r.membres}">${r.tours.map((t) => `<span class="${t.beneficiaire === 'toi' ? 'toi' : t.tour < r.position ? 'avant' : ''}">${t.tour}</span>`).join('')}</div>
      ${kv([['Cotisation', `${fcfa(r.cotisation)} par ${r.frequence}`], ['Durée du cycle', r.dureeCycle], ['Versé jusqu\'à ton tour', fcfa(r.versesAvantDeRecevoir)], [r.avance >= 0 ? 'Avance reçue sans intérêt' : 'Épargne avancée aux autres', fcfa(Math.abs(r.avance)), true], r.fraisParTour ? ['Frais par tour', fcfa(r.fraisParTour)] : null])}
      <p class="lecture">${echapper(r.lecture)}</p><div class="alert">${echapper(r.risque)}</div>`;
  }

  if (r.type === 'rappel') {
    corps = `<div class="rappel"><span class="cloche" aria-hidden="true">🔔</span><div><strong>${echapper(r.texte)}</strong><div class="muted small">${echapper(dateFr(r.quand))}${r.repetition && r.repetition !== 'aucune' ? `, ${REPETITIONS[r.repetition]}` : ''}</div></div></div>
      <div class="calc-actions"><button class="btn small" type="button" data-annuler>Annuler ce rappel</button></div>`;
    apres.push(() => {
      el.querySelector('[data-annuler]').onclick = async (e) => {
        await ctx.api?.(`/api/reminders/${r.id}`, { method: 'DELETE' });
        e.target.replaceWith(Object.assign(document.createElement('span'), { className: 'muted small', textContent: 'Rappel annulé.' }));
      };
    });
  }

  if (r.type === 'rappels') {
    corps = r.rappels.length ? `<ul class="simple">${r.rappels.map((x) => `<li><strong>${echapper(x.texte)}</strong><br><span class="muted small">${echapper(dateFr(x.quand))}${x.repetition !== 'aucune' ? `, ${REPETITIONS[x.repetition] || ''}` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">Aucun rappel à venir.</p>';
  }

  if (r.type === 'liste' || r.type === 'listes') {
    const listes = r.type === 'liste' ? [r] : r.listes;
    corps = listes.length ? listes.map((l) => blocListe(l)).join('') : '<p class="muted">Aucune liste pour l\'instant.</p>';
    apres.push(() => brancherListes(el, ctx));
    if (r.type === 'liste') el.querySelector('.result-title').textContent = r.titre;
  }

  el.insertAdjacentHTML('beforeend', corps);
  requestAnimationFrame(() => { const c = el.querySelector('canvas'); apres.forEach((f) => f(c)); });
  return el;
}

export function blocListe(l) {
  return `<div class="liste" data-liste="${l.id}">${l.titre && l.type !== 'liste' ? `<div class="liste-titre">${echapper(l.titre)}</div>` : ''}<ul>${l.items.map((it) => `<li><label class="coche"><input type="checkbox" data-item="${it.id}"${it.fait ? ' checked' : ''}><span>${echapper(it.texte)}</span></label></li>`).join('') || '<li class="muted small">Liste vide</li>'}</ul></div>`;
}

export function brancherListes(racine, ctx) {
  racine.querySelectorAll('[data-liste] input[type=checkbox]').forEach((cb) => {
    cb.onchange = async () => {
      const id = cb.closest('[data-liste]').dataset.liste;
      try { await ctx.api(`/api/lists/${id}/items/${cb.dataset.item}`, { method: 'PATCH', body: JSON.stringify({ fait: cb.checked }) }); } catch { cb.checked = !cb.checked; }
    };
  });
}

/* ---------- Documents ---------- */
export const texteBrut = (md) => String(md).replace(/^#{1,4}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');

export function actionsDocument(d, conteneur) {
  conteneur.innerHTML = `<button class="btn small" type="button" data-copier>Copier</button>
    <a class="btn small" href="https://wa.me/?text=${encodeURIComponent(texteBrut(d.contenu).slice(0, 3500))}" target="_blank" rel="noopener">WhatsApp</a>
    <a class="btn small" href="/api/documents/${d.id}/imprimer" target="_blank" rel="noopener">PDF</a>`;
  conteneur.querySelector('[data-copier]').onclick = async (e) => {
    try { await navigator.clipboard.writeText(texteBrut(d.contenu)); e.target.textContent = 'Copié'; } catch { e.target.textContent = 'Copie impossible'; }
    setTimeout(() => { e.target.textContent = 'Copier'; }, 1800);
  };
}

export function carteDocument(d) {
  const el = carte(d.titre, d.libelleType || 'Document');
  el.classList.add('doc');
  el.insertAdjacentHTML('beforeend', `<div class="doc-apercu">${markdown(d.contenu)}</div><button class="lien" type="button" data-deplier>Voir tout</button><div class="doc-actions"></div>`);
  const apercu = el.querySelector('.doc-apercu');
  el.querySelector('[data-deplier]').onclick = (e) => { apercu.classList.toggle('ouvert'); e.target.textContent = apercu.classList.contains('ouvert') ? 'Réduire' : 'Voir tout'; };
  actionsDocument(d, el.querySelector('.doc-actions'));
  return el;
}

/* ---------- Suggestions et mode développeur ---------- */
export function carteSuggestion(s, ctx) {
  const a = AGENTS[s.agent];
  const el = document.createElement('div');
  el.className = 'result suggestion';
  el.innerHTML = `<div><strong>${a.icone} ${echapper(a.nom)}</strong><p class="small muted">${echapper(s.raison || a.resume)}</p></div><button class="btn accent small" type="button">Ouvrir</button>`;
  el.querySelector('button').onclick = () => ctx.choisirAgent(s.agent);
  return el;
}

export function carteOffreDev(ctx) {
  const el = document.createElement('div');
  el.className = 'result suggestion';
  el.innerHTML = `<div><strong>${AGENTS.dev.icone} Mode développeur</strong><p class="small muted">Code, GitHub et déploiement Render, avec ta validation à chaque étape.</p></div><button class="btn accent small" type="button">Activer</button>`;
  el.querySelector('button').onclick = () => ctx.ouvrirDialogueDev();
  return el;
}

const STATUTS = { en_attente: 'À valider', executee: 'Fait', echec: 'Échec', refusee: 'Refusé', envoi: 'En cours…' };

/** Carte de validation d'une action du mode développeur. item : { action, statut, resultat } */
export function carteValidation(item, ctx) {
  const a = item.action;
  const el = document.createElement('div');
  el.className = 'result validation';
  const fichiers = a.fichiers ? `<details><summary>${a.fichiers.length > 1 ? `Voir les ${a.fichiers.length} fichiers` : 'Voir le fichier'}</summary>${a.fichiers.map((f) => `<div class="fichier"><div class="mono small">${echapper(f.chemin)}</div><pre class="code"><code>${echapper(f.contenu.slice(0, 6000))}${f.contenu.length > 6000 ? '\n…' : ''}</code></pre></div>`).join('')}</details>` : '';
  const rendu = () => {
    const resultat = item.resultat;
    const lien = resultat?.url ? `<a href="${echapper(resultat.url)}" target="_blank" rel="noopener">Ouvrir</a>` : '';
    el.innerHTML = `<div class="result-head"><span class="result-title">Mode développeur</span><span class="statut s-${item.statut}">${STATUTS[item.statut]}</span></div>
      <strong>${echapper(a.resume)}</strong>
      ${a.details?.length ? `<ul class="simple small">${a.details.map((d) => `<li>${echapper(d)}</li>`).join('')}</ul>` : ''}
      ${fichiers}
      ${item.statut === 'en_attente' ? '<div class="calc-actions"><button class="btn accent small" type="button" data-ok>Valider</button><button class="btn small" type="button" data-non>Refuser</button></div>' : ''}
      ${item.statut === 'echec' ? `<div class="alert">${echapper(resultat?.erreur || 'Échec')}</div>` : ''}
      ${item.statut === 'executee' && lien ? `<p class="small">${lien}</p>` : ''}`;
    el.querySelector('[data-ok]')?.addEventListener('click', () => decider('valider'));
    el.querySelector('[data-non]')?.addEventListener('click', () => decider('refuser'));
  };
  async function decider(decision) {
    item.statut = 'envoi'; rendu();
    try {
      const r = await ctx.api(`/api/actions/${a.id}`, { method: 'POST', body: JSON.stringify({ decision }) });
      item.statut = r.statut; item.resultat = r.resultat || null;
    } catch (e) { item.statut = 'echec'; item.resultat = { erreur: e.message }; }
    rendu();
    ctx.sauver?.();
    ctx.apresDecision?.(item);
  }
  rendu();
  return el;
}

export function noteActivite(texte) {
  const n = document.createElement('div');
  n.className = 'note activite';
  n.textContent = texte;
  return n;
}

export function blocSources(liste) {
  const el = document.createElement('div');
  el.className = 'sources';
  el.innerHTML = `<div class="small muted">Sources</div><ol>${liste.map((s) => `<li><a href="${echapper(s.url)}" target="_blank" rel="noopener noreferrer">${echapper(s.titre)}</a> <span class="muted">${echapper(new URL(s.url).hostname.replace(/^www\./, ''))}</span></li>`).join('')}</ol>`;
  return el;
}
