// Faux serveur de l'API Anthropic (flux SSE) pour tester la boucle d'outils sans clé ni réseau.
// Scénarios choisis selon les outils envoyés : rappel, mode développeur, recherche web avec pause_turn.
import http from 'node:http';
import { writeFileSync } from 'node:fs';

const requetes = [];
const port = Number(process.argv[2] || 4999);

function flux(res, blocs, stop) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const e = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  e('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'faux', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } });
  blocs.forEach((b, index) => {
    if (b.type === 'text') {
      e('content_block_start', { index, content_block: { type: 'text', text: '', citations: null } });
      for (const morceau of b.text.match(/.{1,12}/gs)) e('content_block_delta', { index, delta: { type: 'text_delta', text: morceau } });
      for (const c of b.citations || []) e('content_block_delta', { index, delta: { type: 'citations_delta', citation: c } });
    } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
      e('content_block_start', { index, content_block: { type: b.type, id: b.id, name: b.name, input: {} } });
      e('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    } else {
      e('content_block_start', { index, content_block: b });
    }
    e('content_block_stop', { index });
  });
  e('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 42 } });
  e('message_stop', {});
  res.end();
}

http.createServer((req, res) => {
  let corps = '';
  req.on('data', (c) => { corps += c; });
  req.on('end', () => {
    const b = JSON.parse(corps);
    requetes.push(b);
    writeFileSync(process.env.FAUX_JOURNAL || '/tmp/faux-anthropic.json', JSON.stringify(requetes, null, 1));
    const noms = (b.tools || []).map((t) => t.name);
    if (!b.stream && noms.includes('proposer_fiche')) {
      const refus = /arnaque|faux reçus/i.test(JSON.stringify(b.messages));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: 'msg_f', type: 'message', role: 'assistant', model: 'faux', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 50, output_tokens: 80 },
        content: [{ type: 'tool_use', id: 'toolu_f', name: 'proposer_fiche', input: refus ? { refus: 'Je ne peux pas créer un agent destiné à tromper des personnes.', nom: '', icone: '', resume: '', mission: '', ton: 'direct', regles: [], suggestions: [], outils: [] }
          : { nom: 'Coiffure Awa', icone: '💇🏾‍♀️', resume: 'Conseille les clientes et prépare les rappels de rendez-vous', mission: 'Tu aides les clientes du salon Awa à Yopougon à choisir une coiffure et tu donnes les tarifs : tresses 5 000 FCFA, nattes 3 000 FCFA.', ton: 'chaleureux', regles: ['Toujours rappeler les tarifs en FCFA'], suggestions: ['Quelle coiffure pour un mariage ?', 'Prépare un rappel de rendez-vous'], outils: ['documents', 'rappels'] } }] }));
    }
    const dernier = b.messages.at(-1);
    const apresOutil = Array.isArray(dernier.content) && dernier.content.some((c) => c.type === 'tool_result');

    const texteUser = JSON.stringify(b.messages.filter((m) => m.role === 'user').at(-1)?.content || '');
    if (noms.includes('poser_choix') && /quiz/i.test(texteUser) && !apresOutil) {
      return flux(res, [{ type: 'text', text: 'Question 1 : combien font 7 × 8 ?' }, { type: 'tool_use', id: 'toolu_c1', name: 'poser_choix', input: { question: '7 × 8 = ?', options: ['54', '56', '64'] } }], 'tool_use');
    }
    if (noms.includes('chercher_lieux') && /pharmacie/i.test(texteUser) && !apresOutil) {
      return flux(res, [{ type: 'text', text: 'Je regarde autour de toi.' }, { type: 'tool_use', id: 'toolu_l1', name: 'chercher_lieux', input: { categorie: 'pharmacie' } }], 'tool_use');
    }
    if (apresOutil && dernier.content.some((c) => c.tool_use_id === 'toolu_c1' || c.tool_use_id === 'toolu_l1')) {
      return flux(res, [{ type: 'text', text: dernier.content.some((c) => c.tool_use_id === 'toolu_c1') ? '' : 'Voici les plus proches. Appelle avant de te déplacer la nuit.' }].filter((x) => x.text), 'end_turn');
    }
    if (noms.includes('web_search')) {
      if (dernier.role === 'user') {
        return flux(res, [
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'création entreprise CEPICI pièces' } },
          { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://www.cepici.gouv.ci', title: 'CEPICI', encrypted_content: 'xyz', page_age: null }] }
        ], 'pause_turn');
      }
      return flux(res, [{ type: 'text', text: 'Pour créer ton entreprise, passe par le guichet unique.', citations: [{ type: 'web_search_result_location', url: 'https://www.cepici.gouv.ci', title: 'CEPICI', encrypted_index: 'a', cited_text: 'guichet unique' }] }], 'end_turn');
    }
    if (noms.includes('creer_rappel')) {
      if (!apresOutil) return flux(res, [{ type: 'text', text: 'Je programme ça.' }, { type: 'tool_use', id: 'toolu_r1', name: 'creer_rappel', input: { texte: 'Payer le loyer', quand: '2030-01-05T09:00', repetition: 'mensuel' } }], 'tool_use');
      return flux(res, [{ type: 'text', text: "C'est noté pour le samedi 5 janvier à 9 h." }], 'end_turn');
    }
    if (noms.includes('github_ecrire_fichiers')) {
      if (!apresOutil) return flux(res, [{ type: 'tool_use', id: 'toolu_d1', name: 'github_ecrire_fichiers', input: { depot: 'abraham/app', message: 'Première version', fichiers: [{ chemin: 'server.js', contenu: "import express from 'express';" }] } }], 'tool_use');
      return flux(res, [{ type: 'text', text: 'Vérifie la carte puis appuie sur Valider.' }], 'end_turn');
    }
    if (noms.includes('creer_document')) {
      if (!apresOutil) return flux(res, [{ type: 'tool_use', id: 'toolu_c1', name: 'creer_document', input: { type: 'lettre', titre: 'Réclamation', contenu: 'Madame, Monsieur,\n\nJe vous écris…' } }], 'tool_use');
      return flux(res, [{ type: 'text', text: 'Ta lettre est prête.' }], 'end_turn');
    }
    return flux(res, [{ type: 'text', text: 'Bonjour !' }], 'end_turn');
  });
}).listen(port, () => console.log(`faux anthropic sur ${port}`));
