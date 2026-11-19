// ProtoLab Studio · Módulo de mejoras v7 (bloom, detalles de placas, sonido, cámara, plantillas)
const P = window.__PL, T = P.THREE, canvas = document.querySelector('#scene');
const wrap = document.querySelector('#sceneWrap') || canvas.parentElement;
const $on = (el, ev, fn) => el && el.addEventListener(ev, fn);
let last = performance.now(), fx = true, shot = false, composer = null, bloom = null, fxSize = '';

/* ---------- Estilos ---------- */
const css = document.createElement('style');
css.textContent = `.plx-bar{position:absolute;left:12px;bottom:12px;display:flex;gap:5px;z-index:7;flex-wrap:wrap;max-width:75%}
.plx-btn{border:1px solid #2b4966;background:#0d1e33dd;color:#bfe9f2;border-radius:7px;padding:6px 9px;font-size:10px;backdrop-filter:blur(6px);transition:.15s}
.plx-btn:hover{background:#17405a;border-color:#56d6e8;transform:translateY(-1px)}.plx-btn.off{opacity:.5}
.plx-tip{position:fixed;pointer-events:none;z-index:50;background:#06121fee;border:1px solid #56d6e8;color:#dff8ff;padding:5px 9px;border-radius:6px;font-size:10px;display:none;box-shadow:0 4px 18px #0008}
.plx-pop{position:absolute;left:12px;bottom:56px;z-index:8;background:#0b1829f2;border:1px solid #2b4966;border-radius:10px;padding:10px;display:none;min-width:230px;backdrop-filter:blur(8px)}
.plx-pop b{font-size:10px;letter-spacing:1px;color:#56d6e8}.plx-pop button{display:block;width:100%;margin-top:6px;text-align:left}`;
document.head.appendChild(css);

/* ---------- Sonido (Web Audio propio) ---------- */
let ac = null, master = null, soundOn = true, humOsc = null, humGain = null;
function actx() { if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ac = new A(); master = ac.createGain(); master.gain.value = .6; master.connect(ac.destination); } if (ac.state === 'suspended') ac.resume(); return ac; }
function tone(f, d = .1, type = 'sine', v = .07, slide = 0, delay = 0) {
  if (!soundOn) return; const a = actx(); if (!a) return; const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + d + .03);
}
const sfx = {
  place: () => { tone(420, .09, 'triangle', .08, 300); tone(880, .06, 'sine', .04, 0, .05); },
  wire: () => { tone(660, .07, 'square', .035); tone(990, .09, 'square', .03, 0, .07); },
  remove: () => tone(500, .18, 'sawtooth', .04, -380),
  select: () => tone(1200, .03, 'sine', .035),
  run: () => [392, 523, 659, 784].forEach((f, i) => tone(f, .12, 'triangle', .06, 0, i * .07)),
  stop: () => [659, 523, 392].forEach((f, i) => tone(f, .12, 'triangle', .05, 0, i * .07)),
  big: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .2, 'sine', .05, 0, i * .06))
};
function hum(on) {
  const a = actx(); if (!a || !soundOn) { if (humGain) humGain.gain.value = 0; return; }
  if (!humOsc) { humOsc = a.createOscillator(); humGain = a.createGain(); humOsc.type = 'sawtooth'; humOsc.frequency.value = 58; const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160; humGain.gain.value = 0; humOsc.connect(f); f.connect(humGain); humGain.connect(master); humOsc.start(); }
  humGain.gain.setTargetAtTime(on ? .012 : 0, a.currentTime, .25);
}
['pointerdown', 'keydown'].forEach(e => window.addEventListener(e, () => { if (soundOn) actx(); }, { once: true }));
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.classList.contains('plx-btn')) return;
  if (/run|ejecut/i.test(b.id + b.textContent)) sfx.run(); else if (/stop|deten/i.test(b.id + b.textContent)) sfx.stop(); else tone(1000, .03, 'sine', .025);
}, true);

