/* قطار الساحل 🌊 — endless coastal runner (Three.js) */
import * as THREE from 'three';

/* ============ 1) Config & helpers ============ */
const LANES = [-2.3, 0, 2.3];
const GRAV = 36, JUMP_V = 12.6; // snappier arc: ~2.2m apex, ~0.7s air time
const LANE_LERP = 13, COYOTE_T = 0.1, JBUF_T = 0.15; // responsive lane / coyote / jump-buffer
const TRAIN_TOP = 2.75;
const SAVE_KEY = 'coastal_best_v1';
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

const store = {
  get best() { try { return +localStorage.getItem(SAVE_KEY) || 0; } catch { return 0; } },
  set best(v) { try { localStorage.setItem(SAVE_KEY, v); } catch {} }
};

/* ============ 2) Audio (procedural WebAudio) ============ */
window.AudioSys = {
  ctx: null, muted: false, master: null, waveGain: null, musicTimer: null, step: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ctx.destination);
      this.startAmbience(); this.startMusic();
    } catch {}
  },
  toggle() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.55; return this.muted; },
  tone(freq, dur, type = 'sine', vol = 0.25, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, vol = 0.3, filterFreq = 1200, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay, n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  },
  coin() { this.tone(988, 0.09, 'square', 0.12); this.tone(1319, 0.16, 'square', 0.12, null, 0.07); },
  jump() { this.noise(0.18, 0.12, 2500); this.tone(300, 0.2, 'sine', 0.14, 700); },
  slideSfx() { this.noise(0.28, 0.16, 800); },
  crash() { this.noise(0.7, 0.5, 500); this.tone(160, 0.6, 'sawtooth', 0.3, 40); },
  horn() { this.tone(233, 0.7, 'sawtooth', 0.22); this.tone(175, 0.7, 'sawtooth', 0.22); },
  power() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.18, null, i * 0.08)); },
  thunder() { this.noise(1.6, 0.4, 220); },
  click() { this.tone(600, 0.06, 'square', 0.1); },
  startAmbience() {
    const ctx = this.ctx, len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let v = 0; for (let i = 0; i < len; i++) { v = v * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = v * 8 * (0.6 + 0.4 * Math.sin(i / len * Math.PI * 4)); }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    this.waveGain = ctx.createGain(); this.waveGain.gain.value = 0.05;
    src.connect(f); f.connect(this.waveGain); this.waveGain.connect(this.master); src.start();
  },
  startMusic() {
    const bass = [110, 110, 130.8, 98, 110, 146.8, 130.8, 98];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted || G.state !== 'play') return;
      const n = bass[this.step % bass.length];
      this.tone(n, 0.22, 'triangle', 0.1); this.tone(n * 2, 0.11, 'sine', 0.05);
      if (this.step % 2 === 0) this.noise(0.04, 0.05, 6000);
      this.step++;
    }, 300);
  }
};

/* ============ 3) Renderer / scene / camera ============ */
window.G = { state: 'menu', speed: 0, dist: 0, coins: 0, score: 0, mult: 1, t: 0, pz: 0, stumble: 0, stumbleT: 0, shake: 0, slowMo: 1 };
window.P = { lane: 1, x: 0, y: 0, vy: 0, grounded: true, sliding: false, slideT: 0, roof: false, dead: false, deathT: 0, coyote: 0, jbuf: 0, landT: 0, onRamp: false, mesh: null, parts: {} };

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fd4ef, 55, 300);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1500);
let renderer = null, WEBGL_OK = true, RENDER_SCALE = 1;
const IS_MOBILE = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || innerWidth < 700;
try {
  renderer = new THREE.WebGLRenderer({ antialias: !IS_MOBILE, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, IS_MOBILE ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (THREE.SRGBColorSpace !== undefined && 'outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (THREE.ACESFilmicToneMapping !== undefined && 'toneMapping' in renderer) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; }
} catch (e) {
  // no GL (very old device / blocked context): menus/HUD/audio still work,
  // 3D appears once a context is available
  WEBGL_OK = false;
  renderer = {
    domElement: document.createElement('div'),
    setSize() {}, setPixelRatio() {}, setClearColor() {}, render() {},
    shadowMap: {}
  };
  const fb = document.createElement('div');
  fb.id = 'nogl';
  fb.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(180deg,#12395c,#0a1f36);font-weight:900;font-size:18px;text-align:center;padding:20px;z-index:1';
  fb.innerHTML = '🌊 جهازك لا يدعم WebGL<br><span style="font-size:14px;opacity:.8">فعّل تسريع الرسوميات في المتصفح لعرض عالم الساحل ثلاثي الأبعاد</span>';
  $('game').appendChild(fb);
}
$('game').appendChild(renderer.domElement);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a5f4a, 1.0); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_MOBILE ? 512 : 1024, IS_MOBILE ? 512 : 1024);
sun.shadow.camera.left = -25; sun.shadow.camera.right = 25;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 160;
scene.add(sun); scene.add(sun.target);
const rim = new THREE.DirectionalLight(0x9adcff, 0.5); // cool bounce off the sea
rim.position.set(-30, 14, -40); scene.add(rim);

/* sky dome (gradient shader) */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x2f7fd0) }, bottom: { value: new THREE.Color(0xcfeefb) }, sunDir: { value: new THREE.Vector3(0.3, 0.5, -0.8) }, sunCol: { value: new THREE.Color(0xfff3c4) }, t: { value: 0 } },
  vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: 'varying vec3 vP; uniform vec3 top,bottom,sunDir,sunCol; uniform float t;' +
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }' +
    'float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);' +
    ' return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }' +
    'void main(){ float h=clamp(vP.y*1.4+0.12,0.0,1.0); vec3 c=mix(bottom,top,pow(h,0.75));' +
    'float s=pow(max(dot(normalize(vP),normalize(sunDir)),0.0),220.0); c+=sunCol*s*1.2;' +
    'float s2=pow(max(dot(normalize(vP),normalize(sunDir)),0.0),8.0); c+=sunCol*s2*0.18;' +
    'vec2 cuv=vP.xz/(abs(vP.y)+0.25);' +
    'float cl=vnoise(cuv*2.2+vec2(t*0.008,0.0))*0.6+vnoise(cuv*4.7+vec2(t*0.014,3.7))*0.4;' +
    'float cmask=smoothstep(0.55,0.85,cl)*smoothstep(0.02,0.25,vP.y)*(1.0-smoothstep(0.55,0.9,vP.y));' +
    'c=mix(c, vec3(1.0), cmask*0.75);' +
    'gl_FragColor=vec4(c,1.0); }'
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 14), skyMat);
scene.add(skyDome);

/* stars (night) */
const starGeo = new THREE.BufferGeometry();
{ const sp = new Float32Array(400 * 3);
  for (let i = 0; i < 400; i++) { const a = rand(0, Math.PI * 2), e = rand(0.08, 1.4), r = 750; sp[i*3] = Math.cos(a) * Math.cos(e) * r; sp[i*3+1] = Math.sin(e) * r; sp[i*3+2] = Math.sin(a) * Math.cos(e) * r; }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3)); }
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
const stars = new THREE.Points(starGeo, starMat); stars.frustumCulled = false; scene.add(stars);

/* ============ 4) Sea, beach & ground ============ */
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }

const seaUniformNote = { amp: 1 };
const seaGeo = new THREE.PlaneGeometry(420, 460, IS_MOBILE ? 22 : 44, IS_MOBILE ? 22 : 44);
seaGeo.rotateX(-Math.PI / 2);
const seaBase = seaGeo.attributes.position.array.slice();
const seaMat = new THREE.MeshStandardMaterial({ color: 0x0b6fa4, roughness: 0.3, metalness: 0.55, transparent: true, opacity: 0.96 });
const sea = new THREE.Mesh(seaGeo, seaMat);
sea.position.set(-225, -1.6, -120); scene.add(sea);

const foamTex = canvasTex(64, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 46; i++) { g.fillStyle = 'rgba(255,255,255,' + rand(0.25, 0.9).toFixed(2) + ')'; const y = rand(0, h); g.beginPath(); g.ellipse(rand(8, w - 8), y, rand(6, 22), rand(2, 5), 0, 0, 7); g.fill(); }
});
foamTex.repeat.set(1, 26);
const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.85, depthWrite: false });
const foam = new THREE.Mesh(new THREE.PlaneGeometry(7, 460), foamMat);
foam.rotation.x = -Math.PI / 2; foam.position.set(-16.5, -0.85, -120); scene.add(foam);
const foam2 = foam.clone(); foam2.position.x = -22; foam2.scale.x = 1.6; foam2.material = foamMat.clone(); foam2.material.opacity = 0.4; scene.add(foam2);

const sandMat = new THREE.MeshLambertMaterial({ color: 0xe8d29a });
const sand = new THREE.Mesh(new THREE.PlaneGeometry(13, 460), sandMat);
sand.rotation.x = -Math.PI / 2; sand.position.set(-10.5, -1.05, -120); sand.receiveShadow = true; scene.add(sand);

