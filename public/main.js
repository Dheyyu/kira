import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { initUI, renderState, esc } from './ui.js';

// ---- scene setup -----------------------------------------------------------

const container = document.getElementById('scene');
const overlay = document.getElementById('overlay');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0f1a);
scene.fog = new THREE.Fog(0x0f0f1a, 30, 60);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
camera.position.set(0, 16, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
container.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.45;
controls.minDistance = 8;
controls.maxDistance = 45;

function resize() {
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);
resize();

const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x1a1a2a }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(60, 30, 0x2c2c44, 0x22223a);
grid.position.y = 0.01;
scene.add(grid);

scene.add(new THREE.HemisphereLight(0x8080c0, 0x202030, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(10, 20, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 });
scene.add(sun);

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, ...extra });
const shadowed = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

// ---- stations --------------------------------------------------------------

const desks = {}; // stationId -> { screen, pos }
let lab = null;

function buildDesk(st) {
  const [x, z] = st.pos;
  const color = new THREE.Color(st.color);
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  const top = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.5), mat(0x3a3a4e)));
  top.position.y = 0.85;
  g.add(top);
  for (const sx of [-1.45, 1.45]) {
    const leg = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 1.3), mat(0x2a2a38)));
    leg.position.set(sx, 0.42, 0);
    g.add(leg);
  }
  const monitor = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.85, 0.08), mat(0x111118)));
  monitor.position.set(0, 1.45, -0.35);
  g.add(monitor);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.28, 0.74),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 0.15 }),
  );
  screen.position.set(0, 1.45, -0.305);
  g.add(screen);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.12), mat(0x111118));
  stand.position.set(0, 1.05, -0.35);
  g.add(stand);
  // a stripe on the floor in the station color
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(5, 4.5), mat(color, { transparent: true, opacity: 0.08 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.02, 1.2);
  g.add(rug);

  scene.add(g);
  desks[st.id] = { screen, pos: new THREE.Vector3(x, 0, z) };
}

function buildLab(st) {
  const [x, z] = st.pos;
  const color = new THREE.Color(st.color);
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  const platform = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.18, 48), mat(0x2a1440)));
  platform.position.y = 0.09;
  g.add(platform);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.05, 8, 64), mat(color, { emissive: color, emissiveIntensity: 0.6 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.19;
  g.add(rim);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 1), mat(color, { emissive: color, emissiveIntensity: 0.5, flatShading: true }));
  core.position.y = 2;
  g.add(core);
  const pedestal = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.1, 16), mat(0x3a2050)));
  pedestal.position.y = 0.73;
  g.add(pedestal);
  const rings = [0, 1].map((i) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(1.1 + i * 0.35, 0.025, 8, 64), mat(color, { emissive: color, emissiveIntensity: 0.8, transparent: true, opacity: 0.7 }));
    r.position.y = 2;
    g.add(r);
    return r;
  });
  const light = new THREE.PointLight(color, 0, 10);
  light.position.y = 2.5;
  g.add(light);

  scene.add(g);
  lab = { core, rings, light, pos: new THREE.Vector3(x, 0, z), activity: 0 };
}

// ---- agents ----------------------------------------------------------------

const agents = {}; // id -> view

function buildAgent(a) {
  const color = new THREE.Color(a.color);
  const g = new THREE.Group();
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.36), mat(color)));
  body.position.y = 1.0;
  g.add(body);
  const head = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 16), mat(0xffd2b0)));
  head.position.y = 1.65;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.05), mat(0x111122, { emissive: color, emissiveIntensity: 0.9 }));
  visor.position.set(0, 1.68, 0.25); // front is +z
  g.add(visor);

  const limb = (w, h, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat(color.clone().multiplyScalar(0.7))));
    m.position.y = -h / 2;
    pivot.add(m);
    g.add(pivot);
    return pivot;
  };
  const legs = [limb(0.2, 0.62, -0.15, 0.62), limb(0.2, 0.62, 0.15, 0.62)];
  const arms = [limb(0.14, 0.6, -0.4, 1.33), limb(0.14, 0.6, 0.4, 1.33)];

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);

  g.position.set(a.x, 0, a.z);
  g.rotation.y = a.rot;
  scene.add(g);

  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.style.setProperty('--c', a.color);
  overlay.appendChild(tag);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.style.setProperty('--c', a.color);
  overlay.appendChild(bubble);

  return { group: g, head, legs, arms, ring, tag, bubble, data: a, phase: Math.random() * 10, bubbleKey: '' };
}

function syncAgents(list) {
  for (const a of list) {
    (agents[a.id] ||= buildAgent(a)).data = a;
  }
}

const STATE_ICON = { working: '⌨️', walking: '🚶', observing: '👀', training: '📚', idle: '☕' };