/* ---------- Cámara: presets, giro, temas ---------- */
const views = { iso: [9.4, 10.8, 12.2], top: [.01, 17, .01], front: [0, 5, 15], side: [-14, 6, 1] };
let camAnim = null;
function goView(k) { const c = P.camera; camAnim = { from: c.position.clone(), to: new T.Vector3(...views[k]), tf: P.controls.target.clone(), tt: new T.Vector3(0, .2, 0), t: 0 }; tone(700, .08, 'sine', .04, 200); }
const themes = [
  { n: 'Laboratorio', bg: 0x0b1725, rim: 0x2b9bbf, ex: 1.12 },
  { n: 'Neón', bg: 0x080519, rim: 0xd23cff, ex: 1.3 },
  { n: 'Taller cálido', bg: 0x1a120c, rim: 0xff8a3c, ex: 1.05 },
  { n: 'Bosque', bg: 0x07160f, rim: 0x3cff9a, ex: 1.15 }
];
let themeIdx = 0;
function nextTheme() {
  themeIdx = (themeIdx + 1) % themes.length; const th = themes[themeIdx];
  P.scene.background.setHex(th.bg); P.scene.fog.color.setHex(th.bg); P.renderer.toneMappingExposure = th.ex;
  P.scene.children.forEach(o => { if (o.isPointLight && o.distance === 20) o.color.setHex(th.rim); });
  P.notify('Ambiente: ' + th.n); sfx.big();
}

/* ---------- Partículas ambientales ---------- */
const N = 220, pos = new Float32Array(N * 3);
for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - .5) * 15; pos[i * 3 + 1] = .4 + Math.random() * 6; pos[i * 3 + 2] = (Math.random() - .5) * 9; }
const dust = new T.Points(new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(pos, 3)),
  new T.PointsMaterial({ size: .05, color: 0x7fdfff, transparent: true, opacity: .45, depthWrite: false, blending: T.AdditiveBlending }));
P.scene.add(dust);

/* ---------- Detalles de placas y sombras de contacto ---------- */
function labelTex(text, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0)'; x.clearRect(0, 0, 512, 128); x.fillStyle = '#e9f6ee'; x.font = 'bold 44px monospace'; x.textAlign = 'center'; x.fillText(text, 256, 58);
  x.font = '22px monospace'; x.fillStyle = '#9fd8c0'; x.fillText(sub, 256, 100); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 4, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,.65)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c); })();
const pwrLights = [];
function decorateBoard(b) {
  const g = b.group, w = b.width, d = b.depth, y = .147, gold = new T.MeshStandardMaterial({ color: 0xc9a24a, roughness: .35, metalness: .85 });
  const dark = new T.MeshStandardMaterial({ color: 0x080c10, roughness: .6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - .14), z = sz * (d / 2 - .14);
    const ring = new T.Mesh(new T.CylinderGeometry(.1, .1, .006, 24), gold); ring.position.set(x, y, z); g.add(ring);
    const hole = new T.Mesh(new T.CylinderGeometry(.062, .062, .008, 24), dark); hole.position.set(x, y + .002, z); g.add(hole);
  }
  for (let i = 0; i < 7; i++) {
    const len = w * (.25 + ((i * 37) % 10) / 40), z = -d * .3 + i * d * .1, x = -w * .12 + ((i * 53) % 7 - 3) * .07;
    const tr = new T.Mesh(new T.BoxGeometry(len, .004, .016), gold); tr.position.set(x, y, z); g.add(tr);
    const via = new T.Mesh(new T.CylinderGeometry(.028, .028, .006, 12), gold); via.position.set(x + len / 2, y, z); g.add(via);
  }
  const lab = new T.Mesh(new T.PlaneGeometry(w * .5, w * .125), new T.MeshBasicMaterial({ map: labelTex(b.name.length > 20 ? b.name.slice(0, 20) : b.name, 'ProtoLab · ' + b.type), transparent: true, depthWrite: false }));
  lab.rotation.x = -Math.PI / 2; lab.position.set(w * .12, y + .003, -d * .12); g.add(lab);
  const led = new T.Mesh(new T.BoxGeometry(.1, .04, .07), new T.MeshStandardMaterial({ color: 0x1fd27a, emissive: 0x39ff9a, emissiveIntensity: 2 }));
  led.position.set(w / 2 - .4, y + .02, d / 2 - .38); g.add(led);
  const pl = new T.PointLight(0x39ff9a, .5, 1.4); pl.position.copy(led.position).y += .15; g.add(pl); pwrLights.push(pl);
}
function addContactShadow(c) {
  try {
    const s = new T.Box3().setFromObject(c.group).getSize(new T.Vector3());
    const m = new T.Mesh(new T.PlaneGeometry(Math.max(.6, s.x * 1.35), Math.max(.6, s.z * 1.35)), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: .8 }));
    m.rotation.x = -Math.PI / 2; m.position.y = .022 - c.group.position.y; m.renderOrder = -1; c.group.add(m);
  } catch (_) { }
}