const groundMat = new THREE.MeshLambertMaterial({ color: 0x3d434b });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 460), groundMat);
ground.rotation.x = -Math.PI / 2; ground.position.set(2, -1.12, -120); ground.receiveShadow = true; scene.add(ground);

const promMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
const prom = new THREE.Mesh(new THREE.PlaneGeometry(30, 460), promMat);
prom.rotation.x = -Math.PI / 2; prom.position.set(23, -1.08, -120); prom.receiveShadow = true; scene.add(prom);

/* rails (follow player) */
const railMat = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, metalness: 0.85, roughness: 0.35 });
const rails = [];
for (const lx of LANES) for (const off of [-0.75, 0.75]) {
  const r = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 460), railMat);
  r.position.set(lx + off, -0.95, -120); scene.add(r); rails.push(r);
}

/* sleepers — one instanced mesh, wraps around player */
const SL_N = 420, SL_RANGE = 252, SL_GAP = SL_RANGE / (SL_N / 3);
const sleeperMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.0, 0.1, 0.5), new THREE.MeshLambertMaterial({ color: 0x5a4230 }), SL_N);
sleeperMesh.receiveShadow = true; scene.add(sleeperMesh);
sleeperMesh.frustumCulled = false;
sleeperMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const _m4 = new THREE.Matrix4();
function updateSleepers() {
  let k = 0;
  for (const lx of LANES) for (let i = 0; i < SL_N / 3; i++) {
    let z = (i * SL_GAP + 3) % SL_RANGE;
    z = G.pz + 12 - z;
    _m4.makeTranslation(lx, -1.05, z); sleeperMesh.setMatrixAt(k++, _m4);
  }
  sleeperMesh.instanceMatrix.needsUpdate = true;
}

/* promenade lamp material (poles + overhead wires removed — they crossed the view) */
const poleMat = new THREE.MeshLambertMaterial({ color: 0x2e3a44 });

/* lamps on promenade */
const lampGroups = [], lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
for (let i = 0; i < 14; i++) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6), poleMat); post.position.y = 1.6; g.add(post);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lampGlowMat.clone()); bulb.position.y = 4.4; g.add(bulb);
  g.position.x = 9.5; scene.add(g); lampGroups.push(g);
}

/* ============ 5) Buildings, palms, ocean props ============ */
const city = new THREE.Group(); scene.add(city);
const bMatA = new THREE.MeshLambertMaterial({ color: 0xf2ede2 });
const bMatB = new THREE.MeshLambertMaterial({ color: 0xe6b8a2 });
const bMatC = new THREE.MeshLambertMaterial({ color: 0xbcd9ea });
const bMatD = new THREE.MeshLambertMaterial({ color: 0xf7d9a0 });
const winMat = new THREE.MeshBasicMaterial({ color: 0x2c3e50 });
const winLitMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
function makeBuilding(w, h, d, mat, litRatio) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.y = h / 2 - 1.1; b.castShadow = true; g.add(b);
  const rows = Math.floor(h / 2.4), cols = Math.floor(w / 1.6);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lit = Math.random() < litRatio;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.1), lit ? winLitMat : winMat);
    win.position.set(-w / 2 + 1 + c * 1.6, h - 2.2 - r * 2.4 - 1.1, -d / 2 - 0.01);
    win.rotation.y = Math.PI; g.add(win);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.35, d + 0.4), new THREE.MeshLambertMaterial({ color: 0x7a4a3a }));
  roof.position.y = h - 1.1 + 0.15; g.add(roof);
  return g;
}
const buildings = [];
for (let i = 0; i < 46; i++) {
  const w = rand(5, 9), h = rand(7, 26), d = rand(5, 9);
  const b = makeBuilding(w, h, d, pick([bMatA, bMatB, bMatC, bMatD]), 0.4);
  b.position.x = rand(13, 60);
  b.userData.off = i * rand(9, 13);
  city.add(b); buildings.push(b);
}

/* palms */
function makePalm() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, rand(3.2, 4.6), 6), new THREE.MeshLambertMaterial({ color: 0x7a5a3a }));
  trunk.position.y = 1.6; trunk.rotation.z = rand(-0.09, 0.09); trunk.castShadow = true; g.add(trunk);
  const topY = 3.4, leafMat = new THREE.MeshLambertMaterial({ color: 0x2f9e5b, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.55, 4, 1), leafMat);
    leaf.position.y = topY; leaf.rotation.y = (i / 7) * Math.PI * 2;
    leaf.translateX(1.0); leaf.rotation.z = -0.35; leaf.castShadow = true; g.add(leaf);
  }
  const coco = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshLambertMaterial({ color: 0x6b4a2a }));
  coco.position.y = topY - 0.25; g.add(coco);
  g.userData.leaves = g.children.filter(c => c.geometry && c.geometry.type === 'PlaneGeometry');
  return g;
}
const palms = [];
for (let i = 0; i < 46; i++) {
  const p = makePalm();
  const beachSide = i % 2 === 0;
  p.position.x = beachSide ? rand(-14.5, -9) : rand(8.2, 11.5);
  p.userData.off = i * rand(8, 12);
  scene.add(p); palms.push(p);
}

/* rocks on shore */
const rocks = [];
const rockMat = new THREE.MeshStandardMaterial({ color: 0x6d7680, roughness: 0.95 });
for (let i = 0; i < 26; i++) {
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.4, 1.3), 0), rockMat);
  r.position.x = rand(-17, -8); r.rotation.set(rand(0, 3), rand(0, 3), 0); r.castShadow = true;
  r.userData.off = i * rand(10, 18); scene.add(r); rocks.push(r);
}

/* boats + buoys + distant ship */
const boats = [];
function makeBoat() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 5.2), new THREE.MeshLambertMaterial({ color: pick([0xd94f3d, 0x2f7fd0, 0xf2f2f2, 0xffc93d]) }));
  hull.position.y = 0.2; g.add(hull);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.8), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  cab.position.set(0, 1.1, -0.6); g.add(cab);
  return g;
}
for (let i = 0; i < 8; i++) { const b = makeBoat(); b.position.x = rand(-90, -30); b.userData = { off: i * 55 + rand(0, 30), sp: rand(0.15, 0.45), ph: rand(0, 6) }; scene.add(b); boats.push(b); }
const buoyMat = new THREE.MeshLambertMaterial({ color: 0xff5a3d });
const buoys = [];
for (let i = 0; i < 10; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), buoyMat); b.position.x = rand(-60, -25); b.userData = { off: i * 30, ph: rand(0, 6) }; scene.add(b); buoys.push(b); }

/* birds */
const birdMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
const birds = [];
for (let i = 0; i < 9; i++) {
  const g = new THREE.Group();
  const wgeo = new THREE.PlaneGeometry(1.1, 0.32);
  const wl = new THREE.Mesh(wgeo, birdMat); wl.position.x = -0.5; g.add(wl);
  const wr = new THREE.Mesh(wgeo, birdMat); wr.position.x = 0.5; g.add(wr);
  g.userData = { wl, wr, off: rand(0, 200), h: rand(9, 20), sp: rand(2, 5), ph: rand(0, 6) };
  scene.add(g); birds.push(g);
}

/* rain + lightning */
const RAIN_N = 900;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) { rainPos[i*3] = rand(-30, 30); rainPos[i*3+1] = rand(-2, 22); rainPos[i*3+2] = rand(-120, 20); }
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaaccee, transparent: true, opacity: 0 }));
rain.frustumCulled = false;
scene.add(rain);
const boltMat = new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0 });
const bolt = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 26), boltMat);
bolt.position.set(-40, 14, -140); scene.add(bolt);
const flash = new THREE.PointLight(0xbfd9ff, 0, 220); flash.position.set(-30, 30, -90); scene.add(flash);

