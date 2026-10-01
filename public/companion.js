// Compagnon 3D : charge le modèle GLB de l'espèce choisie et l'anime selon l'humeur.
// Sans WebGL ou sans réseau vers le CDN, affiche l'image de l'animal (repli 2D).

export const ESPECES = [
  { id: 'chat', nom: 'Chat' },
  { id: 'elephant', nom: 'Éléphant' },
  { id: 'perroquet', nom: 'Perroquet' },
  { id: 'tortue', nom: 'Tortue' }
];

export const HUMEURS = { repos: 'Au repos', ecoute: 'Je réponds', reflechit: 'Je réfléchis', travaille: 'Je calcule', fete: 'Terminé !', parle: 'Je parle' };

export async function mountCompanion(container, especeInitiale) {
  const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let humeur = 'repos';
  let elan = 0; // impulsion donnée à chaque mot prononcé
  let debutHumeur = 0;
  let espece = especeInitiale;

  const repli = () => {
    container.querySelector('.fallback')?.remove();
    const div = document.createElement('div');
    div.className = 'fallback';
    div.innerHTML = `<img alt="" src="/pets/${espece}.jpg">`;
    container.appendChild(div);
    return {
      setMood(m) { humeur = m; div.classList.toggle('parle', m === 'parle'); },
      async setSpecies(e) { espece = e; div.querySelector('img').src = `/pets/${e}.jpg`; },
      impulsion() {}
    };
  };

  let THREE, GLTFLoader;
  try {
    THREE = await import('three');
    ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
    const test = document.createElement('canvas');
    if (!test.getContext('webgl2') && !test.getContext('webgl')) throw new Error('webgl');
  } catch (e) {
    console.warn('3D indisponible, repli en 2D', e);
    return repli();
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.5, 7.4);
  camera.lookAt(0, 1.1, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8aa39e, 2.2));
  const soleil = new THREE.DirectionalLight(0xffffff, 1.6);
  soleil.position.set(3, 6, 5);
  scene.add(soleil);
  const ombre = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14, depthWrite: false }));
  ombre.rotation.x = -Math.PI / 2; ombre.position.y = 0.005; scene.add(ombre);

  const anneauMat = new THREE.MeshBasicMaterial({ color: 0x0e7c86, transparent: true, opacity: 0.8, depthWrite: false });
  const onde = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 64), anneauMat);
  onde.rotation.x = -Math.PI / 2; onde.position.y = 0.01; scene.add(onde);
  const anneauTravail = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.025, 8, 80, Math.PI * 1.4), anneauMat);
  anneauTravail.rotation.x = Math.PI / 2; anneauTravail.position.y = 1.0; scene.add(anneauTravail);
  const points = new THREE.Group();
  for (let i = 0; i < 3; i++) points.add(new THREE.Mesh(new THREE.SphereGeometry(0.07 + i * 0.025, 16, 12), new THREE.MeshBasicMaterial({ color: 0x0e7c86 })));
  scene.add(points);
  const confettis = new THREE.Group();
  const couleurs = [0xf2c14e, 0xe4572e, 0x4fb7c0, 0x76b041, 0xe48fa6];
  for (let i = 0; i < 40; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.015), new THREE.MeshBasicMaterial({ color: couleurs[i % couleurs.length], side: THREE.DoubleSide }));
    c.userData = { v: 0.6 + Math.random() * 0.9, s: Math.random() * 6, x: (Math.random() - 0.5) * 3.4, z: (Math.random() - 0.5) * 2, y: Math.random() * 3.5 + 0.5 };
    confettis.add(c);
  }
  scene.add(confettis);

  const couleurAccent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0E7C86';
  const appliquerTheme = () => { const c = new THREE.Color(couleurAccent()); anneauMat.color.copy(c); points.children.forEach((p) => p.material.color.copy(c)); };
  appliquerTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', appliquerTheme);

  const loader = new GLTFLoader();
  const cache = {};
  const racine = new THREE.Group();
  const corps = new THREE.Group();
  racine.add(corps); scene.add(racine);

  async function chargerEspece(e) {
    espece = e;
    try {
      if (!cache[e]) cache[e] = loader.loadAsync(`/models/${e}.glb`).then((g) => g.scene);
      const src = await cache[e];
      if (espece !== e) return;
      corps.clear();
      const m = src.clone(true);
      m.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.metalness = 0; o.material.roughness = 0.85; } });
      const box = new THREE.Box3().setFromObject(m);
      const taille = box.getSize(new THREE.Vector3());
      m.scale.setScalar(2.3 / taille.y);
      box.setFromObject(m);
      const centre = box.getCenter(new THREE.Vector3());
      m.position.x -= centre.x; m.position.z -= centre.z; m.position.y -= box.min.y;
      corps.add(m);
    } catch (err) {
      console.warn('Modèle introuvable', err);
    }
  }
  await chargerEspece(espece);

  // Rotation au doigt
  let rotY = -0.3, vitesse = 0, glisse = false, dernierX = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { glisse = true; dernierX = e.clientX; vitesse = 0; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => { if (!glisse) return; const dx = e.clientX - dernierX; dernierX = e.clientX; vitesse = dx * 0.012; rotY += vitesse; });
  const fin = () => { glisse = false; };
  el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin);

  function redimensionner() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(redimensionner).observe(container);
  redimensionner();

  const horloge = new THREE.Clock();
  const lerp = (a, b, k) => a + (b - a) * k;
  function tick() {
    const dt = Math.min(horloge.getDelta(), 0.05), t = horloge.elapsedTime, A = reduit ? 0 : 1;
    const dh = t - debutHumeur;
    if (!glisse) { rotY += vitesse; vitesse *= 0.93; }
    const souffle = 1 + 0.028 * Math.sin(t * 2.1) * A;
    corps.scale.set(1 + (souffle - 1) * 0.4, souffle, 1 + (souffle - 1) * 0.4);
    let saut = 0, tour = 0;
    elan *= Math.pow(0.02, dt);
    if (humeur === 'parle') {
      // Rythme de parole : syllabes rapides + accent à chaque mot.
      const syllabes = Math.max(0, Math.sin(t * 13) * Math.sin(t * 5.3 + 1));
      const k = (0.5 * syllabes + 0.9 * elan) * A;
      corps.scale.set(1 + 0.03 * k, 1 + 0.06 * k, 1 + 0.03 * k);
      saut = 0.06 * k;
    }
    if (humeur === 'fete') { saut = Math.abs(Math.sin(t * 4.2)) * 0.4 * A * Math.max(0, 1 - dh / 3); tour = Math.min(1, dh / 1.2) * Math.PI * 2 * A; }
    if (humeur === 'travaille') saut = Math.abs(Math.sin(t * 9)) * 0.05 * A;
    racine.position.y = saut; racine.rotation.y = rotY + tour;
    ombre.scale.setScalar(1 - saut * 0.5);
    let rz = 0.035 * Math.sin(t * 1.3) * A, ry = 0, rx = 0;
    if (humeur === 'ecoute') rz = 0.1 * Math.sin(t * 2.4) * A;
    if (humeur === 'reflechit') { ry = 0.4 * Math.sin(t * 0.8) * A; rz = 0.06; rx = -0.05; }
    if (humeur === 'travaille') { rx = 0.08; rz = 0.03 * Math.sin(t * 9) * A; }
    if (humeur === 'parle') { rx = -0.06 - 0.05 * elan * A; rz = 0.06 * Math.sin(t * 2.7) * A; ry = 0.12 * Math.sin(t * 1.1) * A; }
    corps.rotation.z = lerp(corps.rotation.z, rz, 0.08);
    corps.rotation.y = lerp(corps.rotation.y, ry, 0.08);
    corps.rotation.x = lerp(corps.rotation.x, rx, 0.08);

    onde.visible = humeur === 'ecoute' || humeur === 'parle';
    if (onde.visible) { const k = (t * 0.8) % 1; onde.scale.setScalar(0.9 + k * 1.4); anneauMat.opacity = 0.8 * (1 - k); } else anneauMat.opacity = 0.8;
    points.visible = humeur === 'reflechit';
    if (points.visible) points.children.forEach((p, i) => { const a = t * 2.2 * (A || 0.001) + i * 2.1; p.position.set(Math.cos(a) * 0.55, 2.9 + Math.sin(t * 3 + i) * 0.06, Math.sin(a) * 0.55); });
    anneauTravail.visible = humeur === 'travaille';
    if (anneauTravail.visible) anneauTravail.rotation.z = t * 2.4 * A;
    confettis.visible = humeur === 'fete' && !reduit && dh < 3.5;
    if (confettis.visible) confettis.children.forEach((c) => { const u = c.userData; u.y -= dt * u.v; if (u.y < 0) u.y = 3.8; c.position.set(u.x + Math.sin(t + u.s) * 0.2, u.y, u.z); c.rotation.set(t * 3 + u.s, t * 2 + u.s, 0); });
    if (humeur === 'fete' && dh > 3.5) { humeur = 'repos'; container.dispatchEvent(new CustomEvent('mood', { detail: 'repos' })); }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    setMood(m) { if (m !== humeur) { humeur = m; debutHumeur = horloge.elapsedTime; } },
    setSpecies: chargerEspece,
    impulsion() { elan = Math.min(1, elan + 0.8); }
  };
}