/* ---------- Tooltip al pasar el ratón ---------- */
const tip = document.createElement('div'); tip.className = 'plx-tip'; document.body.appendChild(tip);
const ray = new T.Raycaster(), mp = new T.Vector2(); let lastHover = 0;
$on(canvas, 'pointermove', e => {
  const now = performance.now(); if (now - lastHover < 50 || e.buttons) { if (e.buttons) tip.style.display = 'none'; return; } lastHover = now;
  const r = canvas.getBoundingClientRect(); mp.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mp, P.camera); const hit = ray.intersectObjects(P.interactables, false)[0]; let txt = '';
  if (hit) {
    const o = hit.object;
    if (o.userData?.isPin) { const p = P.pinMap.get(o.userData.pinId); txt = p ? `📍 ${p.owner?.name || 'Protoboard'} · <b>${p.name}</b>` : ''; }
    else { const c = P.components.find(c => { let n = o; while (n) { if (n === c.group) return true; n = n.parent; } return false; }); if (c) txt = `🔧 <b>${c.name || c.type}</b>`; }
  }
  if (txt) { tip.innerHTML = txt; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px'; tip.style.display = 'block'; } else tip.style.display = 'none';
});
$on(canvas, 'pointerleave', () => tip.style.display = 'none');

/* ---------- Plantillas de circuito (creación rápida) ---------- */
function setCode(code) { P.editor.value = code; P.editor.dispatchEvent(new Event('input', { bubbles: true })); try { P.updateLineNumbers(); } catch (_) { } }
function leds(types, pins, code, name) {
  const b = P.activeBoard(); if (!b) return P.notify('Primero coloca una placa Arduino UNO');
  const names = pins.map(p => b.pinNames[p]); if (names.some(n => !n) || !b.pinNames.GND) return P.notify('Esta plantilla requiere una placa tipo Arduino UNO (pines D8-D11)');
  const base = P.components.length;
  types.forEach((t, i) => {
    const z = .7 + i * .95, r = P.addPart('resistor', 1.4, z, { quiet: true, value: 220 }), l = P.addPart(t, 3.0, z, { quiet: true });
    P.connectPins(names[i], r.pins[0], '#ef5555'); P.connectPins(r.pins[1], l.pins[0], '#e8bd52'); P.connectPins(l.pins[1], b.pinNames.GND, '#303d50');
  });
  setCode(code); P.updateInventory(); P.updateCircuit(); P.notify(`Plantilla «${name}» creada. Pulsa Ejecutar.`); sfx.big();
}
const w = (p, v) => `digitalWrite(${p}, ${v});`;
const templates = {
  'Semáforo': () => leds(['led', 'ledAmber', 'ledGreen'], ['D8', 'D9', 'D10'], `void setup() {\n  pinMode(8, OUTPUT);\n  pinMode(9, OUTPUT);\n  pinMode(10, OUTPUT);\n}\n\nvoid loop() {\n  ${w(8, 'HIGH')}\n  delay(1500);\n  ${w(8, 'LOW')}\n  ${w(10, 'HIGH')}\n  delay(1500);\n  ${w(10, 'LOW')}\n  ${w(9, 'HIGH')}\n  delay(600);\n  ${w(9, 'LOW')}\n}\n`, 'Semáforo'),
  'Luces secuenciales': () => leds(['led', 'ledAmber', 'ledGreen', 'ledBlue'], ['D8', 'D9', 'D10', 'D11'], `void setup() {\n  pinMode(8, OUTPUT);\n  pinMode(9, OUTPUT);\n  pinMode(10, OUTPUT);\n  pinMode(11, OUTPUT);\n}\n\nvoid loop() {\n${[8, 9, 10, 11, 10, 9].map(p => `  ${w(p, 'HIGH')}\n  delay(120);\n  ${w(p, 'LOW')}`).join('\n')}\n}\n`, 'Luces secuenciales'),
  'LED alterno': () => leds(['led', 'ledBlue'], ['D8', 'D9'], `void setup() {\n  pinMode(8, OUTPUT);\n  pinMode(9, OUTPUT);\n}\n\nvoid loop() {\n  ${w(8, 'HIGH')}\n  ${w(9, 'LOW')}\n  delay(400);\n  ${w(8, 'LOW')}\n  ${w(9, 'HIGH')}\n  delay(400);\n}\n`, 'LED alterno')
};
const pop = document.createElement('div'); pop.className = 'plx-pop'; pop.innerHTML = '<b>PLANTILLAS RÁPIDAS</b>';
Object.keys(templates).forEach(k => { const b = document.createElement('button'); b.className = 'plx-btn'; b.textContent = '⚡ ' + k; b.onclick = () => { pop.style.display = 'none'; templates[k](); }; pop.appendChild(b); });
wrap.appendChild(pop);

