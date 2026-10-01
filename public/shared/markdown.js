// Petit rendu Markdown sûr (tout est échappé) : titres, gras, italique, listes, liens https, code.
// Partagé par l'app (bulles, documents) et le serveur (page d'impression des documents).

const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function enLigne(l) {
  const codes = [];
  let t = echapper(l).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_(?!\s)(.+?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

export function markdown(texte) {
  const src = String(texte || '').replace(/\r\n/g, '\n').trim();
  if (!src) return '';
  const sortie = [];
  const lignes = src.split('\n');
  let i = 0;
  while (i < lignes.length) {
    const l = lignes[i];
    if (/^```/.test(l)) {
      const langue = l.slice(3).trim();
      const bloc = [];
      i++;
      while (i < lignes.length && !/^```/.test(lignes[i])) bloc.push(lignes[i++]);
      i++;
      sortie.push(`<pre class="code"${langue ? ` data-lang="${echapper(langue)}"` : ''}><code>${echapper(bloc.join('\n'))}</code></pre>`);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const titre = /^(#{1,4})\s+(.*)$/.exec(l);
    if (titre) { const n = Math.min(titre[1].length + 2, 6); sortie.push(`<h${n}>${enLigne(titre[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-•*])\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l)) {
      const ordonnee = /^\s*\d+[.)]\s+/.test(l);
      const items = [];
      while (i < lignes.length && (ordonnee ? /^\s*\d+[.)]\s+/ : /^\s*([-•*])\s+/).test(lignes[i])) {
        items.push(`<li>${enLigne(lignes[i].replace(/^\s*([-•*]|\d+[.)])\s+/, ''))}</li>`);
        i++;
      }
      sortie.push(ordonnee ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^---+$/.test(l.trim())) { sortie.push('<hr>'); i++; continue; }
    const para = [];
    while (i < lignes.length && lignes[i].trim() && !/^(#{1,4}\s|```|\s*([-•*]|\d+[.)])\s+)/.test(lignes[i])) para.push(enLigne(lignes[i++]));
    sortie.push(`<p>${para.join('<br>')}</p>`);
  }
  return sortie.join('');
}

export { echapper };
