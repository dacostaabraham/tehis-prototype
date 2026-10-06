// Tehis sur WhatsApp : chaque compte parle à ses agents depuis WhatsApp avec le numéro de son compte.
// Texte, vocaux (transcrits), photos, position partagée ; réponses en texte, boutons, listes, lieux et vocaux.
import { AGENTS, accesAgent } from '../public/shared/agents.js';
import { telephoneDeWa, waDeTelephone, versWhatsApp } from './whatsapp.js';

const FENETRE_24H = 23.5 * 3_600_000; // marge sur la fenêtre de 24 h de WhatsApp
const MOTS_MENU = /^(menu|agents?|changer|changer d'agent)$/i;
const MOTS_AIDE = /^(aide|help|\?|comment ça marche)$/i;
const distance = (m) => (m == null ? 'distance inconnue' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

export const AIDE_WHATSAPP = `*Tehis sur WhatsApp* 🐾
• Écris-moi ou envoie un vocal : je réponds.
• *menu* : changer d'agent (santé, budget, CV, démarches…).
• Partage ta position 📍 pour les pharmacies de garde et les lieux proches.
• Envoie une photo : un exercice, un produit, un document.
• Tes rappels peuvent arriver ici : Réglages › WhatsApp dans l'app.`;

export function creerCanalWhatsApp({ store, client, repondreAgent, quotaMessageAtteint, nettoyerHistorique, iaActive, voix = {}, urlApp = '', journal = console }) {
  const invitesRecents = new Map(); // numéros sans compte déjà invités (une invitation par jour)
  const files = new Map(); // un message à la fois par personne, dans l'ordre

  function recu(messages) {
    for (const m of messages) {
      const avant = files.get(m.de) || Promise.resolve();
      const suite = avant.then(() => traiter(m)).catch((e) => journal.error('WhatsApp :', e.message));
      files.set(m.de, suite);
      suite.finally(() => { if (files.get(m.de) === suite) files.delete(m.de); });
    }
  }

  async function traiter(m) {
    const wa = m.de;
    const auth = await store.getUserAuth(telephoneDeWa(wa));
    if (!auth) {
      const t = invitesRecents.get(wa);
      if (t && Date.now() - t < 86_400_000) return;
      invitesRecents.set(wa, Date.now());
      return client.texte(wa, `Bonjour${m.nom ? ` ${m.nom}` : ''} ! Ici Tehis 🐾, ton compagnon IA de Côte d'Ivoire.\nPour discuter avec moi ici, crée d'abord ton compte avec ce numéro WhatsApp :\n${urlApp}`);
    }
    let compte = await store.getUser(auth.id);
    const nouveau = !compte.data?.waBienvenue;
    compte = await store.updateUser(compte.id, { data: { waDernier: Date.now(), ...(nouveau ? { waBienvenue: true } : {}) } });
    const req = { compte, store: store.pour(compte.id), ip: `whatsapp:${wa}` };
    client.marquerLu(m.id);
    const nomCompagnon = compte.data?.nomCompagnon || 'Kiki';
    if (nouveau) await client.texte(wa, `Salut ${compte.data?.prenom || ''} ! C'est ${nomCompagnon}, maintenant aussi sur WhatsApp 🎉\n\n${AIDE_WHATSAPP}`);

    let agent = compte.data?.agentWhatsapp && accesAgent(compte.data.agentWhatsapp, { ...compte.data, offre: compte.offre }).ok ? compte.data.agentWhatsapp : 'compagnon';
    let texte = (m.texte || '').trim();
    let position = null;
    let images = [];
    let enVocal = false;

    if (m.type === 'reponse') {
      const [genre, ...reste] = m.reponseId.split(':');
      const valeur = reste.join(':');
      if (genre === 'agent' && AGENTS[valeur]) {
        const acces = accesAgent(valeur, { ...compte.data, offre: compte.offre });
        if (!acces.ok) return client.texte(wa, acces.raison);
        await store.updateUser(compte.id, { data: { agentWhatsapp: valeur } });
        const a = AGENTS[valeur];
        await client.texte(wa, `${a.icone} Tu parles maintenant avec *${a.nom}*.\n${a.intro}`);
        return client.choix(wa, 'Quelques idées pour commencer :', a.suggestions.slice(0, 4).map((s) => ({ id: `dire:${s}`, titre: s, description: s.length > 24 ? s : undefined })), { bouton: 'Idées' });
      }
      texte = genre === 'dire' || genre === 'choix' ? valeur : texte;
    } else if (m.type === 'location') {
      if (!Number.isFinite(m.position.lat) || !Number.isFinite(m.position.lng)) return;
      position = m.position;
      texte = 'Voici ma position : cherche ce dont j\'ai besoin autour de moi.';
    } else if (m.type === 'audio') {
      if (!voix.active?.()) return client.texte(wa, "Je ne sais pas encore écouter les vocaux ici. Écris-moi ton message ✍️");
      try {
        const { donnees, type } = await client.telecharger(m.media.id);
        texte = await voix.transcrire(donnees, type);
        enVocal = true;
      } catch (e) {
        journal.error('Vocal WhatsApp :', e.message);
        return client.texte(wa, "Je n'ai pas pu écouter ton vocal. Réessaie ou écris-moi.");
      }
      if (!texte) return client.texte(wa, "Je n'ai rien entendu dans ton vocal. Réessaie un peu plus près du micro.");
    } else if (m.type === 'image') {
      try {
        const { donnees, type } = await client.telecharger(m.media.id);
        if (donnees.length < 5_000_000 && /^image\/(jpeg|png|webp)$/.test(type)) images = [`data:${type};base64,${donnees.toString('base64')}`];
      } catch (e) { journal.error('Photo WhatsApp :', e.message); }
      texte = texte || 'Voici une photo.';
    } else if (m.type === 'autre') {
      return client.texte(wa, 'Je comprends les messages écrits, les vocaux, les photos et la position 📍.');
    }

    if (MOTS_MENU.test(texte)) return envoyerMenu(wa, compte);
    if (MOTS_AIDE.test(texte)) return client.texte(wa, AIDE_WHATSAPP);
    if (!texte) return;

    if (iaActive()) {
      const plein = await quotaMessageAtteint(req);
      if (plein) return client.texte(wa, plein);
    }

    // Une conversation WhatsApp par agent, gardée sur le serveur.
    const cle = `whatsapp:${agent}`;
    const passe = (await req.store.getConversation(cle))?.items || [];
    const historique = nettoyerHistorique([...passe, { role: 'user', content: texte, images }]);

    const evenements = [];
    await repondreAgent(req, { agent, historique, position, send: (ev, d) => evenements.push([ev, d]), canal: 'whatsapp' });

    let tampon = '';
    let reponse = '';
    let fete = null;
    const vider = async () => {
      const t = versWhatsApp(tampon);
      tampon = '';
      if (t) { reponse += `${t}\n\n`; await client.texte(wa, t); }
    };
    for (const [ev, d] of evenements) {
      if (ev === 'token') tampon += d.text;
      else if (ev === 'error') tampon += `\n${d.message}`;
      else if (ev === 'sources') tampon += `\n\nSources :\n${d.sources.slice(0, 4).map((s) => `• ${s.url}`).join('\n')}`;
      else if (ev === 'progression' && d.niveauGagne) fete = d;
      else if (ev === 'tool' && d.result?.type === 'lieux') { await vider(); await envoyerLieux(wa, d.result); }
      else if (ev === 'document') { await vider(); await client.texte(wa, `📄 *${d.titre}*\n\n${versWhatsApp(d.contenu)}`); }
      else if (ev === 'choix') {
        await vider();
        await client.choix(wa, d.question, d.options.map((o) => ({ id: `choix:${o}`, titre: o, description: o.length > 24 ? o : undefined })), { bouton: 'Répondre' });
      } else if (ev === 'position') {
        await vider();
        await client.demanderPosition(wa, `Partage ta position 📍 et je cherche les ${String(d.libelle || 'lieux').toLowerCase()} les plus proches. Tu peux aussi m'écrire ton quartier.`);
      }
    }
    await vider();
    if (fete) await client.texte(wa, `🎉 ${nomCompagnon} passe au niveau ${fete.niveau} : *${fete.nom}* !${fete.nouveaux?.length ? ' Un nouvel accessoire l\'attend dans l\'app.' : ''}`);

    // Réponse aussi en vocal quand on m'a parlé en vocal.
    if (enVocal && reponse && voix.active?.()) {
      try { await client.audio(wa, (await voix.synthetiser(reponse.slice(0, 700), compte.data?.espece || 'chat')).audio); } catch (e) { journal.error('Vocal sortant :', e.message); }
    }
    const items = [...passe, { role: 'user', content: texte }, { role: 'assistant', content: reponse.trim() || '(cartes envoyées)' }].slice(-30);
    await req.store.saveConversation(cle, items);
  }

  async function envoyerLieux(wa, r) {
    const garde = r.gardeDAbord && r.garde?.pharmacies?.length;
    const liste = garde ? r.garde.pharmacies : r.lieux;
    if (!liste.length) return client.texte(wa, `Je n'ai pas trouvé de ${r.libelle.toLowerCase()} dans ce rayon. Essaie un autre quartier.`);
    const titre = garde ? `🌙 *Pharmacies de garde* ${r.garde.periode ? `(semaine ${r.garde.periode})` : ''}` : `${r.icone} *${r.libelle}* autour de ${r.centre.libelle}`;
    const lignes = liste.slice(0, 6).map((l, i) => `${i + 1}. *${l.nom}*${l.garde && !garde ? ' 🌙' : ''} · ${distance(l.distance)}${l.commune && garde ? ` · ${l.commune}` : ''}${l.telephone ? `\n   📞 ${l.telephone}` : ''}`);
    await client.texte(wa, `${titre}\n\n${lignes.join('\n')}${r.note ? `\n\n_${r.note}_` : ''}`);
    const premier = liste.find((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng));
    if (premier) await client.lieu(wa, premier);
  }

  async function envoyerMenu(wa, compte) {
    const profil = { ...compte.data, offre: compte.offre };
    const options = Object.entries(AGENTS)
      .filter(([id]) => id !== 'dev' && accesAgent(id, profil).ok)
      .slice(0, 10)
      .map(([id, a]) => ({ id: `agent:${id}`, titre: `${a.icone} ${a.nom}`, description: a.resume }));
    return client.choix(wa, 'Avec quel agent veux-tu parler ?', options, { bouton: 'Agents', titreSection: 'Tes agents' });
  }

  /** Rappel envoyé sur WhatsApp si le compte l'a demandé (texte dans la fenêtre de 24 h, sinon modèle approuvé). */
  async function rappel(r) {
    const compte = r.user_id ? await store.getUser(r.user_id) : null;
    if (!compte?.data?.rappelsWhatsApp) return false;
    const wa = waDeTelephone(compte.telephone);
    if (Date.now() - (compte.data.waDernier || 0) < FENETRE_24H) { await client.texte(wa, `🔔 *Rappel* : ${r.texte}`); return true; }
    if (client.config.modeleRappel) { await client.modele(wa, client.config.modeleRappel, [r.texte]); return true; }
    return false;
  }

  /** Code de connexion (code secret oublié) : modèle « authentification » approuvé, sinon texte si la fenêtre est ouverte. */
  async function code(compte, valeur) {
    const wa = waDeTelephone(compte.telephone);
    if (client.config.modeleCode) return client.modele(wa, client.config.modeleCode, [valeur], { boutonCode: valeur });
    if (Date.now() - (compte.data?.waDernier || 0) < FENETRE_24H) return client.texte(wa, `Ton code Tehis : *${valeur}*\nIl expire dans 10 minutes. Ne le donne à personne.`);
    throw new Error('Aucun modèle de code configuré et fenêtre de 24 h fermée');
  }

  return { recu, traiter, rappel, code };
}
