// Cloud Glider — a small low-poly flying game built with three.js
(() => {
  'use strict';

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ---------- Settings ----------
  const CFG = {
    startY: 45,
    startSpeed: 34,
    minSpeed: 16,
    maxSpeed: 75,
    cruiseSpeed: 34,      // above this, speed slowly settles back
    sink: 3.2,            // natural sink rate (units/s)
    climbPower: 15,
    lateral: 24,
    ceiling: 125,
    floor: 1.2,           // sea of clouds
    orbSpeed: 9,
    orbLift: 11,
    viewFar: 560,
  };

  const COLORS = {
    skyTop: new THREE.Color(0x2a2a6e),
    skyMid: new THREE.Color(0xc46b93),
    horizon: new THREE.Color(0xffb38a),
    below: new THREE.Color(0xf6b9a6),
    sun: new THREE.Color(0xfff2c8),
    fog: new THREE.Color(0xf7ad8e),
  };

  // ---------- Rendering ----------
  const canvas = $('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLORS.fog, 80, CFG.viewFar);
  scene.background = COLORS.fog;

  const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.5, 1600);

  // Warm late-afternoon lights
  scene.add(new THREE.HemisphereLight(0xffd6c4, 0x6b4f86, 0.8));
  const sunLight = new THREE.DirectionalLight(0xffc591, 0.95);
  sunLight.position.set(-0.8, 0.6, 0.25);
  scene.add(sunLight);
  const fill = new THREE.DirectionalLight(0xb7a6ff, 0.25);
  fill.position.set(0.9, 0.2, 0.6);
  scene.add(fill);

  // ---------- Sky (gradient + low sun ahead of the player) ----------
  const sunDir = new THREE.Vector3(0.15, 0.07, -1).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: COLORS.skyTop },
        mid: { value: COLORS.skyMid },
        horizon: { value: COLORS.horizon },
        below: { value: COLORS.below },
        sunColor: { value: COLORS.sun },
        sunDir: { value: sunDir },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top, mid, horizon, below, sunColor, sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col;
          if (h > 0.0) {
            col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
            col = mix(col, top, smoothstep(0.18, 0.75, h));
          } else {
            col = mix(horizon, below, smoothstep(0.0, 0.15, -h));
          }
          float s = max(dot(d, sunDir), 0.0);
          col += sunColor * (pow(s, 900.0) * 1.6 + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.18);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);

  // ---------- Low-poly geometry ----------
  // Nudge every vertex a little (shared vertices stay welded)
  function jitter(geo, amt) {
    const pos = geo.attributes.position;
    const offsets = new Map();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      let o = offsets.get(key);
      if (!o) { o = [rand(-amt, amt), rand(-amt, amt), rand(-amt, amt)]; offsets.set(key, o); }
      pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
    }
    geo.computeVertexNormals();
    return geo;
  }

  const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

  const MAT = {
    grass: [lambert(0x86b06a), lambert(0x9cbf6b), lambert(0x6fa57a)],
    rock: [lambert(0x8d6f86), lambert(0x7a6489), lambert(0x9a7a7e)],
    darkRock: lambert(0x5f4f6e),
    trunk: lambert(0x7a5546),
    leaves: [lambert(0x4f8d6b), lambert(0x6a9d5c), lambert(0xe08a8a)],
    cloud: lambert(0xffe6de),
    cloudSea: lambert(0xf8c6b6),
    skyCloud: lambert(0xfff1ea, { transparent: true, opacity: 0.85 }),
    crystal: lambert(0xffd9a0, { emissive: 0x7a3d20 }),
  };

  // ---------- Paper glider ----------
  const WING_L = new THREE.Vector3(-1.7, 0.45, 1.1);
  const WING_R = new THREE.Vector3(1.7, 0.45, 1.1);

  function makeGlider() {
    const group = new THREE.Group();
    const N = [0, 0, -2.0], L = WING_L.toArray(), R = WING_R.toArray(), T = [0, 0.02, 1.1], K = [0, -0.45, 1.1];
    const body = new THREE.BufferGeometry();
    body.setAttribute('position', new THREE.Float32BufferAttribute([
      ...N, ...T, ...L,
      ...N, ...R, ...T,
    ], 3));
    body.computeVertexNormals();
    // Sky-blue paper stands out against the pink clouds and orange sun
    group.add(new THREE.Mesh(body, lambert(0x5b8ee6, { side: THREE.DoubleSide })));

    // Indigo keel helps the glider read against the clouds
    const keel = new THREE.BufferGeometry();
    keel.setAttribute('position', new THREE.Float32BufferAttribute([
      ...N, ...K, ...T,
      ...N, ...T, ...K,
    ], 3));
    keel.computeVertexNormals();
    group.add(new THREE.Mesh(keel, lambert(0x4b3f8f, { side: THREE.DoubleSide })));

    // Small colored folds at the wingtips
    const tips = new THREE.BufferGeometry();
    tips.setAttribute('position', new THREE.Float32BufferAttribute([
      ...L, -1.7, 0.9, 1.1, -1.58, 0.43, 0.45,
      ...R, 1.58, 0.43, 0.45, 1.7, 0.9, 1.1,
    ], 3));
    tips.computeVertexNormals();
    group.add(new THREE.Mesh(tips, lambert(0xff7a6b, { side: THREE.DoubleSide })));
    group.scale.setScalar(1.25);
    return group;
  }

  const glider = makeGlider();
  scene.add(glider);

  // Wingtip trails
  function makeTrail() {
    const n = 36;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, fog: true }));
    line.frustumCulled = false;
    scene.add(line);
    return { line, n, filled: false };
  }
  const trails = [makeTrail(), makeTrail()];
  const tmpV = new THREE.Vector3();

  function updateTrail(trail, localPoint) {
    tmpV.copy(localPoint);
    glider.localToWorld(tmpV);
    const arr = trail.line.geometry.attributes.position.array;
    if (!trail.filled) {
      for (let i = 0; i < trail.n; i++) { arr[i * 3] = tmpV.x; arr[i * 3 + 1] = tmpV.y; arr[i * 3 + 2] = tmpV.z; }
      trail.filled = true;
    }
    arr.copyWithin(3, 0, (trail.n - 1) * 3);
    arr[0] = tmpV.x; arr[1] = tmpV.y; arr[2] = tmpV.z;
    trail.line.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- Player state ----------
  const player = {
    pos: new THREE.Vector3(0, CFG.startY, 0),
    speed: CFG.startSpeed,
    vy: 0,
    lift: 0,
    steer: 0,
    pitch: 0,
    startZ: 0,
    orbs: 0,
    combo: 0,
    comboTimer: 0,
    crashT: 0,
    spin: new THREE.Vector3(),
  };

  // ---------- Object fields recycled ahead of the player ----------
  function makeField({ count, width, near, far, create, place }) {
    const items = [];
    for (let i = 0; i < count; i++) items.push(create());
    const field = {
      items,
      reset(minNear = near) {
        for (const it of items) place(it, player.pos.z - rand(minNear, far), width);
      },
      update() {
        for (const it of items) {
          const o = it.obj.position;
          if (o.z > player.pos.z + 40 || Math.abs(o.x - player.pos.x) > width * 1.3) {
            place(it, player.pos.z - rand(far * 0.8, far), width);
          }
        }
      },
    };
    return field;
  }

  // Floating islands
  function createIsland() {
    const obj = new THREE.Group();
    const r = rand(9, 22);
    const depth = r * rand(1.3, 2.1);
    const sides = pick([6, 7, 8]);

    const top = new THREE.Mesh(jitter(new THREE.CylinderGeometry(r, r * 0.92, 2.4, sides, 1), 0.6), pick(MAT.grass));
    obj.add(top);
    const under = new THREE.Mesh(jitter(new THREE.ConeGeometry(r * 0.93, depth, sides, 3), r * 0.08), pick(MAT.rock));
    under.rotation.x = Math.PI;
    under.position.y = -1.2 - depth / 2;
    obj.add(under);

    // Small rocks hanging under the island
    for (let i = 0; i < 3; i++) {
      const s = rand(0.8, 2.2);
      const m = new THREE.Mesh(jitter(new THREE.DodecahedronGeometry(s, 0), s * 0.2), MAT.darkRock);
      const a = rand(0, Math.PI * 2);
      m.position.set(Math.cos(a) * r * 0.9, -depth * rand(0.4, 0.8), Math.sin(a) * r * 0.9);
      obj.add(m);
    }

    // Trees
    const trees = Math.floor(rand(1, 6));
    for (let i = 0; i < trees; i++) {
      const tree = new THREE.Group();
      const h = rand(3, 6.5);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, h * 0.4, 5), MAT.trunk);
      trunk.position.y = h * 0.2;
      tree.add(trunk);
      const leaves = new THREE.Mesh(jitter(new THREE.ConeGeometry(h * 0.32, h * 0.8, 6), 0.2), pick(MAT.leaves));
      leaves.position.y = h * 0.4 + h * 0.4;
      tree.add(leaves);
      const a = rand(0, Math.PI * 2), d = rand(0, r * 0.75);
      tree.position.set(Math.cos(a) * d, 1.2, Math.sin(a) * d);
      obj.add(tree);
    }

    // Sometimes a glowing crystal
    if (Math.random() < 0.35) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(1.4, 0), MAT.crystal);
      c.scale.y = 2;
      c.position.set(rand(-r, r) * 0.4, 3.5, rand(-r, r) * 0.4);
      obj.add(c);
    }

    obj.rotation.y = rand(0, Math.PI * 2);
    scene.add(obj);
    return { obj, r, depth, bob: rand(0, Math.PI * 2), baseY: 0 };
  }
  function placeIsland(it, z, width) {
    it.baseY = rand(6, 80);
    it.obj.position.set(player.pos.x + rand(-width, width), it.baseY, z);
  }

  // Floating rocks (deadly)
  const rockGeos = [0, 1, 2, 3].map(() => jitter(new THREE.DodecahedronGeometry(1, 0), 0.22));
  function createRock() {
    const s = rand(1.6, 4.2);
    const obj = new THREE.Mesh(pick(rockGeos), pick([MAT.darkRock, ...MAT.rock]));
    obj.scale.setScalar(s);
    scene.add(obj);
    return { obj, r: s * 0.95, spin: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.6) };
  }
  function placeRock(it, z, width) {
    it.obj.position.set(player.pos.x + rand(-width, width), clamp(player.pos.y + rand(-22, 22), 4, 115), z);
  }

  // Decorative clouds
  const puffGeos = [0, 1, 2].map(() => jitter(new THREE.IcosahedronGeometry(1, 1), 0.12));
  function makePuffCluster(mat, n, spread) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(pick(puffGeos), mat);
      const s = rand(0.5, 1);
      m.scale.set(s * rand(1, 1.6), s * rand(0.6, 0.9), s);
      m.position.set(rand(-spread, spread), rand(-0.2, 0.3) * spread * 0.4, rand(-spread, spread) * 0.6);
      g.add(m);
    }
    return g;
  }

  function createSeaCloud() {
    const obj = makePuffCluster(MAT.cloud, 4, 1.2);
    obj.scale.setScalar(rand(14, 30));
    scene.add(obj);
    return { obj };
  }
  function placeSeaCloud(it, z, width) {
    it.obj.position.set(player.pos.x + rand(-width, width), rand(-7, -1), z);
  }

  function createSkyCloud() {
    const obj = makePuffCluster(MAT.skyCloud, 5, 1.4);
    obj.scale.setScalar(rand(5, 12));
    scene.add(obj);
    return { obj };
  }
  function placeSkyCloud(it, z, width) {
    it.obj.position.set(player.pos.x + rand(-width, width), rand(25, 140), z);
  }

  // Storms: dark clouds with lightning
  function createStorm() {
    const mat = lambert(0x4a4568, { emissive: 0x000000, transparent: true, opacity: 0.92 });
    const r = rand(16, 26);
    const obj = makePuffCluster(mat, 9, 1.1);
    obj.scale.setScalar(r * 0.8);

    // Lightning: a zigzag line
    const pts = [];
    let x = 0, y = 0;
    for (let i = 0; i < 8; i++) { pts.push(new THREE.Vector3(x, y, 0)); x += rand(-0.25, 0.25); y -= 0.28; }
    const bolt = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xfff6c0, fog: false })
    );
    bolt.visible = false;
    obj.add(bolt);

    scene.add(obj);
    return { obj, r, mat, bolt, flash: 0, timer: rand(0.5, 3) };
  }
  function placeStorm(it, z, width) {
    it.obj.position.set(player.pos.x + rand(-width, width), clamp(player.pos.y + rand(-10, 10), 14, 100), z);
  }

  // Glowing orbs, in short trails
  function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,240,1)');
    g.addColorStop(0.22, 'rgba(255,230,160,0.85)');
    g.addColorStop(0.55, 'rgba(255,190,110,0.25)');
    g.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  const glowTex = glowTexture();
  const orbGeo = new THREE.IcosahedronGeometry(0.6, 0);
  const orbMat = new THREE.MeshBasicMaterial({ color: 0xfff3b8 });

  const ORBS_PER_GROUP = 6;
  function createOrbGroup() {
    const orbs = [];
    const obj = new THREE.Group(); // anchor used for recycling
    scene.add(obj);
    for (let i = 0; i < ORBS_PER_GROUP; i++) {
      const core = new THREE.Mesh(orbGeo, orbMat);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }));
      halo.scale.setScalar(4.2);
      core.add(halo);
      scene.add(core);
      orbs.push({ core, halo, taken: false, pop: 0 });
    }
    return { obj, orbs };
  }
  function placeOrbGroup(it, z, width) {
    const x0 = player.pos.x + rand(-width, width);
    const y0 = clamp(player.pos.y + rand(-16, 12), 8, 110);
    const pattern = pick(['line', 'wave', 'climb', 'curve']);
    const side = rand(-1, 1);
    it.orbs.forEach((o, i) => {
      let dx = 0, dy = 0;
      if (pattern === 'wave') dy = Math.sin(i * 0.9) * 3;
      if (pattern === 'climb') dy = i * 1.6;
      if (pattern === 'curve') dx = side * i * i * 0.5;
      o.core.position.set(x0 + dx, y0 + dy, z - i * 7);
      o.core.visible = true;
      o.halo.scale.setScalar(4.2);
      o.halo.material.opacity = 1;
      o.taken = false;
      o.pop = 0;
    });
    // the anchor follows the group's last orb
    it.obj.position.copy(it.orbs[ORBS_PER_GROUP - 1].core.position);
  }

  const fields = {
    islands: makeField({ count: 20, width: 220, near: 40, far: CFG.viewFar, create: createIsland, place: placeIsland }),
    rocks: makeField({ count: 38, width: 110, near: 120, far: CFG.viewFar * 0.9, create: createRock, place: placeRock }),
    storms: makeField({ count: 4, width: 150, near: 220, far: CFG.viewFar, create: createStorm, place: placeStorm }),
    orbs: makeField({ count: 12, width: 60, near: 50, far: CFG.viewFar * 0.8, create: createOrbGroup, place: placeOrbGroup }),
    sea: makeField({ count: 70, width: 380, near: 0, far: CFG.viewFar, create: createSeaCloud, place: placeSeaCloud }),
    sky: makeField({ count: 26, width: 320, near: 30, far: CFG.viewFar, create: createSkyCloud, place: placeSkyCloud }),
  };

  // Continuous sea of clouds beneath everything
  const seaPlane = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), MAT.cloudSea);
  seaPlane.rotation.x = -Math.PI / 2;
  seaPlane.position.y = -5;
  scene.add(seaPlane);

  // Shared lightning light
  const boltLight = new THREE.PointLight(0xd9d2ff, 0, 160);
  scene.add(boltLight);

  // ---------- Input ----------
  const input = { mx: 0, my: 0, mouse: false, keys: new Set() };
  const KEYS = {
    left: ['ArrowLeft', 'KeyA', 'KeyQ'],
    right: ['ArrowRight', 'KeyD'],
    up: ['ArrowUp', 'KeyW', 'KeyZ'],
    down: ['ArrowDown', 'KeyS'],
  };
  const held = (list) => list.some((k) => input.keys.has(k));

  window.addEventListener('pointermove', (e) => {
    input.mx = (e.clientX / window.innerWidth) * 2 - 1;
    input.my = (e.clientY / window.innerHeight) * 2 - 1;
    input.mouse = true;
  });
  window.addEventListener('pointerdown', (e) => {
    input.mx = (e.clientX / window.innerWidth) * 2 - 1;
    input.my = (e.clientY / window.innerHeight) * 2 - 1;
    input.mouse = true;
  });
  window.addEventListener('keydown', (e) => {
    if (Object.values(KEYS).some((l) => l.includes(e.code))) { input.mouse = false; e.preventDefault(); }
    input.keys.add(e.code);
    if (e.code === 'Space' || e.code === 'Enter') {
      if (state === 'menu' || state === 'over') { e.preventDefault(); startGame(); }
    }
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => { input.keys.clear(); if (state === 'play') togglePause(); });

  function readControls() {
    let steer = 0, pitch = 0;
    const kx = (held(KEYS.right) ? 1 : 0) - (held(KEYS.left) ? 1 : 0);
    const ky = (held(KEYS.up) ? 1 : 0) - (held(KEYS.down) ? 1 : 0);
    if (kx || ky || !input.mouse) {
      steer = kx; pitch = ky;
    } else {
      const dz = (v) => (Math.abs(v) < 0.06 ? 0 : v);
      steer = clamp(dz(input.mx) * 1.5, -1, 1);
      pitch = clamp(-dz(input.my) * 1.6, -1, 1);
    }
    return { steer, pitch };
  }

  // ---------- Interface ----------
  const ui = {
    hud: $('hud'), menu: $('menu'), over: $('over'), pause: $('pause'),
    score: $('score'), orbs: $('orbs'), dist: $('dist'), alt: $('alt'), speed: $('speed'),
    gauge: $('gauge-fill'), warning: $('warning'), toast: $('toast'), vignette: $('vignette'),
    reason: $('reason'), finalScore: $('final-score'), finalOrbs: $('final-orbs'), finalDist: $('final-dist'),
    newRecord: $('new-record'), bestMenu: $('best-menu'), bestOver: $('best-over'),
  };

  let best = 0;
  try { best = Number(localStorage.getItem('cloud-glider-best')) || 0; } catch (e) { /* storage unavailable */ }
  ui.bestMenu.textContent = best;

  $('start').addEventListener('click', startGame);
  $('restart').addEventListener('click', startGame);
  $('resume').addEventListener('click', togglePause);

  const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} k` : `${Math.floor(m)}`);
  const distance = () => Math.max(0, player.startZ - player.pos.z);
  const score = () => Math.floor(distance() / 10) + player.orbs * 10;

  function showToast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.remove('show');
    void ui.toast.offsetWidth; // restart the animation
    ui.toast.classList.add('show');
  }

  // ---------- Game flow ----------
  let state = 'menu';

  function resetWorld(safe) {
    player.pos.set(0, CFG.startY, 0);
    player.startZ = 0;
    player.speed = CFG.startSpeed;
    player.vy = 0;
    player.lift = 0;
    player.steer = 0;
    player.pitch = 0;
    player.orbs = 0;
    player.combo = 0;
    glider.rotation.set(0, 0, 0);
    glider.position.copy(player.pos);
    trails.forEach((t) => { t.filled = false; });
    for (const [name, f] of Object.entries(fields)) {
      // no hazards right in front of the nose at start
      f.reset(safe && (name === 'rocks' || name === 'storms' || name === 'islands') ? 140 : undefined);
    }
  }

  function startGame() {
    resetWorld(true);
    state = 'play';
    ui.menu.hidden = true;
    ui.over.hidden = true;
    ui.pause.hidden = true;
    ui.hud.hidden = false;
    canvas.focus?.();
  }

  function togglePause() {
    if (state === 'play') { state = 'paused'; ui.pause.hidden = false; }
    else if (state === 'paused') { state = 'play'; ui.pause.hidden = true; last = performance.now(); }
  }

  function crash(reason) {
    if (state !== 'play') return;
    state = 'crashing';
    player.crashT = 1.3;
    player.spin.set(rand(-4, 4), rand(-3, 3), rand(6, 10));
    ui.reason.textContent = reason;
    ui.warning.hidden = true;
  }

  function endGame() {
    state = 'over';
    const s = score();
    const isRecord = s > best;
    if (isRecord) {
      best = s;
      try { localStorage.setItem('cloud-glider-best', String(best)); } catch (e) { /* ignore */ }
    }
    ui.finalScore.textContent = s;
    ui.finalOrbs.textContent = player.orbs;
    ui.finalDist.textContent = `${fmtDist(distance())}m`;
    ui.newRecord.hidden = !isRecord;
    ui.bestOver.textContent = best;
    ui.bestMenu.textContent = best;
    ui.hud.hidden = true;
    ui.over.hidden = false;
    ui.vignette.style.opacity = 0;
  }

  // ---------- Main loop ----------
  let last = performance.now();
  let time = 0;
  let shake = 0;

  function updatePlayer(dt) {
    const p = player;
    let storm = 0;

    if (state === 'play') {
      const c = readControls();
      p.steer = damp(p.steer, c.steer, 4, dt);
      p.pitch = damp(p.pitch, c.pitch, 3.5, dt);

      // Storms drag you down and shake you around
      for (const s of fields.storms.items) {
        const d = s.obj.position.distanceTo(p.pos);
        if (d < s.r) storm = Math.max(storm, 1 - d / s.r);
      }

      const climbAbility = clamp((p.speed - 10) / 22, 0.25, 1);
      const pitchPower = p.pitch > 0 ? p.pitch * CFG.climbPower * climbAbility : p.pitch * CFG.climbPower * 1.2;
      let targetVy = pitchPower - CFG.sink + p.lift - storm * 16;
      if (p.pos.y > CFG.ceiling) targetVy -= (p.pos.y - CFG.ceiling) * 0.8;
      p.vy = damp(p.vy, targetVy, 3, dt);
      p.lift = Math.max(0, p.lift - 5 * dt);

      // Energy: diving speeds you up, climbing slows you down
      if (p.vy > 0) p.speed -= p.vy * 0.32 * dt;
      else p.speed += -p.vy * 0.55 * dt;
      if (p.speed > CFG.cruiseSpeed) p.speed -= (p.speed - CFG.cruiseSpeed) * 0.12 * dt;
      p.speed -= storm * 8 * dt;
      p.speed = clamp(p.speed + 0.15 * dt, CFG.minSpeed, CFG.maxSpeed);

      const turb = storm ? rand(-1, 1) * storm * 12 : 0;
      p.pos.x += (p.steer * CFG.lateral + turb) * dt;
      p.pos.y += p.vy * dt;
      p.pos.z -= p.speed * dt;

      shake = Math.max(shake * 0.9, storm * 0.5);
      ui.warning.hidden = storm <= 0.05;

      if (p.comboTimer > 0) { p.comboTimer -= dt; if (p.comboTimer <= 0) p.combo = 0; }
    } else if (state === 'menu' || state === 'paused') {
      // Gentle autopilot for the title screen
      if (state === 'menu') {
        p.steer = Math.sin(time * 0.35) * 0.35;
        p.pitch = Math.sin(time * 0.5) * 0.2;
        p.pos.x += p.steer * 10 * dt;
        p.pos.y = damp(p.pos.y, CFG.startY + Math.sin(time * 0.4) * 6, 1, dt);
        p.vy = Math.cos(time * 0.4) * 2.4;
        p.pos.z -= 26 * dt;
      }
    } else if (state === 'crashing') {
      p.crashT -= dt;
      p.vy -= 25 * dt;
      p.pos.y += p.vy * dt;
      p.pos.z -= p.speed * 0.3 * dt;
      glider.rotation.x += p.spin.x * dt;
      glider.rotation.y += p.spin.y * dt;
      glider.rotation.z += p.spin.z * dt;
      if (p.crashT <= 0) endGame();
    }

    if (state !== 'crashing' && state !== 'over') {
      glider.rotation.order = 'YXZ';
      glider.rotation.y = damp(glider.rotation.y, -p.steer * 0.35, 5, dt);
      glider.rotation.z = damp(glider.rotation.z, -p.steer * 0.75, 5, dt);
      glider.rotation.x = damp(glider.rotation.x, clamp(p.vy * 0.04, -0.6, 0.5), 5, dt);
    }
    glider.position.copy(p.pos);
    return storm;
  }

  function checkCollisions() {
    const p = player.pos;
    if (p.y < CFG.floor) return crash('You sank into the sea of clouds.');

    for (const r of fields.rocks.items) {
      if (r.obj.position.distanceToSquared(p) < (r.r + 0.8) ** 2) return crash('You hit a rock.');
    }
    for (const isl of fields.islands.items) {
      const o = isl.obj.position;
      const dx = p.x - o.x, dz = p.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d < isl.r * 0.95) {
        const top = o.y + 1.8;
        const bottom = o.y - 1.2 - isl.depth * (1 - d / isl.r);
        if (p.y < top && p.y > bottom) return crash('You crashed into a floating island.');
      }
    }
    for (const g of fields.orbs.items) {
      for (const orb of g.orbs) {
        if (orb.taken) continue;
        if (orb.core.position.distanceToSquared(p) < 3.4 * 3.4) {
          orb.taken = true;
          orb.pop = 0.35;
          player.orbs++;
          player.speed = Math.min(CFG.maxSpeed, player.speed + CFG.orbSpeed);
          player.lift = Math.min(22, player.lift + CFG.orbLift);
          player.combo = player.comboTimer > 0 ? player.combo + 1 : 1;
          player.comboTimer = 1.6;
          showToast(player.combo > 1 ? `+1  ×${player.combo}` : '+1');
        }
      }
    }
  }

  function updateWorld(dt) {
    for (const f of Object.values(fields)) f.update();

    for (const isl of fields.islands.items) {
      isl.obj.position.y = isl.baseY + Math.sin(time * 0.6 + isl.bob) * 0.8;
    }
    for (const r of fields.rocks.items) {
      r.obj.rotation.x += r.spin.x * dt;
      r.obj.rotation.y += r.spin.y * dt;
    }
    for (const g of fields.orbs.items) {
      for (const orb of g.orbs) {
        orb.core.rotation.y += dt * 2;
        orb.core.rotation.x += dt;
        if (orb.pop > 0) {
          orb.pop -= dt;
          const k = 1 - orb.pop / 0.35;
          orb.halo.scale.setScalar(4.2 + k * 14);
          orb.halo.material.opacity = 1 - k;
          if (orb.pop <= 0) orb.core.visible = false;
        }
      }
    }

    // Lightning
    let brightest = null;
    for (const s of fields.storms.items) {
      s.timer -= dt;
      if (s.timer <= 0) {
        s.flash = 1;
        s.timer = rand(0.8, 3.2);
        s.bolt.position.set(rand(-0.6, 0.6), -0.1, rand(-0.3, 0.3));
        s.bolt.rotation.y = rand(0, Math.PI);
      }
      s.flash = Math.max(0, s.flash - dt * 4);
      s.mat.emissive.setRGB(0.55 * s.flash, 0.5 * s.flash, 0.75 * s.flash);
      s.bolt.visible = s.flash > 0.55;
      if (!brightest || s.flash > brightest.flash) brightest = s;
    }
    if (brightest && brightest.flash > 0) {
      boltLight.position.copy(brightest.obj.position);
      boltLight.intensity = brightest.flash * 3;
    } else {
      boltLight.intensity = 0;
    }

    seaPlane.position.x = player.pos.x;
    seaPlane.position.z = player.pos.z;
  }

  const camTarget = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  camera.position.set(0, CFG.startY + 3, 10);

  function updateCamera(dt) {
    const p = player.pos;
    const back = state === 'crashing' ? 14 : 8.5 + (player.speed - 30) * 0.03;
    camTarget.set(p.x - player.steer * 1.5, p.y + 4.2, p.z + back);
    camera.position.x = damp(camera.position.x, camTarget.x, 5, dt);
    camera.position.y = damp(camera.position.y, camTarget.y, 4, dt);
    camera.position.z = damp(camera.position.z, camTarget.z, 8, dt);
    if (shake > 0.01) {
      camera.position.x += rand(-1, 1) * shake;
      camera.position.y += rand(-1, 1) * shake;
    }
    lookTarget.set(p.x, p.y + 2.2, p.z - 14);
    camera.lookAt(lookTarget);
    camera.rotation.z += -player.steer * 0.06;

    const fov = 62 + clamp((player.speed - 30) * 0.4, -4, 16);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = damp(camera.fov, fov, 3, dt);
      camera.updateProjectionMatrix();
    }
    sky.position.copy(camera.position);
  }

  function updateHud(storm) {
    if (state !== 'play') return;
    const altM = Math.max(0, Math.round(player.pos.y * 10));
    ui.score.textContent = score();
    ui.orbs.textContent = player.orbs;
    ui.dist.textContent = fmtDist(distance());
    ui.alt.textContent = altM;
    ui.speed.textContent = Math.round(player.speed * 3.6);
    ui.gauge.style.height = `${clamp(player.pos.y / CFG.ceiling, 0, 1) * 100}%`;
    const low = clamp((14 - player.pos.y) / 12, 0, 1);
    ui.vignette.style.opacity = Math.max(low, storm * 0.8).toFixed(2);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (state !== 'paused') {
      time += dt;
      const storm = updatePlayer(dt);
      if (state === 'play') checkCollisions();
      updateWorld(dt);
      updateCamera(dt);
      updateTrail(trails[0], WING_L);
      updateTrail(trails[1], WING_R);
      updateHud(storm);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  resetWorld(true);
  requestAnimationFrame(frame);
})();
