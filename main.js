// KIRA - Knowledge Integrated Responsive Agents

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222233);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 15);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Floor
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0x444455 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// Lights
const light = new THREE.DirectionalLight(0xffffff, 1.2);
light.position.set(10, 15, 10);
scene.add(light);
scene.add(new THREE.AmbientLight(0x666666));

// Stations + agents
const stations = [
  { name: "Scout", pos: [-8, 0, -6], color: 0x44ff44 },
  { name: "Builder", pos: [0, 0, -6], color: 0x4488ff },
  { name: "Outreach", pos: [8, 0, -6], color: 0xff8844 },
  { name: "Skills Lab", pos: [0, 0, 6], color: 0xff44ff },
];

stations.forEach(s => {
  // Desk
  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.6, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x777788 })
  );
  desk.position.set(s.pos[0], 0.3, s.pos[2]);
  scene.add(desk);

  // Agent
  const agent = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.4, 0.5),
    new THREE.MeshStandardMaterial({ color: s.color })
  );
  agent.position.set(s.pos[0], 1.1, s.pos[2] + 1.5);
  scene.add(agent);
});

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});