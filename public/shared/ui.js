// Petits utilitaires d'interface partagés : toast (remplace alert() natif).
let minuteur = null;

/** Affiche un message temporaire en bas de l'écran. */
export function toast(message, duree = 3500) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.hidden = true;
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.hidden = false;
  clearTimeout(minuteur);
  minuteur = setTimeout(() => { t.hidden = true; }, duree);
}