/* ---------- Barra de herramientas ---------- */
const bar = document.createElement('div'); bar.className = 'plx-bar';
function btn(label, title, fn) { const b = document.createElement('button'); b.className = 'plx-btn'; b.textContent = label; b.title = title; b.onclick = () => fn(b); bar.appendChild(b); return b; }
btn('✨ Bloom', 'Brillo cinematográfico (B)', b => { fx = !fx; b.classList.toggle('off', !fx); tone(fx ? 900 : 500, .08); });
btn('🔊 Sonido', 'Efectos de sonido', b => { soundOn = !soundOn; b.classList.toggle('off', !soundOn); if (!soundOn) hum(false); else sfx.select(); });
btn('🎥 Giro', 'Giro automático', b => { P.controls.autoRotate = !P.controls.autoRotate; P.controls.autoRotateSpeed = .9; b.classList.toggle('off', !P.controls.autoRotate); });
btn('🌗 Ambiente', 'Cambiar ambiente', nextTheme);
btn('⬆ Planta', 'Vista superior (2)', () => goView('top'));
btn('◧ Frente', 'Vista frontal (3)', () => goView('front'));
btn('◈ Iso', 'Vista isométrica (1)', () => goView('iso'));
btn('📸 Captura', 'Guardar imagen PNG (K)', () => { shot = true; });
btn('🧩 Plantillas', 'Crear circuitos de ejemplo', () => { pop.style.display = pop.style.display === 'block' ? 'none' : 'block'; });
wrap.appendChild(bar);
window.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === '1') goView('iso'); else if (k === '2') goView('top'); else if (k === '3') goView('front'); else if (k === '4') goView('side');
  else if (k === 'b') bar.children[0].click(); else if (k === 'k') shot = true;
});

/* ---------- Bloom (post-proceso) con respaldo seguro ---------- */
(async () => {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js')]);
    composer = new EffectComposer(P.renderer); composer.addPass(new RenderPass(P.scene, P.camera));
    bloom = new UnrealBloomPass(new T.Vector2(512, 512), .32, .55, .9); composer.addPass(bloom); composer.addPass(new OutputPass());
  } catch (err) { console.warn('Bloom no disponible; se usa render normal.', err); composer = null; }
})();

/* ---------- Bucle por fotograma (llamado desde animate) ---------- */
let prev = { c: P.components.length, w: P.wires.length, run: P.running, sel: P.selected };
window.__PL_RENDER = () => {
  const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now; const t = now * .001;
  try {
    const a = dust.geometry.attributes.position; for (let i = 0; i < N; i++) { a.array[i * 3 + 1] += dt * (.12 + (i % 5) * .03); a.array[i * 3] += Math.sin(t + i) * dt * .05; if (a.array[i * 3 + 1] > 6.5) a.array[i * 3 + 1] = .4; } a.needsUpdate = true;
    P.boards.forEach(b => { if (b.group && !b.__deco && b.type !== 'breadboard') { b.__deco = true; try { decorateBoard(b); } catch (e) { console.warn(e); } } });
    P.components.forEach(c => { if (c.group && !c.__sh) { c.__sh = true; addContactShadow(c); } });
    pwrLights.forEach((l, i) => l.intensity = .45 + Math.sin(t * 2 + i) * .15);
    if (camAnim) { camAnim.t = Math.min(1, camAnim.t + dt * 1.6); const k = 1 - Math.pow(1 - camAnim.t, 3); P.camera.position.lerpVectors(camAnim.from, camAnim.to, k); P.controls.target.lerpVectors(camAnim.tf, camAnim.tt, k); if (camAnim.t >= 1) camAnim = null; }
    const nc = P.components.length, nw = P.wires.length;
    if (nc !== prev.c) { (nc > prev.c ? sfx.place : sfx.remove)(); prev.c = nc; }
    if (nw !== prev.w) { (nw > prev.w ? sfx.wire : sfx.remove)(); prev.w = nw; }
    if (P.selected !== prev.sel) { if (P.selected) sfx.select(); prev.sel = P.selected; }
    if (P.running !== prev.run) { hum(!!P.running); prev.run = P.running; }
  } catch (e) { console.warn('plx tick', e); }
  const r = P.renderer;
  if (fx && composer) {
    const s = r.getSize(new T.Vector2()), key = s.x + 'x' + s.y; if (key !== fxSize) { fxSize = key; composer.setPixelRatio(r.getPixelRatio()); composer.setSize(s.x, s.y); }
    composer.render();
  } else r.render(P.scene, P.camera);
  if (shot) { shot = false; canvas.toBlob(b => { if (!b) return; const u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = 'protolab-captura.png'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); P.notify('📸 Captura guardada'); }); }
};
P.notify('✨ Mejoras v7 activas: bloom, sonido, plantillas y vistas de cámara');