/* ============ 6) Player ============ */
function buildPlayer() {
  const g = new THREE.Group();
  const std = (color, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });
  const skin = std(0xf0c8a0, 0.6);
  const shirt = std(0x00b4d8, 0.7);
  const pants = std(0x223344, 0.8);
  const shoeM = std(0xe63946, 0.55);
  const capM = std(0xffc93d, 0.6);
  const hairM = std(0x3a2a1c, 0.85);
  const packM = std(0xff6b35, 0.8);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x1c2430 });
  // the character faces -z: INTO the screen, away from the chase camera
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), shirt); torso.position.y = 1.18; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), skin); head.position.y = 1.82; head.castShadow = true; g.add(head);
  // face on the front (-z): eyes make the facing unmistakable
  for (const ex of [-0.09, 0.09]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeM); e.position.set(ex, 1.87, -0.24); g.add(e); }
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.17, 0.15), hairM); hair.position.set(0, 1.85, 0.1); g.add(hair);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.29, 0.16, 12), capM); cap.position.y = 2.0; g.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.3), capM); brim.position.set(0, 1.95, -0.34); g.add(brim);
  // backpack on the back (+z, toward camera): reads instantly as "facing away = running forward"
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.52, 0.2), packM); pack.position.set(0, 1.22, 0.27); pack.castShadow = true; g.add(pack);
  // two-segment limbs with knee/elbow joints (Subway-Surfers-grade runner silhouette)
  const mkArm = s => {
    const a = new THREE.Group();
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.32, 0.15), shirt); up.position.y = -0.16; up.castShadow = true; a.add(up);
    const f = new THREE.Group(); f.position.y = -0.32;
    const lo = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.13), skin); lo.position.y = -0.15; lo.castShadow = true; f.add(lo);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), skin); hand.position.y = -0.32; f.add(hand);
    a.add(f); a.position.set(0.4 * s, 1.5, 0); a.userData.fore = f; return a;
  };
  const mkLeg = s => {
    const l = new THREE.Group();
    const th = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.36, 0.2), pants); th.position.y = -0.18; th.castShadow = true; l.add(th);
    const sh = new THREE.Group(); sh.position.y = -0.36;
    const lo = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.34, 0.17), pants); lo.position.y = -0.17; lo.castShadow = true; sh.add(lo);
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.32), shoeM); f.position.set(0, -0.36, -0.06); sh.add(f);
    l.add(sh); l.position.set(0.16 * s, 0.68, 0); l.userData.shin = sh; return l;
  };
  const armL = mkArm(-1), armR = mkArm(1), legL = mkLeg(-1), legR = mkLeg(1);
  g.add(armL, armR, legL, legR);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.1), std(0xff6b35, 0.5));
  board.position.y = 0.06; board.visible = false; g.add(board);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.55, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02; g.add(blob);
  // magnet ring + shield bubble
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 28), new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 1; g.add(ring);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0 }));
  bubble.position.y = 1.1; g.add(bubble);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  blob.castShadow = false; ring.castShadow = false; bubble.castShadow = false;
  P.parts = { torso, head, armL, armR, legL, legR, shinL: legL.userData.shin, shinR: legR.userData.shin, foreL: armL.userData.fore, foreR: armR.userData.fore, board, blob, ring, bubble };
  P.mesh = g; scene.add(g);
}
buildPlayer();

/* dust particles */
const DUST_N = 60;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_N * 3), dustVel = new Float32Array(DUST_N * 3), dustLife = new Float32Array(DUST_N);
for (let i = 0; i < DUST_N; i++) { dustPos[i*3+1] = -50; dustLife[i] = 0; }
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xd8cfc0, size: 0.35, transparent: true, opacity: 0.8 }));
dust.frustumCulled = false;
scene.add(dust);
let dustK = 0;
function puff(x, y, z, n = 4) {
  for (let i = 0; i < n; i++) {
    const k = dustK = (dustK + 1) % DUST_N;
    dustPos[k*3] = x + rand(-0.3, 0.3); dustPos[k*3+1] = y + rand(0, 0.2); dustPos[k*3+2] = z + rand(-0.3, 0.3);
    dustVel[k*3] = rand(-1.5, 1.5); dustVel[k*3+1] = rand(1, 3.5); dustVel[k*3+2] = rand(2, 6);
    dustLife[k] = rand(0.4, 0.8);
  }
}

/* ============ 7) Trains & obstacles ============ */
const trainCols = [0xc0392b, 0x2471a3, 0x1e8449, 0x8e44ad, 0xb7950b, 0x117a65];
const frontTexC = {};
function frontTexture(col) {
  if (frontTexC[col]) return frontTexC[col];
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#' + col.toString(16).padStart(6, '0'); g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#222'; g.fillRect(14, 26, 100, 40);
  g.fillStyle = '#9adcff'; g.fillRect(18, 30, 92, 32);
  g.fillStyle = '#ffe08a'; g.beginPath(); g.arc(34, 96, 11, 0, 7); g.arc(94, 96, 11, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText('COAST', 64, 16);
  const t = new THREE.CanvasTexture(c); frontTexC[col] = t; return t;
}
function makeTrain(len, col) {
  const g = new THREE.Group();
  const bodyM = new THREE.MeshPhongMaterial({ color: col, shininess: 40 });
  const carLen = 7.5, n = Math.max(1, Math.round(len / carLen));
  for (let i = 0; i < n; i++) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, carLen - 0.4), bodyM);
    car.position.set(0, 1.35, -i * carLen - carLen / 2 + len / 2 - 0.5);
    car.castShadow = true; car.receiveShadow = true; g.add(car);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.4, carLen - 0.5), new THREE.MeshLambertMaterial({ color: 0xf5f5f5 }));
    stripe.position.set(0, 2.15, car.position.z); g.add(stripe);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.25, carLen - 0.5), new THREE.MeshLambertMaterial({ color: 0x3a3f45 }));
    roof.position.set(0, TRAIN_TOP + 0.05, car.position.z); g.add(roof);
    for (let wI = 0; wI < 3; wI++) for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), new THREE.MeshBasicMaterial({ color: 0xbfe6f5 }));
      w.position.set(1.26 * s, 1.6, car.position.z - 2 + wI * 2); w.rotation.y = s * Math.PI / 2; g.add(w);
    }
  }
  const front = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), new THREE.MeshBasicMaterial({ map: frontTexture(col) }));
  front.position.set(0, 1.35, len / 2 - 0.5); g.add(front);
  const lampM = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lampM); l.position.set(0.8 * s, 0.7, len / 2 - 0.45); g.add(l); }
  g.userData.len = len;
  return g;
}
function makeBarrier() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.18), poleMat); post.position.set(1.0 * s, 0.35, 0); post.castShadow = true; g.add(post); }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 0.25), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  bar.position.y = 0.85; bar.castShadow = true; g.add(bar);
  for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.47, 0.27), new THREE.MeshLambertMaterial({ color: 0xe33e2b })); s.position.set(-0.85 + i * 0.57, 0.85, 0); g.add(s); }
  g.userData.barrier = true;
  return g;
}
function makeBlock() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.9), new THREE.MeshLambertMaterial({ color: 0xd97b2f }));
  box.position.y = 0.45; box.castShadow = true; g.add(box);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.25, 0.94), new THREE.MeshLambertMaterial({ color: 0xfff3c4 }));
  tape.position.y = 0.62; g.add(tape);
  g.userData.low = true;
  return g;
}

/* entity pools */
window.trains = []; const trains = window.trains;
const coinsA = [];
window.rampsA = []; const rampsA = window.rampsA;
const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.12, 18); coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshPhongMaterial({ color: 0xffc93d, emissive: 0x7a5200, shininess: 80 });
const coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, 220);
coinMesh.count = 0; coinMesh.frustumCulled = false;
coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(coinMesh);
window.coinData = []; const coinData = window.coinData; // {x,y,z,taken}
const COIN_Y0 = 0.9;

const powGeo = { magnet: new THREE.TorusGeometry(0.45, 0.16, 10, 20), shield: new THREE.SphereGeometry(0.5, 12, 10), mult: new THREE.OctahedronGeometry(0.55), board: new THREE.BoxGeometry(0.4, 0.1, 1.0) };
const powMat = { magnet: new THREE.MeshBasicMaterial({ color: 0xff5a5a }), shield: new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.9 }), mult: new THREE.MeshBasicMaterial({ color: 0xb266ff }), board: new THREE.MeshBasicMaterial({ color: 0xff8c42 }) };

function spawnTrain(lane, z, len, moving, dir = 1) {
  for (const t of trains) if (!t.active) {
    t.active = true; t.mesh.visible = true;
    t.lane = lane; t.z = z; t.len = len; t.moving = moving; t.dir = dir; t.warned = false; t.horned = false;
    // pool meshes are built 20 long — stretch to logical length so visual matches collision
    if (t.kind === 'train') t.mesh.scale.z = len / (t.mesh.userData.len || 20);
    t.mesh.position.set(LANES[lane], -1.0, z);
    return t;
  }
  return null;
}
for (let i = 0; i < 26; i++) {
  const mesh = makeTrain(20, trainCols[i % trainCols.length]);
  mesh.visible = false; scene.add(mesh);
  trains.push({ mesh, active: false, lane: 0, z: 0, len: 20, moving: false, dir: 1, warned: false, horned: false, kind: 'train' });
}
for (let i = 0; i < 10; i++) {
  const mesh = (i % 2 ? makeBarrier() : makeBlock()); mesh.visible = false; scene.add(mesh);
  trains.push({ mesh, active: false, lane: 0, z: 0, len: 1.2, moving: false, dir: 1, warned: false, horned: true, kind: mesh.userData.barrier ? 'barrier' : 'low' });
}
for (let i = 0; i < 8; i++) {
  const g = new THREE.Group();
  const slope = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 9), new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
  slope.position.set(0, 1.0, 0); slope.rotation.x = 0.32; slope.castShadow = true; g.add(slope);
  const chev = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 0.6), new THREE.MeshLambertMaterial({ color: 0xffe08a }));
  chev.position.set(0, 2.1, -4.2); g.add(chev);
  g.visible = false; scene.add(g);
  rampsA.push({ mesh: g, active: false, lane: 0, z: 0, len: 9 });
}
const powersA = window.powersA = [];
for (let i = 0; i < 6; i++) {
  const grp = new THREE.Group();
  const icon = new THREE.Mesh(powGeo.magnet, powMat.magnet); icon.position.y = 0; grp.add(icon);
  const haloM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), haloM); grp.add(halo);
  grp.visible = false; scene.add(grp);
  powersA.push({ mesh: grp, icon, halo, haloM, active: false, kind: 'magnet', lane: 0, z: 0 });
}