function renderBubble(v) {
  const a = v.data;
  const away = a.state !== 'working' && a.state !== 'idle';
  let body;
  if (a.current) {
    const badge = a.current.provider ? `<span class="badge ${a.current.provider}">${esc(a.current.model || '')}</span>` : '';
    body =
      `<div class="b-task">${esc(a.current.text.slice(0, 110))}${a.current.text.length > 110 ? '…' : ''}</div>` +
      `<div style="margin-top:4px">${badge}</div>` +
      `<div class="b-out">${esc(a.current.tail || 'Thinking…')}<span class="cursor">▋</span></div>`;
  } else {
    body = `<div class="b-task">${esc(a.activity)}</div>`;
  }
  if (a.queue) body += `<div class="b-q">${a.queue} task${a.queue > 1 ? 's' : ''} queued</div>`;
  const html =
    `<div class="b-head"><span>${STATE_ICON[a.state] || ''}</span>${esc(a.name)}<span class="lvl">Lv ${a.level}</span></div>` + body;
  if (html !== v.bubbleKey) {
    v.bubble.innerHTML = html;
    v.bubbleKey = html;
    const out = v.bubble.querySelector('.b-out');
    if (out) out.scrollTop = out.scrollHeight;
  }
  v.bubble.classList.toggle('away', away);
  const tagText = `${a.name} · ${a.state}`;
  if (v.tag.textContent !== tagText) v.tag.textContent = tagText;
}

// ---- projection helpers ----------------------------------------------------

const tmp = new THREE.Vector3();
function place(el, worldPos) {
  tmp.copy(worldPos).project(camera);
  if (tmp.z > 1) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.style.left = `${((tmp.x + 1) / 2) * container.clientWidth}px`;
  el.style.top = `${((1 - tmp.y) / 2) * container.clientHeight}px`;
}

// ---- animation -------------------------------------------------------------

const clock = new THREE.Clock();
const shortestAngle = (from, to) => ((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  const k = 1 - Math.exp(-dt * 8);
  let training = 0;

  for (const v of Object.values(agents)) {
    const a = v.data;
    const g = v.group;
    const moving = a.state === 'walking';
    g.position.x += (a.x - g.position.x) * k;
    g.position.z += (a.z - g.position.z) * k;
    g.rotation.y += shortestAngle(g.rotation.y, a.rot) * k;

    const p = t * 9 + v.phase;
    const swing = moving ? Math.sin(p) * 0.6 : 0;
    v.legs[0].rotation.x += (swing - v.legs[0].rotation.x) * 0.3;
    v.legs[1].rotation.x += (-swing - v.legs[1].rotation.x) * 0.3;
    let armL = -swing, armR = swing;
    if (a.state === 'working') { armL = -0.9 + Math.sin(t * 18 + v.phase) * 0.12; armR = -0.9 + Math.cos(t * 17 + v.phase) * 0.12; }
    if (a.state === 'training') { armL = armR = -2.6 + Math.sin(t * 3 + v.phase) * 0.2; }
    v.arms[0].rotation.x += (armL - v.arms[0].rotation.x) * 0.25;
    v.arms[1].rotation.x += (armR - v.arms[1].rotation.x) * 0.25;
    g.position.y = moving ? Math.abs(Math.sin(p)) * 0.06 : Math.sin(t * 1.6 + v.phase) * 0.02;
    v.head.rotation.y = a.state === 'observing' ? Math.sin(t * 0.8 + v.phase) * 0.5 : 0;
    v.ring.material.opacity = a.state === 'working' ? 0.5 + Math.sin(t * 6) * 0.3 : 0.35;

    const desk = desks[a.desk];
    if (desk) {
      const target = a.state === 'working' ? 1.1 + Math.sin(t * 10) * 0.15 : 0.15;
      desk.screen.material.emissiveIntensity += (target - desk.screen.material.emissiveIntensity) * 0.1;
      place(v.bubble, tmp.set(desk.pos.x, 2.6, desk.pos.z));
    }
    place(v.tag, tmp.set(g.position.x, 2.25, g.position.z));
    if (a.state === 'training') training++;
  }

  if (lab) {
    lab.activity += ((training ? 1 : 0) - lab.activity) * 0.05;
    const speed = 0.4 + lab.activity * 2.5;
    lab.core.rotation.y += dt * speed;
    lab.core.rotation.x += dt * speed * 0.4;
    lab.core.position.y = 2 + Math.sin(t * 2) * 0.12;
    lab.rings[0].rotation.x = t * speed * 0.7;
    lab.rings[1].rotation.y = t * speed * 0.5;
    lab.rings[1].rotation.x = Math.PI / 3;
    lab.light.intensity = lab.activity * 18;
  }

  controls.update();
  renderer.render(scene, camera);
}

// ---- live data -------------------------------------------------------------

let built = false;
function onState(state) {
  if (!built) {
    for (const st of state.stations) (st.kind === 'lab' ? buildLab : buildDesk)(st);
    built = true;
  }
  syncAgents(state.agents);
  renderState(state);
  for (const v of Object.values(agents)) renderBubble(v);
}

function connect() {
  const conn = document.getElementById('conn');
  const es = new EventSource('/api/events');
  es.addEventListener('open', () => { conn.textContent = 'live'; conn.classList.add('ok'); });
  es.addEventListener('error', () => { conn.textContent = 'reconnecting…'; conn.classList.remove('ok'); });
  es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  es.addEventListener('tick', (e) => {
    syncAgents(JSON.parse(e.data));
    for (const v of Object.values(agents)) renderBubble(v);
  });
}

initUI();
connect();
animate();