/* spawner: keeps ~2.2 screens of content ahead */
let nextSpawnZ = -70;
let lastFree = 1; // free lane of the previous hazard row (reachable-lane chaining)
function clearAhead() {
  for (const t of trains) { t.active = false; t.mesh.visible = false; }
  for (const r of rampsA) { r.active = false; r.mesh.visible = false; }
  for (const p of powersA) { p.active = false; p.mesh.visible = false; }
  coinData.length = 0; coinMesh.count = 0; coinMesh.instanceMatrix.needsUpdate = true;
  nextSpawnZ = G.pz - 70;
  lastFree = P.lane;
}
function freeLaneAt(z, margin, forTrain) {
  const busy = [false, false, false];
  for (const t of trains) {
    if (!t.active) continue;
    if (Math.abs(t.z - z) < (t.len / 2 + margin)) busy[t.lane] = true;
    if (forTrain && Math.abs(t.z - z) < (t.len / 2 + margin + 14)) busy[t.lane] = true;
  }
  const free = [0, 1, 2].filter(l => !busy[l]);
  return free.length ? pick(free) : -1;
}
// free lane adjacent to (or same as) the previous row's free lane → never a 2-lane teleport
function chainedFree() {
  const opts = [0, 1, 2].sort((a, b) => (Math.abs(a - lastFree) + Math.random() * 0.9) - (Math.abs(b - lastFree) + Math.random() * 0.9));
  return opts[0];
}
function spawnRow() {
  const z = nextSpawnZ, diff = clamp(G.dist / 1400, 0, 1);
  const gapBase = clamp(G.speed * 0.85, 18, 30); // reaction gap grows with speed
  // global guard: all 3 lanes busy here → emit a breather instead of an unfair wall
  const jammed = [0, 1, 2].every(l => {
    for (const t of trains) {
      if (!t.active) continue;
      if (t.lane === l && Math.abs(t.z - z) < t.len / 2 + 8) return true;
    }
    return false;
  });
  if (jammed) {
    for (let i = 0; i < 6; i++) coinData.push({ x: LANES[i % 3], y: COIN_Y0, z: z + 4 - i * 2.2, taken: false });
    nextSpawnZ -= 30;
    return;
  }
  const r = Math.random();
  if (r < 0.30 + diff * 0.12) {
    // static train wall (1-2 lanes), always ≥1 free lane
    const free = chainedFree();
    const blocked = [0, 1, 2].filter(l => l !== free).sort(() => Math.random() - 0.5);
    const nT = Math.random() < 0.45 + diff * 0.25 ? 2 : 1;
    const len = rand(14, 22 + diff * 8);
    for (let i = 0; i < nT; i++) {
      const l = blocked[i];
      spawnTrain(l, z - len / 2 + 1, len, false);
    }
    lastFree = free;
    // coins on the free lane
    for (let i = 0; i < 6; i++) coinData.push({ x: LANES[free], y: COIN_Y0, z: z + 4 - i * 2.2, taken: false });
    nextSpawnZ -= len + rand(gapBase, gapBase + 10 - diff * 4);
  } else if (r < 0.46 + diff * 0.1) {
    // oncoming moving train
    const l = freeLaneAt(z, 26, true);
    if (l >= 0) {
      spawnTrain(l, z - 60, rand(13, 20), true, 1);
      $('warn').classList.remove('hidden'); setTimeout(() => $('warn').classList.add('hidden'), 1600);
      // coins on ONE safe lane, never inside the train's lane (was a coin trap)
      const safeLane = (l + 1 + randi(0, 1)) % 3; // one of the two non-train lanes
      for (let i = 0; i < 5; i++) coinData.push({ x: LANES[safeLane], y: COIN_Y0, z: z + 4 - i * 2.4, taken: false });
    } else {
      for (let i = 0; i < 5; i++) coinData.push({ x: LANES[i % 3], y: COIN_Y0, z: z + 4 - i * 2.4, taken: false });
    }
    nextSpawnZ -= rand(gapBase + 22, gapBase + 36);
  } else if (r < 0.60) {
    // barrier + low block combo, jump or slide or dodge
    const free = chainedFree();
    const others = [0, 1, 2].filter(l => l !== free);
    const l1 = others[0], l2 = others[1]; // barrier on one, low block on the other
    spawnProp(l1, z, 'barrier'); spawnProp(l2, z - 2, 'low');
    lastFree = free;
    if (Math.random() < 0.6) for (let i = 0; i < 5; i++) coinData.push({ x: LANES[free], y: COIN_Y0, z: z + 5 - i * 2.2, taken: false });
    else for (let i = 0; i < 4; i++) coinData.push({ x: LANES[l1], y: 1.9, z: z + 3 - i * 2.0, taken: false }); // jump arc coins
    nextSpawnZ -= rand(gapBase + 8, gapBase + 18);
  } else if (r < 0.72) {
    // ramp over a train → run on roof
    let l = chainedFree();
    if (freeLaneAt(z - 8, 12, false) !== l && freeLaneAt(z - 8, 12, false) >= 0) l = freeLaneAt(z - 8, 12, false);
    const len = rand(16, 22);
    spawnTrain(l, z - 8 - len / 2, len, false);
    spawnRamp(l, z + 2);
    for (let i = 0; i < 7; i++) coinData.push({ x: LANES[l], y: COIN_Y0 + 2.9, z: z - 6 - i * 2.6, taken: false });
    lastFree = l;
    nextSpawnZ -= len + rand(gapBase + 12, gapBase + 24);
  } else if (r < 0.82) {
    // coin slalom
    const start = randi(0, 2);
    for (let i = 0; i < 12; i++) coinData.push({ x: LANES[(start + Math.floor(i / 4)) % 3], y: COIN_Y0 + (i % 4 === 2 ? 1.0 : 0), z: z + 4 - i * 2.4, taken: false });
    if (Math.random() < 0.35) spawnPower(z - 26);
    nextSpawnZ -= rand(gapBase + 16, gapBase + 28);
  } else if (r < 0.92) {
    // power-up gate
    spawnPower(z);
    for (let i = 0; i < 4; i++) coinData.push({ x: LANES[randi(0, 2)], y: COIN_Y0, z: z + 6 - i * 2.2, taken: false });
    nextSpawnZ -= rand(gapBase + 10, gapBase + 20);
  } else {
    // breather: coins only
    for (let i = 0; i < 8; i++) coinData.push({ x: LANES[i % 3], y: COIN_Y0, z: z + 4 - i * 2.2, taken: false });
    nextSpawnZ -= 30;
  }
}
function spawnProp(lane, z, kind) {
  for (const t of trains) {
    if (t.active && t.lane === lane && Math.abs(t.z - z) < 8) return; // never stack hazards in one lane
  }
  for (const t of trains) {
    if (t.active || t.kind !== kind) continue;
    t.active = true; t.mesh.visible = true; t.lane = lane; t.z = z;
    t.mesh.position.set(LANES[lane], -1.0, z);
    return;
  }
}
function spawnRamp(lane, z) {
  for (const r of rampsA) {
    if (r.active && r.lane === lane && Math.abs(r.z - z) < 12) return null;
  }
  for (const r of rampsA) {
    if (r.active) continue;
    r.active = true; r.mesh.visible = true; r.lane = lane; r.z = z;
    r.mesh.position.set(LANES[lane], -1.0, z);
    return r;
  }
  return null;
}
const POW_KINDS = ['magnet', 'shield', 'mult', 'board'];
function spawnPower(z, forceKind) {
  for (const p of powersA) {
    if (p.active) continue;
    p.active = true; p.mesh.visible = true;
    p.kind = forceKind || pick(POW_KINDS); p.lane = randi(0, 2); p.z = z;
    // never bury a power-up inside a train body — shift it to a neighbouring lane
    for (const t of trains) {
      if (t.active && t.kind === 'train' && t.lane === p.lane && Math.abs(t.z - z) < t.len / 2 + 3) {
        p.lane = (p.lane + 1) % 3;
        break;
      }
    }
    p.mesh.position.set(LANES[p.lane], 0.1, z);
    p.icon.geometry = powGeo[p.kind]; p.icon.material = powMat[p.kind];
    if (p.kind === 'board') { p.icon.rotation.x = 0; } else p.icon.rotation.x = 0;
    return;
  }
}

/* ============ 8) Power-up state, weather, input ============ */
window.POW = { magnet: 0, shield: 0, mult: 0, board: 0 };
function givePower(kind) {
  AudioSys.power();
  if (kind === 'magnet') POW.magnet = 9;
  else if (kind === 'shield') POW.shield = 9;
  else if (kind === 'mult') POW.mult = 10;
  else if (kind === 'board') { POW.board = 1; P.parts.board.visible = true; }
  puff(P.x, 1.4, G.pz, 8);
}
function hurtPlayer() {
  if (POW.shield > 0) { POW.shield = 0; G.stumble = 1; G.stumbleT = 0.5; AudioSys.crash(); return false; }
  if (POW.board > 0) { POW.board = 0; P.parts.board.visible = false; G.stumble = 1; G.stumbleT = 0.5; AudioSys.crash(); puff(P.x, 1, G.pz, 10); return false; }
  return true;
}

/* weather machine: sunny → sunset → night → storm → sunny */
window.WX = { cur: 'sunny', t: 0, dur: 40, blend: 1, boltT: 0, rainAmt: 0 };
const WX_ORDER = ['sunny', 'sunset', 'night', 'storm'];
const WX_DUR = { sunny: 45, sunset: 30, night: 40, storm: 30 };
const WX_NAME = { sunny: '☀️ مشمس', sunset: '🌅 غروب', night: '🌙 ليل', storm: '⛈️ عاصفة' };
const WX_PRESET = {
  sunny:  { top: 0x2f7fd0, bot: 0xcfeefb, fog: 0x9fd4ef, hemi: 0.9, sun: 1.6, sunC: 0xfff2d8, stars: 0, lamps: 0, sea: 0x0b6fa4, waves: 1 },
  sunset: { top: 0x3a3a7a, bot: 0xff9a5a, fog: 0xe8a06a, hemi: 0.7, sun: 1.3, sunC: 0xff9a4d, stars: 0, lamps: 0.5, sea: 0x1a5a8a, waves: 1.2 },
  night:  { top: 0x060a24, bot: 0x1a2a55, fog: 0x0e1838, hemi: 0.35, sun: 0.35, sunC: 0x8aa8ff, stars: 1, lamps: 1, sea: 0x06283f, waves: 0.9 },
  storm:  { top: 0x2a3440, bot: 0x6a7a8a, fog: 0x55606c, hemi: 0.5, sun: 0.5, sunC: 0xaab5c0, stars: 0, lamps: 1, sea: 0x0a3a55, waves: 2.2 }
};
let wxFrom = WX_PRESET.sunny, wxTo = WX_PRESET.sunny;
function nextWeather() {
  const i = (WX_ORDER.indexOf(WX.cur) + 1) % WX_ORDER.length;
  wxFrom = WX_PRESET[WX.cur]; WX.cur = WX_ORDER[i]; wxTo = WX_PRESET[WX.cur];
  WX.t = 0; WX.dur = WX_DUR[WX.cur]; WX.blend = 0;
  $('weatherName').textContent = WX_NAME[WX.cur].split(' ')[1];
  $('weatherChip').firstChild.textContent = WX_NAME[WX.cur].split(' ')[0] + ' ';
}
const _cA = new THREE.Color(), _cB = new THREE.Color();
function mixCol(a, b, t, out) { _cA.setHex(a); _cB.setHex(b); out.copy(_cA).lerp(_cB, t); return out; }
function applyWeather(dt) {
  WX.t += dt;
  if (WX.t >= WX.dur) nextWeather();
  WX.blend = Math.min(1, WX.blend + dt / 6);
  const t = WX.blend, F = wxFrom, T = wxTo;
  mixCol(F.top, T.top, t, skyMat.uniforms.top.value);
  mixCol(F.bot, T.bot, t, skyMat.uniforms.bottom.value);
  mixCol(F.fog, T.fog, t, scene.fog.color);
  renderer.setClearColor(scene.fog.color);
  hemi.intensity = lerp(F.hemi, T.hemi, t);
  sun.intensity = lerp(F.sun, T.sun, t);
  mixCol(F.sunC, T.sunC, t, sun.color);
  starMat.opacity = lerp(F.stars, T.stars, t);
  const lampI = lerp(F.lamps, T.lamps, t);
  for (const l of lampGroups) l.children[1].material.color.setHex(lampI > 0.5 ? 0xffe9a8 : 0x8a8f96);
  mixCol(F.sea, T.sea, t, seaMat.color);
  seaUniformNote.amp = lerp(F.waves, T.waves, t);
  // storm fx
  const wantRain = WX.cur === 'storm' ? 1 : 0;
  WX.rainAmt = lerp(WX.rainAmt, wantRain, dt * 0.8);
  rain.material.opacity = WX.rainAmt * 0.7;
  rain.visible = WX.rainAmt > 0.02;
  if (WX.cur === 'storm' && Math.random() < dt * 0.25) {
    WX.boltT = 0.35; boltMat.opacity = 0.9; flash.intensity = 6;
    bolt.position.set(rand(-70, 10), 14, G.pz - rand(90, 150));
    bolt.scale.set(rand(0.7, 1.6), 1, 1);
    AudioSys.thunder();
  }
  if (WX.boltT > 0) { WX.boltT -= dt; if (WX.boltT <= 0) { boltMat.opacity = 0; flash.intensity = 0; } }
}

/* input */
function doLeft() { if (G.state !== 'play' || P.dead) return; if (P.lane > 0) { P.lane--; AudioSys.click(); puff(P.x, 0.1, G.pz, 2); } }
function doRight() { if (G.state !== 'play' || P.dead) return; if (P.lane < 2) { P.lane++; AudioSys.click(); puff(P.x, 0.1, G.pz, 2); } }
function doJump() {
  if (G.state !== 'play' || P.dead) return;
  if (P.sliding) { P.sliding = false; P.slideT = 0; }
  P.jbuf = JBUF_T; // buffered: also works just before landing
  tryJump();
}
function tryJump() {
  if (P.jbuf <= 0 || P.dead) return;
  if (P.grounded || P.coyote > 0 || P.roof) {
    P.vy = JUMP_V * (G.stumble > 0 ? 0.85 : 1);
    P.grounded = false; P.coyote = 0; P.jbuf = 0; P.roof = null;
    AudioSys.jump(); puff(P.x, 0.1, G.pz, 5);
  }
}
function doSlide() {
  if (G.state !== 'play' || P.dead) return;
  P.jbuf = 0;
  if (!P.grounded) { P.vy = Math.min(P.vy, -16); } // slam down
  if (!P.sliding) { P.sliding = true; P.slideT = 0.75; AudioSys.slideSfx(); puff(P.x, 0.2, G.pz, 4); }
  else P.slideT = 0.75;
}
addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  if (G.state !== 'play') { if (e.key === ' ' || e.key === 'Enter') startRun(); return; }
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') doLeft();
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') doRight();
  else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') doJump();
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') doSlide();
  else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') togglePause();
});
/* touch swipe */
let tsX = 0, tsY = 0, tsT = 0;
addEventListener('touchstart', e => { const t = e.changedTouches[0]; tsX = t.clientX; tsY = t.clientY; tsT = performance.now(); }, { passive: true });
addEventListener('touchend', e => {
  const t = e.changedTouches[0], dx = t.clientX - tsX, dy = t.clientY - tsY;
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) { if (G.state === 'play' && !P.dead) doJump(); return; } // tap = jump
  if (Math.abs(dx) > Math.abs(dy)) dx > 0 ? doRight() : doLeft();
  else dy > 0 ? doSlide() : doJump();
}, { passive: true });

/* ============ 9) Game flow ============ */
function resetWorld() {
  G.speed = 13; G.dist = 0; G.coins = 0; G.score = 0; G.mult = 1; G.t = 0; G.pz = 0;
  G.stumble = 0; G.stumbleT = 0; G.shake = 0; G.slowMo = 1;
  P.lane = 1; P.x = 0; P.y = 0; P.vy = 0; P.grounded = true; P.sliding = false; P.slideT = 0; P.roof = null; P.dead = false;
  P.deathT = 0; P.coyote = COYOTE_T; P.jbuf = 0; P.landT = 0; P.onRamp = false;
  P.mesh.rotation.set(0, 0, 0); P.mesh.scale.set(1, 1, 1); P.mesh.visible = true;
  P.parts.board.visible = false;
  POW.magnet = POW.shield = POW.mult = POW.board = 0;
  WX.cur = 'sunny'; WX.t = 0; WX.dur = WX_DUR.sunny; WX.blend = 1; wxFrom = wxTo = WX_PRESET.sunny;
  $('weatherName').textContent = 'مشمس'; $('weatherChip').firstChild.textContent = '☀️ ';
  clearAhead();
}
function startRun() {
  AudioSys.init(); AudioSys.click();
  resetWorld();
  $('menu').classList.add('hidden'); $('over').classList.add('hidden'); $('pauseMenu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  G.state = 'countdown';
  const cd = $('countdown'); cd.classList.remove('hidden');
  const seq = ['3', '2', '1', 'انطلق! 🌊'];
  let i = 0;
  const step = () => {
    if (G.state !== 'countdown') return;
    if (i < seq.length) {
      cd.textContent = seq[i];
      cd.classList.remove('zoom'); void cd.offsetWidth; cd.classList.add('zoom');
      AudioSys.tone(400 + i * 150, 0.15, 'square', 0.15);
      i++; setTimeout(step, i === seq.length ? 700 : 800);
    } else { cd.classList.add('hidden'); G.state = 'play'; showHint(); }
  };
  step();
}
function showHint() {
  const h = $('hint'); h.classList.remove('hidden');
  setTimeout(() => h.classList.add('hidden'), 5000);
}
function togglePause(force) {
  if (G.state === 'play' && force !== false) { G.state = 'pause'; $('pauseMenu').classList.remove('hidden'); }
  else if (G.state === 'pause' && force !== true) { G.state = 'play'; $('pauseMenu').classList.add('hidden'); AudioSys.init(); }
}
function gameOver() {
  G.state = 'over';
  const sc = Math.floor(G.score);
  const isBest = sc > store.best;
  if (isBest) store.best = sc;
  $('finalScore').textContent = sc;
  $('finalCoins').textContent = G.coins;
  $('finalDist').textContent = Math.floor(G.dist) + ' م';
  $('bestOver').textContent = store.best;
  $('bestMenu').textContent = store.best;
  $('newBest').classList.toggle('hidden', !isBest);
  setTimeout(() => { if (G.state === 'over') $('over').classList.remove('hidden'); }, 900);
}
function die() {
  if (P.dead) return;
  P.dead = true; P.deathT = 0;
  AudioSys.crash(); G.shake = 1.2;
}
$('btnStart').onclick = startRun;
$('btnAgain').onclick = startRun;
$('btnRestartP').onclick = startRun;
$('btnResume').onclick = () => togglePause(false);
$('btnMenuP').onclick = () => { G.state = 'menu'; $('pauseMenu').classList.add('hidden'); $('hud').classList.add('hidden'); $('menu').classList.remove('hidden'); $('bestMenu').textContent = store.best; };
$('btnMenuO').onclick = () => { G.state = 'menu'; $('over').classList.add('hidden'); $('hud').classList.add('hidden'); $('menu').classList.remove('hidden'); $('bestMenu').textContent = store.best; };
$('btnPause').onclick = () => togglePause();
$('btnMute').onclick = e => { AudioSys.init(); const m = AudioSys.toggle(); e.target.textContent = m ? '🔇' : '🔊'; };
$('bestMenu').textContent = store.best;
document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play') togglePause(true); });

/* ============ 10) Update loop ============ */
const ROOF_Y = 2.7;
const clock = new THREE.Clock();
const _dummy = new THREE.Object3D();
let hintShown = false;

function playerLocalHead() { return P.sliding ? 0.5 : 1.9; }

function updatePlayer(dt) {
  const targetX = LANES[P.lane];
  // lane change: fast ease-out + slight overshoot feel via clamped lean (no oscillation)
  P.x = lerp(P.x, targetX, Math.min(1, dt * LANE_LERP));
  if (Math.abs(P.x - targetX) < 0.02) P.x = targetX;
  // coyote time + jump buffer (Subway-Surfers-grade forgiveness)
  if (P.coyote > 0) P.coyote -= dt;
  if (P.jbuf > 0) { P.jbuf -= dt; tryJump(); }
  // vertical
  if (!P.grounded || P.vy !== 0) {
    // higher gravity while falling = snappy, controllable arc; low-g while rising holding space
    const fallMult = P.vy > 0 ? 1 : 1.6;
    P.vy -= GRAV * fallMult * dt;
    P.vy = Math.max(P.vy, -30); // terminal velocity
    P.y += P.vy * dt;
    if (P.y <= 0) {
      const impact = P.vy;
      if (!P.grounded && impact < -9) { puff(P.x, 0.1, G.pz, 6); AudioSys.noise(0.12, 0.1, 900); P.landT = clamp(-impact / 30, 0.12, 0.32); }
      else if (!P.grounded) P.landT = 0.08;
      P.y = 0; P.vy = 0; P.grounded = true;
      P.coyote = COYOTE_T;
      if (P.jbuf > 0) tryJump(); // buffered jump fires on touchdown
    } else if (P.y > 0.05) P.grounded = false;
  } else {
    P.coyote = COYOTE_T;
  }
  if (P.landT > 0) P.landT -= dt;
  // roof support check
  if (P.roof) {
    const t = P.roof;
    const over = t.active && Math.abs(t.z - G.pz) < t.len / 2 && Math.abs(P.x - LANES[t.lane]) < 1.1;
    if (!over || P.y < ROOF_Y - 0.5) P.roof = null;
    else { P.y = ROOF_Y; P.vy = 0; P.grounded = true; }
  }
  // slide timer
  if (P.sliding) { P.slideT -= dt; if (P.slideT <= 0) { P.sliding = false; } }
  // stumble timer
  if (G.stumbleT > 0) { G.stumbleT -= dt; if (G.stumbleT <= 0) G.stumble = 0; }
  // power timers
  for (const k of ['magnet', 'shield', 'mult']) if (POW[k] > 0) POW[k] = Math.max(0, POW[k] - dt);

  // mesh transform
  const m = P.mesh;
  m.position.set(P.x, -0.95 + P.y, G.pz);
  const lean = clamp((targetX - P.x) * 0.35, -0.6, 0.6);
  if (P.dead) {
    P.deathT += dt;
    m.rotation.x = lerp(m.rotation.x, Math.PI / 2.4, dt * 6); // knocked back by the train
    m.position.y = -0.95 + Math.max(0, P.y + P.deathT * 1.2 - P.deathT * P.deathT * 2.2);
    G.speed = lerp(G.speed, 0, dt * 4);
  } else if (P.sliding) {
    m.rotation.set(-1.1, lean * 0.4, 0);
    m.position.y -= 0.35;
    // dive pose: legs trail flat, arms swept back
    P.parts.legL.rotation.x = lerp(P.parts.legL.rotation.x, 0.25, Math.min(1, dt * 10));
    P.parts.legR.rotation.x = lerp(P.parts.legR.rotation.x, 0.1, Math.min(1, dt * 10));
    P.parts.shinL.rotation.x = lerp(P.parts.shinL.rotation.x, -0.2, Math.min(1, dt * 10));
    P.parts.shinR.rotation.x = lerp(P.parts.shinR.rotation.x, -0.1, Math.min(1, dt * 10));
    P.parts.armL.rotation.x = lerp(P.parts.armL.rotation.x, 1.9, Math.min(1, dt * 10));
    P.parts.armR.rotation.x = lerp(P.parts.armR.rotation.x, 1.9, Math.min(1, dt * 10));
    P.parts.foreL.rotation.x = lerp(P.parts.foreL.rotation.x, 0.3, Math.min(1, dt * 10));
    P.parts.foreR.rotation.x = lerp(P.parts.foreR.rotation.x, 0.3, Math.min(1, dt * 10));
    if (P.grounded && G.speed > 4) puff(P.x, 0.05, G.pz + 0.6, 1);
  } else if (!P.grounded) {
    const air = clamp(P.vy / JUMP_V, -1, 1);
    m.rotation.set(air > 0 ? -0.22 : 0.12, lean * 0.5, lean * 0.3);
    // tucked jump pose eases toward the landing crouch instead of snapping
    const tuck = clamp(1 - Math.abs(P.vy) / JUMP_V, 0.25, 1);
    P.parts.legL.rotation.x = lerp(P.parts.legL.rotation.x, -0.75 * tuck, Math.min(1, dt * 10));
    P.parts.legR.rotation.x = lerp(P.parts.legR.rotation.x, 0.45 * tuck, Math.min(1, dt * 10));
    P.parts.shinL.rotation.x = lerp(P.parts.shinL.rotation.x, -1.25 * tuck, Math.min(1, dt * 10));
    P.parts.shinR.rotation.x = lerp(P.parts.shinR.rotation.x, -0.55 * tuck, Math.min(1, dt * 10));
    // arms reach up-and-forward (was up-and-back: read as running backwards)
    P.parts.armL.rotation.x = lerp(P.parts.armL.rotation.x, 2.1, Math.min(1, dt * 8));
    P.parts.armR.rotation.x = lerp(P.parts.armR.rotation.x, 2.1, Math.min(1, dt * 8));
    P.parts.foreL.rotation.x = lerp(P.parts.foreL.rotation.x, 0.5, Math.min(1, dt * 8));
    P.parts.foreR.rotation.x = lerp(P.parts.foreR.rotation.x, 0.5, Math.min(1, dt * 8));
  } else {
    // run cycle blends in over ~150ms after landing so feet never snap
    const blend = P.landT > 0 ? 1 - P.landT / 0.32 : 1;
    const ph = G.t * (7 + G.speed * 0.55);
    const amp = 0.95 * (0.35 + 0.65 * blend);
    const s = Math.sin(ph), c = Math.sin(ph + Math.PI);
    // sprint INTO the run: forward body lean (was +0.08 backward lean) + torso counter-twist
    m.rotation.set(-(0.1 + Math.min(G.speed, 30) * 0.004), lean * 0.6 + s * 0.06, lean * 0.25);
    // thighs swing; knees bend as the leg recovers forward, extend on stance
    P.parts.legL.rotation.x = lerp(P.parts.legL.rotation.x, s * amp, Math.min(1, dt * 14));
    P.parts.legR.rotation.x = lerp(P.parts.legR.rotation.x, c * amp, Math.min(1, dt * 14));
    P.parts.shinL.rotation.x = -(0.1 + Math.max(0, s) * 1.15);
    P.parts.shinR.rotation.x = -(0.1 + Math.max(0, c) * 1.15);
    // arms pump opposite the legs, elbows bent ~90° like a real runner
    P.parts.armL.rotation.x = lerp(P.parts.armL.rotation.x, c * amp * 0.9, Math.min(1, dt * 14));
    P.parts.armR.rotation.x = lerp(P.parts.armR.rotation.x, s * amp * 0.9, Math.min(1, dt * 14));
    P.parts.foreL.rotation.x = 1.2 + Math.max(0, c) * 0.4;
    P.parts.foreR.rotation.x = 1.2 + Math.max(0, s) * 0.4;
    m.position.y += Math.abs(Math.cos(ph)) * 0.05 * blend;
    P.parts.armL.rotation.z = 0.15; P.parts.armR.rotation.z = -0.15;
    if (G.speed > 4 && Math.sin(ph) > 0.92) puff(P.x + rand(-0.2, 0.2), 0.02, G.pz + 0.5, 1);
  }
  // landing squash
  const landDip = P.landT > 0 ? (P.landT / 0.32) * 0.22 : 0; // deep crouch right after touchdown
  const targetSY = (!P.grounded) ? 1.02 : (P.sliding ? 0.72 : 1 - landDip);
  m.scale.y = lerp(m.scale.y, targetSY, Math.min(1, dt * 12));
  const targetSXZ = 1 + (1 - targetSY) * 0.6;
  m.scale.x = lerp(m.scale.x, targetSXZ, Math.min(1, dt * 12));
  m.scale.z = lerp(m.scale.z, targetSXZ, Math.min(1, dt * 12));
  // blob shadow
  P.parts.blob.material.opacity = clamp(0.32 - P.y * 0.06, 0.08, 0.32);
  const bs = 1 + P.y * 0.12; P.parts.blob.scale.set(bs, bs, 1);
  // power fx visuals
  P.parts.ring.material.opacity = POW.magnet > 0 ? 0.55 + Math.sin(G.t * 8) * 0.2 : 0;
  P.parts.ring.rotation.z += dt * 3;
  P.parts.bubble.material.opacity = POW.shield > 0 ? 0.3 + Math.sin(G.t * 6) * 0.1 : 0;
}

function checkCollisions() {
  if (P.dead) return;
  const feet = P.y, head = P.y + playerLocalHead();
  // ramps first (climb)
  P.onRamp = false;
  for (const r of rampsA) {
    if (!r.active) continue;
    if (Math.abs(P.x - LANES[r.lane]) > 1.1) continue;
    const dz = r.z - G.pz;
    if (dz > 5 || dz < -5.5) continue;
    const k = (G.pz - r.z + 4.5) / 9;
    if (k >= 0 && k <= 1.05) {
      const h = k * k * (3 - 2 * k) * 3.0; // smoothstep: flat entry/exit, no ramp pop
      if (feet <= h + 0.6) {
        P.y = Math.max(P.y, h); P.vy = 0; P.grounded = true; P.onRamp = true; P.roof = null;
        if (Math.random() < 0.5) puff(P.x, P.y, G.pz, 1);
      }
    } else if (k > 1.05 && k < 1.6 && P.grounded && feet > 2.2) {
      // launched off the lip!
      // preserve climb momentum so the lip launch always clears the gap onto the roof
      P.vy = Math.max(6.5, G.speed * 0.28); P.grounded = false; P.onRamp = false;
      AudioSys.jump();
    }
  }
  // trains & props
  for (const t of trains) {
    if (!t.active) continue;
    const dz = t.z - G.pz;
    if (Math.abs(dz) > t.len / 2 + 1.4) continue;
    if (Math.abs(P.x - LANES[t.lane]) > 0.85) continue; // forgiving hitbox while mid lane-change
    if (t.kind === 'train') {
      if (P.roof === t) continue;
      if (P.onRamp) continue;
      if (feet >= ROOF_Y - 0.3) {
        // snap down only when actually falling onto the deck — rising past the edge never sticks
        if (P.vy <= 0.5 && feet <= ROOF_Y + 0.7) { P.y = ROOF_Y; P.vy = 0; P.grounded = true; P.roof = t; puff(P.x, P.y, G.pz, 3); }
        continue;
      }
      if (head > 0.35 && feet < ROOF_Y - 0.25) {
        // side-swipe while fully on a neighbour lane edge: stumble, not death
        if (Math.abs(P.x - LANES[t.lane]) > 0.62 && !P.dead && feet < 0.05) {
          if (hurtPlayer()) { die(); gameOver(); return; }
          P.x = LANES[P.lane]; // nudge back into the safe lane
          continue;
        }
        if (t.moving && !t.horned) { t.horned = true; AudioSys.horn(); }
        // running on the ground straight into a train front: always fatal
        if (P.grounded && feet < 0.05 && P.vy <= 0.01 && Math.abs(dz) < t.len / 2 + 1.0 && P.onRamp === false) { die(); gameOver(); return; }
        if (hurtPlayer()) { die(); gameOver(); return; }
      }
    } else if (t.kind === 'barrier') {
      if (P.sliding || feet > 1.0) continue; // slid under / jumped over
      if (Math.abs(dz) > 1.05) continue; // thin hitbox: no early/late phantom hits
      if (head > 0.55 && feet < 1.05) { if (hurtPlayer()) { die(); gameOver(); return; } }
    } else { // low block
      if (feet > 0.95) continue; // jumped it
      if (Math.abs(dz) > 0.95) continue;
      if (hurtPlayer()) { die(); gameOver(); return; }
    }
  }
  // coins
  const magnetR = POW.magnet > 0 ? 7 : 0;
  const grabR = clamp(G.speed * 0.055, 0.9, 1.8); // pickup radius grows with speed (high-speed fairness)
  for (const c of coinData) {
    if (c.taken) continue;
    const dz = c.z - G.pz;
    if (dz > 3 || dz < -3) continue;
    const dx = Math.abs(c.x - P.x), dy = Math.abs(c.y - (P.y + 0.9));
    if ((dx < grabR && dy < 1.5) || (magnetR && dx < magnetR && dy < magnetR && Math.abs(dz) < magnetR)) {
      c.taken = true; G.coins++;
      const gain = 10 * (POW.mult > 0 ? 2 : 1);
      G.score += gain; AudioSys.coin();
      puff(c.x, c.y - 0.9, c.z, 2);
    }
  }
  // powers
  for (const p of powersA) {
    if (!p.active) continue;
    if (Math.abs(p.z - G.pz) > 1.8) continue;
    if (Math.abs(P.x - LANES[p.lane]) > 1.5) continue;
    if (Math.abs(P.y + 0.9 - 0.6) > 2.4) continue;
    p.active = false; p.mesh.visible = false;
    givePower(p.kind);
  }
}

function updateEntities(dt) {
  // trains
  for (const t of trains) {
    if (!t.active) continue;
    if (t.moving) {
      t.z += (19 + G.speed * 0.15) * dt; // oncoming, scales slightly with run speed
      if (!t.horned && t.z - G.pz < 90) { t.horned = true; AudioSys.horn(); }
    }
    t.mesh.position.z = t.z;
    if (t.z - G.pz > 45) { t.active = false; t.mesh.visible = false; }
    else if (t.z < G.pz - 340) { t.active = false; t.mesh.visible = false; }
  }
  for (const r of rampsA) {
    if (!r.active) continue;
    if (r.z - G.pz > 45) { r.active = false; r.mesh.visible = false; }
  }
  for (const p of powersA) {
    if (!p.active) continue;
    p.mesh.position.y = 0.1 + Math.sin(G.t * 3 + p.z) * 0.25;
    p.icon.rotation.y += dt * 2.5;
    p.halo.scale.setScalar(1 + Math.sin(G.t * 4) * 0.12);
    if (p.z - G.pz > 30) { p.active = false; p.mesh.visible = false; }
  }
  // coins → instanced
  let n = 0;
  for (const c of coinData) {
    if (c.taken) continue;
    const dz = c.z - G.pz;
    if (dz > 15 || dz < -130) continue;
    if (n >= 220) break;
    _dummy.position.set(c.x, c.y - 0.9 + 0.9, dz + G.pz);
    _dummy.position.y = c.y;
    _dummy.rotation.set(0, G.t * 3 + c.z, 0);
    _dummy.updateMatrix();
    coinMesh.setMatrixAt(n++, _dummy.matrix);
  }
  coinMesh.count = n;
  coinMesh.instanceMatrix.needsUpdate = true;
  // spawn more ahead
  while (nextSpawnZ > G.pz - 250) spawnRow();
}

function updateAmbient(dt) {
  // world strips follow player
  sea.position.z = G.pz - 120; foam.position.z = G.pz - 120; foam2.position.z = G.pz - 120;
  sand.position.z = G.pz - 120; ground.position.z = G.pz - 120; prom.position.z = G.pz - 120;
  for (const r of rails) r.position.z = G.pz - 120;
  rain.position.z = G.pz;
  skyDome.position.z = G.pz - 60; stars.position.z = G.pz - 60;
  sun.position.set(P.x + 18, 32, G.pz + 12);
  sun.target.position.set(0, -1, G.pz - 25); sun.target.updateMatrixWorld();
  // sky drift + sea waves (3 layered swells; normals every 3rd frame for mobile)
  if (skyMat.uniforms.t) skyMat.uniforms.t.value = G.t;
  const pos = seaGeo.attributes.position, amp = seaUniformNote.amp;
  const wob = WX.cur === 'storm' ? 1.5 : 1;
  for (let i = 0; i < pos.count; i++) {
    const bx = seaBase[i * 3], bz = seaBase[i * 3 + 2];
    pos.array[i * 3 + 1] =
      Math.sin(bx * 0.14 + G.t * 1.6) * 0.35 * amp +
      Math.cos(bz * 0.08 + G.t * 1.1) * 0.4 * amp +
      Math.sin((bx + bz) * 0.05 + G.t * 2.3) * 0.22 * amp * wob;
  }
  pos.needsUpdate = true;
  updateAmbient._n = (updateAmbient._n || 0) + 1;
  if (updateAmbient._n % 3 === 0) seaGeo.computeVertexNormals();
  foamTex.offset.y -= dt * (0.25 + amp * 0.15);
  foam.position.x = -16.5 + Math.sin(G.t * 0.9) * 1.1 * amp;
  foam2.position.x = -23 + Math.sin(G.t * 0.7 + 2) * 1.6 * amp;
  // rain fall
  if (rain.visible) {
    const rp = rainGeo.attributes.position;
    for (let i = 0; i < RAIN_N; i++) {
      rp.array[i * 3 + 1] -= 34 * dt;
      if (rp.array[i * 3 + 1] < -2) { rp.array[i * 3] = rand(-30, 30); rp.array[i * 3 + 1] = rand(16, 24); rp.array[i * 3 + 2] = rand(-120, 20); }
    }
    rp.needsUpdate = true;
  }
  // lamps wrap
  for (let i = 0; i < lampGroups.length; i++) {
    const rel = (((i * 41 - G.pz) % 300) + 300) % 300;
    lampGroups[i].position.z = G.pz + 15 - rel;
  }
  for (const b of buildings) {
    const rel = (((b.userData.off - G.pz) % 460) + 460) % 460;
    b.position.z = G.pz + 20 - rel;
  }
  for (const p of palms) {
    const rel = (((p.userData.off - G.pz) % 420) + 420) % 420;
    p.position.z = G.pz + 18 - rel;
    p.rotation.z = Math.sin(G.t * (WX.cur === 'storm' ? 5 : 1.4) + p.userData.off) * (WX.cur === 'storm' ? 0.14 : 0.035);
  }
  for (const r of rocks) {
    const rel = (((r.userData.off - G.pz) % 420) + 420) % 420;
    r.position.z = G.pz + 18 - rel;
  }
  for (const b of boats) {
    const rel = (((b.userData.off - G.pz * 0.15) % 480) + 480) % 480;
    b.position.z = G.pz + 10 - rel - 40;
    b.position.y = -1.2 + Math.sin(G.t * 1.8 + b.userData.ph) * 0.35 * amp;
    b.rotation.z = Math.sin(G.t * 1.5 + b.userData.ph) * 0.08 * amp;
    b.rotation.y = Math.sin(G.t * 0.3 + b.userData.ph) * 0.2;
  }
  for (const b of buoys) {
    const rel = (((b.userData.off - G.pz) % 300) + 300) % 300;
    b.position.z = G.pz + 12 - rel;
    b.position.y = -1.1 + Math.sin(G.t * 2.4 + b.userData.ph) * 0.45 * amp;
  }
  for (const b of birds) {
    const u = b.userData;
    const bz = G.pz - 20 - ((u.off - G.t * u.sp * 4) % 160 + 160) % 160;
    b.position.set(Math.sin(G.t * 0.4 + u.ph) * 22 - 8, u.h + Math.sin(G.t * 1.2 + u.ph) * 1.5, bz);
    const flap = Math.sin(G.t * 9 + u.ph) * 0.7;
    u.wl.rotation.y = 0; u.wl.rotation.z = flap; u.wr.rotation.z = -flap;
    b.rotation.y = Math.PI / 2 + Math.sin(G.t * 0.4 + u.ph) * 0.4;
  }
  // dust
  const dp = dustGeo.attributes.position;
  for (let i = 0; i < DUST_N; i++) {
    if (dustLife[i] <= 0) continue;
    dustLife[i] -= dt;
    dp.array[i*3] += dustVel[i*3] * dt; dp.array[i*3+1] += dustVel[i*3+1] * dt; dp.array[i*3+2] += dustVel[i*3+2] * dt;
    if (dustLife[i] <= 0) dp.array[i*3+1] = -50;
  }
  dp.needsUpdate = true;
  applyWeather(dt);
}

function updateCamera(dt) {
  const px = P.mesh ? P.x : 0;
  const py = P.mesh ? P.y : 0;
  const airborne = P.grounded ? 0 : 1;
  const tx = px * 0.45, ty = 4.7 + py * 0.32 - airborne * 0.15, tz = G.pz + 8.4;
  const k = G.state === 'play' ? Math.min(1, dt * 7) : Math.min(1, dt * 3);
  camera.position.x = lerp(camera.position.x, tx, k);
  camera.position.y = lerp(camera.position.y, ty, k);
  camera.position.z = tz;
  if (G.shake > 0) {
    G.shake = Math.max(0, G.shake - dt * 1.6);
    camera.position.x += rand(-1, 1) * G.shake * 0.5;
    camera.position.y += rand(-1, 1) * G.shake * 0.4;
  }
  camera.lookAt(px * 0.7, 1.5 + py * 0.4, G.pz - 9);
  if (G.stumble) camera.rotation.z += Math.sin(G.t * 30) * 0.02;
  const targetFov = 62 + (G.speed - 13) * 0.45;
  if (Math.abs(camera.fov - targetFov) > 0.05) { camera.fov = lerp(camera.fov, targetFov, Math.min(1, dt * 2)); camera.updateProjectionMatrix(); }
}

function updateHUD() {
  $('score').textContent = Math.floor(G.score);
  $('coins').textContent = G.coins;
  $('speedVal').textContent = Math.round(G.speed * 3.6);
  const box = $('powers');
  let html = '';
  if (POW.magnet > 0) html += '<div class="pow">🧲 مغناطيس <b>' + Math.ceil(POW.magnet) + '</b></div>';
  if (POW.shield > 0) html += '<div class="pow">🛡️ درع <b>' + Math.ceil(POW.shield) + '</b></div>';
  if (POW.mult > 0) html += '<div class="pow">✖️ نقاط مضاعفة <b>' + Math.ceil(POW.mult) + '</b></div>';
  if (POW.board > 0) html += '<div class="pow">🛹 لوح إنقاذ</div>';
  box.innerHTML = html;
  box.classList.toggle('hidden', !html);
}

/* main loop */
camera.position.set(0, 4.7, 8.4);
resetWorld();
updateSleepers();
G.state = 'menu';

let lastHud = 0;
function loop() {
  requestAnimationFrame(loop);
  let dt = Math.min(clock.getDelta(), 0.05);
  G.t += dt;
  if (G.state === 'play') {
    const target = Math.min(13 + G.dist * 0.014, 34);
    G.speed = lerp(G.speed, target * (G.stumble ? 0.55 : 1), dt * 0.8);
    G.pz -= G.speed * dt;
    G.dist += G.speed * dt;
    G.mult = POW.mult > 0 ? 2 : 1;
    G.score += G.speed * dt * G.mult;
    updatePlayer(dt);
    updateSleepers();
    updateEntities(dt);
    checkCollisions();
    if (P.dead && P.deathT > 1.0 && G.state === 'play') gameOver();
  } else if (G.state === 'menu') {
    // idle sway
    camera.position.x = Math.sin(G.t * 0.3) * 2;
    camera.position.y = 5 + Math.sin(G.t * 0.23) * 0.5;
    camera.position.z = G.pz + 9;
    camera.lookAt(0, 1.5, G.pz - 12);
    updatePlayer(0.0001);
  } else if (G.state === 'over' && P.dead && P.deathT < 1.2) {
    updatePlayer(dt);
  }
  if (G.state === 'play' || G.state === 'menu' || G.state === 'over' || G.state === 'countdown') {
    updateAmbient(dt);
    if (G.state === 'play') { updateCamera(dt); if (G.t - lastHud > 0.1) { lastHud = G.t; updateHUD(); } }
  }
  if (WEBGL_OK) renderer.render(scene, camera);
}
loop();
