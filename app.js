import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ProtoLab Studio: visual 3D workbench + educational Arduino API interpreter.
const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const statusText = $('#engineStatus');
const loadingOverlay = $('#loadingOverlay');
const toastEl = $('#toast');
const editor = $('#codeEditor');
const SERIAL_LIMIT = 160;

let scene, camera, renderer, controls, workSurface, breadboard;
let raycaster, pointer, groundPlane;
let libraryMode = null, wireMode = false, wireStart = null, selectedObject = null;
let serialId = 1, boardSerial = 1, wireSerial = 1;
let breadboardGroups = [], breadboardHoleIds = [], breadboardHitMesh = null, breadboardRailHitMesh = null;
let components = [], boards = [], wires = [], interactables = [], pinMap = new Map();
let running = false, runToken = 0, currentLoopRate = 0, loopCounter = 0, lastLoopTime = 0, activeBoardId = 'uno-main';
let outputs = new Map(), analogOutputs = new Map(), pinModes = new Map();
let serialLines = [], screenTargets = [], matrixTargets = [], servoTargets = [], buttonTargets = [];
let showGrid = true, draggingObject = null, dragOffset = new THREE.Vector3(), audioContext = null, buzzerOscillator = null, buzzerGain = null;
const materials = {};
const examples = {
  blink: `// Parpadeo de un LED conectado al pin D13
const int ledPin = 13;

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(ledPin, HIGH);
  Serial.println("LED ENCENDIDO");
  delay(500);
  digitalWrite(ledPin, LOW);
  Serial.println("LED APAGADO");
  delay(500);
}`,
  fade: `// Brillo variable por PWM (pin 9 en Arduino UNO)
const int ledPin = 9;

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  analogWrite(ledPin, 255);
  Serial.println("PWM: 255");
  delay(700);
  analogWrite(ledPin, 80);
  Serial.println("PWM: 80");
  delay(700);
  analogWrite(ledPin, 0);
  Serial.println("PWM: 0");
  delay(700);
}`,
  lcd: `// Texto de prueba en una pantalla LCD 16x2
// Agrega un LCD 16x2 desde la biblioteca.
#include <LiquidCrystal_I2C.h>

void setup() {
  Serial.begin(9600);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Hola, ProtoLab!");
  lcd.setCursor(0, 1);
  lcd.print("Arduino + LCD");
}

void loop() {
  Serial.println("Pantalla actualizada");
  delay(1000);
}`,
  matrix: `// Animación sencilla de una matriz LED 8x8
// Agrega una Matriz LED 8x8 desde la biblioteca.
void setup() {
  Serial.begin(9600);
  matrix.clear();
}

void loop() {
  matrix.setLed(0, 3, 3, true);
  matrix.setLed(0, 3, 4, true);
  matrix.setLed(0, 4, 3, true);
  matrix.setLed(0, 4, 4, true);
  Serial.println("Patron: centro");
  delay(600);
  matrix.clear();
  matrix.setLed(0, 1, 1, true);
  matrix.setLed(0, 1, 6, true);
  matrix.setLed(0, 6, 1, true);
  matrix.setLed(0, 6, 6, true);
  Serial.println("Patron: esquinas");
  delay(600);
  matrix.clear();
}`,
  servo: `// Movimiento de un microservo
// Agrega un Servo motor desde la biblioteca.
#include <Servo.h>
Servo miServo;

void setup() {
  Serial.begin(9600);
  miServo.attach(9);
}

void loop() {
  miServo.write(0);
  Serial.println("Servo: 0 grados");
  delay(700);
  miServo.write(90);
  Serial.println("Servo: 90 grados");
  delay(700);
  miServo.write(180);
  Serial.println("Servo: 180 grados");
  delay(700);
}`,
  button: `// Presiona el boton virtual para encender el LED
const int buttonPin = 2;
const int ledPin = 13;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(buttonPin) == LOW) {
    digitalWrite(ledPin, HIGH);
    Serial.println("Boton presionado");
  } else {
    digitalWrite(ledPin, LOW);
  }
  delay(80);
}`,
  pot: `// Lee un potenciometro en la entrada A0
const int potPin = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int valor = analogRead(potPin);
  Serial.println(valor);
  delay(250);
}`,
  oled: `// Mensaje en pantalla OLED I2C
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

void setup() {
  display.begin();
  display.clearDisplay();
  display.setCursor(0, 0);
  display.print("ProtoLab OLED");
  display.display();
  Serial.begin(9600);
}

void loop() {
  Serial.println("OLED listo");
  delay(1000);
}`,
  buzzer: `// Genera un tono en el zumbador virtual
const int buzzerPin = 8;

void setup() {
  Serial.begin(9600);
}

void loop() {
  tone(buzzerPin, 440);
  Serial.println("Tono 440 Hz");
  delay(500);
  noTone(buzzerPin);
  delay(500);
}`,
  esp32: `// ESP32: alterna el LED integrado (GPIO 2)
const int ledPin = 2;

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(ledPin, HIGH);
  Serial.println("GPIO 2 HIGH");
  delay(500);
  digitalWrite(ledPin, LOW);
  Serial.println("GPIO 2 LOW");
  delay(500);
}`
};

function notify(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}
function setStatus(text, color = '#66cfa4') {
  const node = $('#compileStatus');
  node.textContent = text;
  node.style.color = color;
}
function logSerial(message) {
  const stamp = new Date().toLocaleTimeString('es-MX', { hour12: false });
  serialLines.push(`[${stamp}] ${String(message)}`);
  serialLines = serialLines.slice(-SERIAL_LIMIT);
  $('#serialOutput').textContent = serialLines.join('\n');
  $('#serialOutput').scrollTop = $('#serialOutput').scrollHeight;
}
function clearSerial() {
  serialLines = [];
  $('#serialOutput').textContent = '[ProtoLab] Monitor serial limpio.';
}
function baseMat(color, roughness = .5, metalness = .04, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}
function makeMesh(geometry, material, parent, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function makeLabel(text, color = '#d9eadf', bg = 'rgba(7,20,29,.92)', w = 256, h = 72) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(.52, .15, 1);
  return sprite;
}
function makeScreenTexture(type) {
  const c = document.createElement('canvas'); c.width = type === 'matrix' ? 256 : type === 'segment' ? 200 : type === 'oled' ? 256 : 320; c.height = type === 'matrix' ? 256 : 128;
  const ctx = c.getContext('2d');
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  const target = { type, canvas: c, ctx, texture, lines: ['', ''], pixels: Array.from({ length: 8 }, () => Array(8).fill(false)), angle: 0 };
  renderScreen(target);
  return target;
}
function renderScreen(target) {
  const { ctx, canvas: c, type } = target;
  ctx.clearRect(0, 0, c.width, c.height);
  if (type === 'lcd') {
    ctx.fillStyle = '#102c2b'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#9de7ad'; ctx.shadowColor = '#8bffaa'; ctx.shadowBlur = 5; ctx.font = 'bold 23px monospace';
    (target.lines || ['', '']).slice(0, 2).forEach((line, i) => ctx.fillText(String(line).slice(0, 16), 12, 44 + i * 52)); ctx.shadowBlur = 0;
  } else if (type === 'oled') {
    ctx.fillStyle = '#03070d'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#8be6ff'; ctx.shadowColor = '#4dbbff'; ctx.shadowBlur = 8; ctx.font = 'bold 22px monospace';
    (target.lines || ['', '']).slice(0, 4).forEach((line, i) => ctx.fillText(String(line).slice(0, 21), 8, 29 + i * 29)); ctx.shadowBlur = 0;
  } else if (type === 'matrix') {
    ctx.fillStyle = '#07131d'; ctx.fillRect(0, 0, c.width, c.height);
    const cell = 28, gap = 4, start = 12;
    for (let r = 0; r < 8; r++) for (let col = 0; col < 8; col++) {
      const on = target.pixels[r][col]; ctx.beginPath(); ctx.arc(start + col * (cell + gap) + cell / 2, start + r * (cell + gap) + cell / 2, cell * .34, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#ff5c66' : '#39252e'; ctx.shadowColor = on ? '#ff3b52' : 'transparent'; ctx.shadowBlur = on ? 12 : 0; ctx.fill();
    } ctx.shadowBlur = 0;
  } else if (type === 'segment') {
    ctx.fillStyle = '#100e13'; ctx.fillRect(0, 0, c.width, c.height);
    const on = target.value ?? 0; const patterns = [[1,1,1,1,1,1,0],[0,1,1,0,0,0,0],[1,1,0,1,1,0,1],[1,1,1,1,0,0,1],[0,1,1,0,0,1,1],[1,0,1,1,0,1,1],[1,0,1,1,1,1,1],[1,1,1,0,0,0,0],[1,1,1,1,1,1,1],[1,1,1,1,0,1,1]];
    const p = patterns[((on % 10) + 10) % 10]; const segs = [[58,14,84,12],[145,22,12,42],[145,75,12,42],[58,116,84,12],[43,75,12,42],[43,22,12,42],[58,65,84,12]];
    ctx.shadowColor = '#ff3947'; ctx.shadowBlur = 10;
    segs.forEach((s, i) => { ctx.fillStyle = p[i] ? '#ff505b' : '#392329'; ctx.fillRect(...s); }); ctx.shadowBlur = 0;
  }
  target.texture.needsUpdate = true;
}

function initScene() {
  try {
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1725); scene.fog = new THREE.Fog(0x0b1725, 19, 36);
    camera = new THREE.PerspectiveCamera(39, 1, .1, 100); camera.position.set(9.4, 10.8, 12.2);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, .2, 0); controls.enableDamping = true; controls.dampingFactor = .065; controls.maxPolarAngle = Math.PI * .49; controls.minDistance = 6; controls.maxDistance = 24;
    scene.add(new THREE.HemisphereLight(0xd6eaff, 0x263044, 2.05));
    const key = new THREE.DirectionalLight(0xfff4dd, 3.2); key.position.set(-5, 12, 7); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -12; key.shadow.camera.right = 12; key.shadow.camera.top = 12; key.shadow.camera.bottom = -12; key.shadow.bias = -.0003; scene.add(key);
    const fill = new THREE.DirectionalLight(0x76b9f5, 1.2); fill.position.set(8, 7, -7); scene.add(fill);
    const rim = new THREE.PointLight(0x2b9bbf, 34, 20); rim.position.set(0, 5, 3); scene.add(rim);
    const floor = makeMesh(new THREE.BoxGeometry(15.5, .22, 9.2), baseMat(0x25364a, .7), scene, [0, -.13, 0]); floor.receiveShadow = true;
    // Dark workbench edge and subtle metallic corner caps.
    makeMesh(new THREE.BoxGeometry(15.65, .08, 9.35), baseMat(0x0b1521, .36, .55), scene, [0, -.27, 0]);
    workSurface = makeMesh(new THREE.BoxGeometry(14.6, .025, 8.4), baseMat(0x344358, .72), scene, [0, -.003, 0]);
    const grid = new THREE.GridHelper(14.4, 72, 0x47637b, 0x34495e); grid.position.y = .012; (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(m => { m.transparent = true; m.opacity = .22; }); scene.add(grid); grid.userData.isGrid = true;
    groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.16);
    raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2();
    createBreadboard();
    window.addEventListener('resize', resizeScene); resizeScene();
    renderer.setAnimationLoop(animate);
    statusText.textContent = 'MOTOR 3D ACTIVO';
    loadingOverlay.classList.add('done');
  } catch (error) {
    console.error(error); statusText.textContent = 'ERROR AL INICIAR';
    loadingOverlay.innerHTML = `<b>No se pudo iniciar el motor 3D</b><small>${escapeHTML(error.message || 'Comprueba WebGL y la conexión a Internet.')}</small>`;
  }
}
function resizeScene() {
  if (!renderer || !camera) return;
  const rect = canvas.getBoundingClientRect(); const w = Math.max(320, rect.width); const h = Math.max(260, rect.height);
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
function animate() {
  if (!renderer) return;
  controls.update();
  const t = performance.now() * .001;
  components.forEach(c => {
    if ((c.type === 'led' || c.type === 'rgb') && c.userData.light && c.active) c.userData.light.intensity = 1.8 + Math.sin(t * 7) * .22;
    if (c.type === 'servo' && c.userData.servoArm) { const target = THREE.MathUtils.degToRad((c.userData.servo ?? 90) - 90); c.userData.servoArm.rotation.y += (target-c.userData.servoArm.rotation.y)*.13; }
    if (c.type === 'buzzer' && c.userData.membrane) c.userData.membrane.position.y = .475 + (c.userData.sound ? Math.sin(t*(c.userData.frequency||440)*.04)*.018 : 0);
  });
  wires.forEach(w => { if(w.mesh.material?.emissive) w.mesh.material.emissiveIntensity = w.active ? .38 + Math.sin(t*8)*.18 : .02; if(w.particle){w.particle.visible=!!w.active;if(w.active&&w.curve)w.particle.position.copy(w.curve.getPoint((t*.65)%1));} });
  renderer.render(scene, camera);
}
function createBreadboard() {
  const group = new THREE.Group(); group.position.set(2.65, .18, 0); scene.add(group); breadboard = group;
  const breadboardOwner = { id: 'breadboard-main', name: 'Protoboard 830 puntos', type: 'breadboard', pins: [], pinNames: {} };
  boards.push(breadboardOwner);
  const whitePlastic = baseMat(0xe5e8e4, .54); const side = baseMat(0xc4ccc8, .64); const recess = baseMat(0x9da9a7, .84);
  makeMesh(new THREE.BoxGeometry(5.55, .28, 4.55), whitePlastic, group, [0, 0, 0]);
  makeMesh(new THREE.BoxGeometry(5.57, .09, 4.57), side, group, [0, -.17, 0]);
  makeMesh(new THREE.BoxGeometry(5.28, .025, .22), recess, group, [0, .151, 0]);
  const holeDark = baseMat(0x29373a, .8, .15), rimMat = baseMat(0xf9faf7, .4, .1);
  const rows = [-1.78, -1.60, -1.42, -1.24, -1.06, 1.06, 1.24, 1.42, 1.60, 1.78];
  const holePositions = [], holeIds = [], rimPositions = [];
  for (let col = 0; col < 26; col++) {
    const x = -2.43 + col * .194;
    for (let row = 0; row < rows.length; row++) {
      const z = rows[row], id = `bb:${row < 5 ? 'top' : 'bottom'}:${col}:${row % 5}`;
      holePositions.push([x, .163, z]); rimPositions.push([x, .15, z]); holeIds.push(id);
      const world = group.localToWorld(new THREE.Vector3(x, .176, z));
      pinMap.set(id, { id, owner: breadboardOwner, name: `${row < 5 ? 'A-E' : 'F-J'} · columna ${col + 1}`, world, mesh: null, isBreadboard: true });
      breadboardOwner.pins.push(id); breadboardHoleIds.push(id);
    }
    // Five sockets in each half of a numbered breadboard column share one electrical node.
    breadboardGroups.push(Array.from({ length: 5 }, (_, r) => `bb:top:${col}:${r}`));
    breadboardGroups.push(Array.from({ length: 5 }, (_, r) => `bb:bottom:${col}:${r}`));
  }
  const rimInstances = new THREE.InstancedMesh(new THREE.CylinderGeometry(.047, .047, .018, 14), rimMat, rimPositions.length);
  const holeInstances = new THREE.InstancedMesh(new THREE.CylinderGeometry(.028, .028, .02, 12), holeDark, holePositions.length);
  const dummy = new THREE.Object3D();
  rimPositions.forEach((p, i) => { dummy.position.set(...p); dummy.updateMatrix(); rimInstances.setMatrixAt(i, dummy.matrix); });
  holePositions.forEach((p, i) => { dummy.position.set(...p); dummy.updateMatrix(); holeInstances.setMatrixAt(i, dummy.matrix); });
  rimInstances.instanceMatrix.needsUpdate = true; holeInstances.instanceMatrix.needsUpdate = true;
  group.add(rimInstances, holeInstances); breadboardHitMesh = holeInstances; breadboardHitMesh.userData.isBreadboardHole = true; breadboardHitMesh.userData.instancePins = holeIds;
  interactables.push(holeInstances);
  const railPositions = [], railIds = [], railLabels = [];
  for (const z of [-2.02, -1.91, 1.91, 2.02]) {
    const color = Math.abs(z) > 1.97 ? 0xd95559 : 0x4d88cf;
    makeMesh(new THREE.BoxGeometry(5.35, .018, .026), baseMat(color, .45), group, [0, .15, z]);
    const sideName = z < 0 ? 'upper' : 'lower'; const polarity = Math.abs(z) > 1.97 ? 'positive' : 'negative';
    const groupIds = [];
    for (let col = 0; col < 25; col++) {
      const x = -2.36 + col * .197; const id = `bb:rail:${sideName}:${polarity}:${col}`;
      railPositions.push([x, .16, z]); railIds.push(id); groupIds.push(id);
      const world = group.localToWorld(new THREE.Vector3(x, .176, z)); pinMap.set(id, { id, owner: breadboardOwner, name: `${polarity === 'positive' ? '+' : '−'} riel ${sideName} ${col + 1}`, world, mesh: null, isBreadboard: true });
      breadboardOwner.pins.push(id); breadboardHoleIds.push(id);
    }
    breadboardGroups.push(groupIds);
    railLabels.push({ z: z + (z < 0 ? -.035 : .035), color: polarity === 'positive' ? '#cf5a60' : '#4e89cf', sign: polarity === 'positive' ? '+' : '−' });
  }
  const railInstances = new THREE.InstancedMesh(new THREE.CylinderGeometry(.028, .028, .018, 10), holeDark, railPositions.length);
  railPositions.forEach((p, i) => { dummy.position.set(...p); dummy.updateMatrix(); railInstances.setMatrixAt(i, dummy.matrix); });
  railInstances.instanceMatrix.needsUpdate = true; group.add(railInstances); railInstances.userData.isBreadboardHole = true; railInstances.userData.instancePins = railIds; breadboardRailHitMesh = railInstances; interactables.push(railInstances);
  for (const labelInfo of railLabels) {
    const railLabel = makeLabel(labelInfo.sign, labelInfo.color, 'rgba(235,239,234,.92)', 64, 64); railLabel.position.set(-2.67, .17, labelInfo.z); railLabel.scale.set(.13, .13, 1); group.add(railLabel);
  }
  const brand = makeLabel('PROTOBOARD 830', '#65746e', 'rgba(235,239,234,.95)', 360, 64); brand.position.set(0, .17, 2.17); brand.scale.set(1.35, .24, 1); group.add(brand);
  for (const x of [-2.62, 2.62]) for (const z of [-2.12, 2.12]) makeMesh(new THREE.BoxGeometry(.19, .06, .24), side, group, [x, -.17, z]);
}
function addPin(parent, owner, pinName, localPosition, radius = .064) {
  const id = `${owner.id}:${pinName}`;
  const pinMat = baseMat(0xd7e0e4, .24, .84);
  const stem = makeMesh(new THREE.CylinderGeometry(radius * .43, radius * .43, .16, 10), pinMat, parent, localPosition);
  const cap = makeMesh(new THREE.SphereGeometry(radius, 12, 10), baseMat(0xe2bf6d, .3, .55), parent, [localPosition[0], localPosition[1] + .09, localPosition[2]]);
  cap.userData = { pinId: id, ownerId: owner.id, pinName, isPin: true }; stem.userData = cap.userData;
  interactables.push(cap, stem);
  const world = new THREE.Vector3(localPosition[0], localPosition[1] + .09, localPosition[2]); parent.localToWorld(world);
  pinMap.set(id, { id, owner, name: pinName, mesh: cap, world }); owner.pins.push(id);
  return id;
}
function addBoard(type, x, z, quiet = false, forcedId = null) {
  const group = new THREE.Group(); const id = forcedId || `board-${boardSerial++}`;
  const boardObj = { id, type, name: type === 'arduino' ? 'Arduino UNO R3' : 'ESP32 DevKit', group, pins: [], pinNames: {}, width: type === 'arduino' ? 3.65 : 2.7, depth: type === 'arduino' ? 2.5 : 1.65 };
  group.position.set(x, .03, z); group.userData.ownerId = id; group.userData.type = type; scene.add(group); boards.push(boardObj); activeBoardId = id; updateBoardSelect();
  const pcb = baseMat(type === 'arduino' ? 0x16704e : 0x152c4b, .5, .08);
  makeMesh(new THREE.BoxGeometry(boardObj.width, .16, boardObj.depth), pcb, group, [0, .06, 0]);
  // PCB edge chamfers and mounting holes.
  const holeMat = baseMat(0xd8d9d3, .3, .6), black = baseMat(0x101923, .32, .1), silver = baseMat(0xb9c5ce, .27, .78);
  for (const px of [-boardObj.width / 2 + .17, boardObj.width / 2 - .17]) for (const pz of [-boardObj.depth / 2 + .17, boardObj.depth / 2 - .17]) {
    makeMesh(new THREE.CylinderGeometry(.075, .075, .012, 16), holeMat, group, [px, .145, pz]);
    makeMesh(new THREE.CylinderGeometry(.043, .043, .016, 14), black, group, [px, .155, pz]);
  }
  if (type === 'arduino') {
    // ATmega package, USB-B connector, barrel jack, oscillator and capacitors.
    makeMesh(new THREE.BoxGeometry(.92, .25, .7), black, group, [-.05, .26, -.03]);
    makeMesh(new THREE.BoxGeometry(.56, .08, .36), baseMat(0x222d37, .35, .25), group, [-.05, .405, -.03]);
    for (let i = 0; i < 8; i++) makeMesh(new THREE.BoxGeometry(.035, .035, .06), silver, group, [-.31 + i * .075, .45, -.22]);
    makeMesh(new THREE.BoxGeometry(.64, .43, .5), silver, group, [-1.53, .24, -.46]);
    makeMesh(new THREE.BoxGeometry(.45, .22, .39), black, group, [-1.53, .25, -.46]);
    makeMesh(new THREE.CylinderGeometry(.26, .26, .42, 24), black, group, [1.48, .25, .62], [Math.PI / 2, 0, 0]);
    makeMesh(new THREE.CylinderGeometry(.16, .16, .07, 20), silver, group, [1.48, .25, .4], [Math.PI / 2, 0, 0]);
    for (const xCap of [-1.08, .75]) { makeMesh(new THREE.CylinderGeometry(.11, .11, .29, 16), baseMat(0x27323b, .4, .3), group, [xCap, .27, .52]); makeMesh(new THREE.CylinderGeometry(.1, .1, .025, 16), silver, group, [xCap, .425, .52]); }
    makeMesh(new THREE.BoxGeometry(.25, .08, .25), baseMat(0xd4bd62, .45), group, [.72, .19, -.58]);
    const usb = makeMesh(new THREE.BoxGeometry(.56, .36, .44), silver, group, [-1.54, .2, -.92]);
    makeMesh(new THREE.BoxGeometry(.36, .18, .08), black, group, [-1.54, .24, -1.14]);
    const label = makeLabel('ARDUINO  UNO', '#b7e8cb', 'rgba(13,72,52,.95)', 350, 64); label.position.set(.15, .16, .8); label.scale.set(1.1, .2, 1); group.add(label);
    const topPins = ['D0','D1','D2','D3','D4','D5','D6','D7','D8','D9','D10','D11','D12','D13'];
    topPins.forEach((name, i) => { const px = -.92 + i * .142; addPin(group, boardObj, name, [px, .26, -1.03], .055); boardObj.pinNames[name] = boardObj.pins.at(-1); makeMesh(new THREE.BoxGeometry(.09, .05, .12), black, group, [px, .16, -1.03]); });
    const bottomPins = ['IOREF','RESET','3V3','5V','GND','GND','VIN','A0','A1','A2','A3','A4','A5','SDA','SCL'];
    bottomPins.forEach((name, i) => { const px = -.99 + i * .14; addPin(group, boardObj, name, [px, .26, 1.04], .052); boardObj.pinNames[name] = boardObj.pins.at(-1); makeMesh(new THREE.BoxGeometry(.09, .05, .12), black, group, [px, .16, 1.04]); });
  } else {
    // ESP32 dev board with RF shield, antenna trace and dual pin rows.
    makeMesh(new THREE.BoxGeometry(1.08, .12, .77), baseMat(0x9aaab2, .35, .72), group, [0, .21, -.2]);
    makeMesh(new THREE.BoxGeometry(.93, .035, .63), baseMat(0x293b50, .42, .25), group, [0, .29, -.2]);
    for (let i = 0; i < 5; i++) makeMesh(new THREE.BoxGeometry(.07, .012, .42), baseMat(0xc9ae70, .32, .7), group, [-.28 + i * .14, .315, -.2]);
    makeMesh(new THREE.BoxGeometry(.78, .3, .46), black, group, [0, .25, .55]);
    makeMesh(new THREE.BoxGeometry(.64, .035, .33), baseMat(0x263c53, .4, .35), group, [0, .42, .55]);
    const led = makeMesh(new THREE.SphereGeometry(.07, 16, 12), new THREE.MeshStandardMaterial({ color: 0x4ca9e8, emissive: 0x0b243a }), group, [.78, .28, .52]); boardObj.userLed = led;
    const leftPins = ['3V3','EN','VP','VN','D34','D35','D32','D33','D25','D26','D27','D14','D12','GND','D13'];
    const rightPins = ['VIN','GND','D23','D22','TX0','RX0','D21','GND','D19','D18','D5','D17','D16','D4','D2'];
    leftPins.forEach((name, i) => { const pz = -.66 + i * .092; addPin(group, boardObj, name, [-1.12, .22, pz], .05); boardObj.pinNames[name] = boardObj.pins.at(-1); makeMesh(new THREE.BoxGeometry(.13,.04,.075), black, group, [-1.12,.14,pz]); });
    rightPins.forEach((name, i) => { const pz = -.66 + i * .092; addPin(group, boardObj, name, [1.12, .22, pz], .05); boardObj.pinNames[name] = boardObj.pins.at(-1); makeMesh(new THREE.BoxGeometry(.13,.04,.075), black, group, [1.12,.14,pz]); });
    const label = makeLabel('ESP32  DEVKIT', '#c4daf8', 'rgba(20,48,79,.96)', 350, 64); label.position.set(0,.16,.92); label.scale.set(.9,.18,1); group.add(label);
  }
  for (const child of group.children) if (child.isMesh && !child.userData.pinId) interactables.push(child);
  updateInventory();
  if (!quiet) { selectObject(boardObj); notify(`${boardObj.name} añadido`); }
  return boardObj;
}

function addPart(type, x, z, opts = {}) {
  const id = opts.id || `part-${serialId++}`;
  const onBreadboard = x > 2.65-2.78 && x < 2.65+2.78 && Math.abs(z) < 2.3;
  const group = new THREE.Group(); group.position.set(x, onBreadboard ? .34 : .02, z); scene.add(group);
  const object = { id, type, group, pins: [], name: partName(type), value: opts.value ?? defaultValue(type), active: false, selected: false, userData: {} };
  group.userData.ownerId = id; group.userData.type = type;
  const pin = (name, px, pz, y = .07, r) => addPin(group, object, name, [px, y, pz], r || .052);
  const bodyDark = baseMat(0x1d2936, .44, .2), silver = baseMat(0xc4d0d6, .26, .78), leg = baseMat(0xaebdc5, .27, .8);
  if (type === 'led' || type === 'rgb') {
    const rgb = type === 'rgb';
    const glass = new THREE.MeshPhysicalMaterial({ color: rgb ? 0x8ed5e8 : 0xff5c62, roughness: .12, transmission: .06, thickness: .6, clearcoat: 1, clearcoatRoughness: .08, emissive: rgb ? 0x00151b : 0x120000, emissiveIntensity: .1 });
    makeMesh(new THREE.CylinderGeometry(.17, .18, .09, 24), baseMat(0x222e3d, .3, .35), group, [0, .25, 0]);
    const dome = makeMesh(new THREE.SphereGeometry(rgb ? .2 : .19, 24, 18), glass, group, [0, .39, 0]); dome.scale.y = .9;
    makeMesh(new THREE.CylinderGeometry(.115, .15, .07, 20), baseMat(rgb ? 0x708d9a : 0x9c3840, .2, .18), group, [0, .3, 0]);
    if (rgb) ['R','G','B','K'].forEach((n, i) => pin(n, -.24 + i * .16, .02, .035, .045));
    else { pin('A', -.115, 0, .02, .05); pin('K', .115, 0, .02, .05); }
    const light = new THREE.PointLight(rgb ? 0x6fd9ff : 0xff3b43, 0, 2.2, 2); light.position.set(0, .6, 0); group.add(light);
    object.userData.dome = dome; object.userData.light = light; object.userData.baseColor = rgb ? 0x8ed5e8 : 0xff5c62;
  } else if (type === 'resistor') {
    makeMesh(new THREE.CylinderGeometry(.105, .105, .62, 24), baseMat(0xd6b987, .52), group, [0, .3, 0], [0,0,Math.PI/2]);
    const bands = [0x8b3b2c, 0x2d2d32, 0xd6a23c]; bands.forEach((c, i) => makeMesh(new THREE.CylinderGeometry(.11,.11,.045,24), baseMat(c,.36), group, [-.15 + i*.15,.3,0], [0,0,Math.PI/2]));
    makeMesh(new THREE.CylinderGeometry(.022,.022,.48,10), leg, group, [-.48,.11,0], [0,0,Math.PI/2]);
    makeMesh(new THREE.CylinderGeometry(.022,.022,.48,10), leg, group, [.48,.11,0], [0,0,Math.PI/2]); pin('1',-.48,0,.04,.045); pin('2',.48,0,.04,.045);
  } else if (type === 'lcd' || type === 'oled' || type === 'matrix' || type === 'segment') {
    const dims = type === 'lcd' ? [2.34,.12,1.22] : type === 'oled' ? [1.45,.12,1.18] : type === 'matrix' ? [1.45,.12,1.45] : [1.25,.12,.95];
    const pcbMat = baseMat(type === 'lcd' ? 0x14734f : 0x14253a, .48, .16);
    makeMesh(new THREE.BoxGeometry(...dims), pcbMat, group, [0,.15,0]);
    let target = makeScreenTexture(type); screenTargets.push(target);
    const screenW = type === 'lcd' ? 1.98 : type === 'oled' ? 1.05 : type === 'matrix' ? 1.1 : .75;
    const screenD = type === 'lcd' ? .72 : type === 'oled' ? .72 : type === 'matrix' ? 1.1 : .55;
    const screenMat = new THREE.MeshStandardMaterial({ map: target.texture, emissive: type === 'lcd' ? 0x173c2d : 0x061c28, emissiveIntensity: .45, roughness: .28, metalness: .1 });
    makeMesh(new THREE.BoxGeometry(screenW + .12,.035,screenD + .12), baseMat(0x111d29,.3,.25), group, [0,.23,0]);
    const screen = makeMesh(new THREE.PlaneGeometry(screenW, screenD), screenMat, group, [0,.255,0], [-Math.PI/2,0,0]);
    target.mesh = screen; object.userData.screen = target; object.userData.screenMesh = screen;
    if (type === 'lcd') ['GND','VCC','SDA','SCL'].forEach((n,i)=>pin(n,-.89+i*.19,-.55,.035,.045));
    else if (type === 'oled') ['GND','VCC','SCL','SDA'].forEach((n,i)=>pin(n,-.47+i*.2,-.54,.035,.04));
    else if (type === 'matrix') ['VCC','GND','DIN','CS','CLK'].forEach((n,i)=>pin(n,-.48+i*.22,-.68,.035,.04));
    else ['A','B','C','D','E','F','G','DP','COM'].forEach((n,i)=>pin(n,-.48+i*.12,-.47,.035,.035));
    if (type === 'segment') target.value = 0;
  } else if (type === 'button') {
    makeMesh(new THREE.BoxGeometry(.62,.18,.56), baseMat(0x202a36,.42), group, [0,.2,0]);
    const cap = makeMesh(new THREE.CylinderGeometry(.19,.2,.16,24), baseMat(0xd54a53,.28), group, [0,.37,0]); object.userData.cap = cap;
    pin('1',-.22,0,.035); pin('2',.22,0,.035);
    object.userData.pressed = false; buttonTargets.push(object);
  } else if (type === 'pot') {
    makeMesh(new THREE.CylinderGeometry(.31,.31,.16,32), baseMat(0x1b2836,.42), group, [0,.2,0]);
    const knob = makeMesh(new THREE.CylinderGeometry(.22,.24,.26,32), baseMat(0x89959b,.32,.3), group, [0,.4,0]); object.userData.knob = knob; object.userData.value = 512;
    pin('GND',-.35,.2,.035); pin('SIG',0,.2,.035); pin('VCC',.35,.2,.035);
  } else if (type === 'buzzer') {
    makeMesh(new THREE.CylinderGeometry(.3,.34,.31,32), baseMat(0x131a21,.35), group, [0,.29,0]);
    makeMesh(new THREE.CylinderGeometry(.23,.23,.025,28), baseMat(0x2d3a45,.4), group, [0,.46,0]);
    const membrane = makeMesh(new THREE.CircleGeometry(.12,24), baseMat(0x05090d,.5), group, [0,.475,0], [-Math.PI/2,0,0]);
    pin('+',-.13,0,.035); pin('-',.13,0,.035); object.userData.sound = false; object.userData.membrane = membrane;
  } else if (type === 'servo') {
    makeMesh(new THREE.BoxGeometry(.82,.55,.62), baseMat(0x2869a1,.36), group, [0,.38,0]);
    makeMesh(new THREE.BoxGeometry(.7,.1,.54), baseMat(0x1d2732,.35), group, [0,.69,0]);
    const pivot = new THREE.Group(); pivot.position.set(0,.76,0); group.add(pivot);
    makeMesh(new THREE.CylinderGeometry(.105,.105,.13,18), baseMat(0xe8e6dd,.36), pivot, [0,0,0]);
    const arm = makeMesh(new THREE.BoxGeometry(.88,.055,.12), baseMat(0xf2f0e8,.35), pivot, [.23,.08,0]); object.userData.servoArm = pivot; object.userData.servo = 90;
    pin('GND',-.28,-.4,.04); pin('5V',0,-.4,.04); pin('SIG',.28,-.4,.04);
  } else if (type === 'ultrasonic') {
    makeMesh(new THREE.BoxGeometry(1.35,.14,.74), baseMat(0x167c80,.45,.12), group, [0,.22,0]);
    for (const x of [-.38,.38]) {
      makeMesh(new THREE.CylinderGeometry(.26,.28,.18,30), silver, group, [x,.36,-.02], [Math.PI/2,0,0]);
      makeMesh(new THREE.CylinderGeometry(.21,.21,.04,30), baseMat(0x9ba8b3,.24,.72), group, [x,.36,-.15], [Math.PI/2,0,0]);
      makeMesh(new THREE.CircleGeometry(.17,28), baseMat(0x627583,.35,.55), group, [x,.36,-.174], [-Math.PI/2,0,0]);
    }
    ['VCC','TRIG','ECHO','GND'].forEach((n,i)=>pin(n,-.48+i*.32,-.31,.035,.04));
  } else if (type === 'ldr') {
    makeMesh(new THREE.CylinderGeometry(.17,.17,.16,24), baseMat(0xa6a0a0,.36), group, [0,.22,0]);
    makeMesh(new THREE.SphereGeometry(.2,20,14), baseMat(0xd9c27d,.22,.12,{emissive:0x3b3211,emissiveIntensity:.2}), group, [0,.34,0]);
    for (let i=0;i<5;i++) makeMesh(new THREE.BoxGeometry(.015,.01,.34), baseMat(0x856d43,.5), group, [0,.49,-.13+i*.065]);
    pin('1',-.16,0,.035); pin('2',.16,0,.035); object.userData.value = 640;
  } else if (type === 'capacitor') {
    makeMesh(new THREE.CylinderGeometry(.22,.22,.62,24), baseMat(0x263f78,.42), group, [0,.38,0]);
    makeMesh(new THREE.CylinderGeometry(.225,.225,.035,24), baseMat(0x929ca6,.3,.4), group, [0,.7,0]);
    pin('+',-.09,0,.035); pin('-',.09,0,.035);
  } else if (type === 'transistor') {
    makeMesh(new THREE.CylinderGeometry(.22,.25,.34,24), baseMat(0x131a21,.42), group, [0,.32,0]);
    makeMesh(new THREE.BoxGeometry(.15,.025,.05), silver, group, [0,.5,.17]);
    ['B','C','E'].forEach((n,i)=>pin(n,-.18+i*.18,0,.035));
  }
  components.push(object); for (const child of group.children) if (child.isMesh && !child.userData.isPin) interactables.push(child);
  updateInventory(); if (!opts.quiet) { selectObject(object); notify(`${object.name} añadido a la mesa`); }
  return object;
}
function partName(type) { return ({ led:'LED rojo', rgb:'LED RGB', resistor:'Resistencia', lcd:'Pantalla LCD 16×2', oled:'Pantalla OLED 128×64', matrix:'Matriz LED 8×8', segment:'Display 7 segmentos', button:'Push button', pot:'Potenciómetro', buzzer:'Zumbador', servo:'Servo motor SG90', ultrasonic:'Sensor HC-SR04', ldr:'Fotoresistencia LDR', capacitor:'Condensador', transistor:'Transistor NPN' })[type] || type; }
function defaultValue(type) { return ({ resistor:220, capacitor:'100 µF', led:'Rojo', pot:512, ldr:640, transistor:'NPN' })[type] ?? '—'; }

function pinWorld(id) { const pin = pinMap.get(id); if (!pin) return null; if (pin.isBreadboard) return pin.world.clone(); const p = new THREE.Vector3(); pin.mesh.getWorldPosition(p); return p; }
function connectPins(a, b, color) {
  if (a === b) { notify('Elige dos pines diferentes'); return; }
  if (wires.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a))) { notify('Esos pines ya están conectados'); return; }
  const start = pinWorld(a), end = pinWorld(b); if (!start || !end) { notify('No se encontró uno de los pines'); return; }
  const mid = start.clone().lerp(end, .5); mid.y += Math.min(1.1, .35 + start.distanceTo(end) * .09);
  const curve = new THREE.CatmullRomCurve3([start, mid, end]);
  const wireMat = new THREE.MeshStandardMaterial({ color, roughness: .32, metalness: .06, emissive: new THREE.Color(color).multiplyScalar(.08) });
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(20, Math.ceil(start.distanceTo(end) * 8)), .034, 8, false), wireMat);
  mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
  const particle = new THREE.Mesh(new THREE.SphereGeometry(.055,12,10),new THREE.MeshBasicMaterial({color:0xd8ffff}));particle.visible=false;scene.add(particle);
  const item = { id:`wire-${wireSerial++}`, a, b, color, mesh, curve, particle }; wires.push(item); interactables.push(mesh);
  updateInventory(); updateCircuit();
  logSerial(`Conexión creada: ${pinMap.get(a)?.name || a} ↔ ${pinMap.get(b)?.name || b}`);
  return item;
}
function removeWire(wire) { scene.remove(wire.mesh);if(wire.particle)scene.remove(wire.particle); wires = wires.filter(w => w !== wire); interactables = interactables.filter(x => x !== wire.mesh); }
function updateWireGeometry(wire) {
  const start = pinWorld(wire.a), end = pinWorld(wire.b); if (!start || !end) return;
  const mid = start.clone().lerp(end,.5); mid.y += Math.min(1.1,.35+start.distanceTo(end)*.09);
  wire.mesh.geometry.dispose(); wire.curve = new THREE.CatmullRomCurve3([start,mid,end]); wire.mesh.geometry = new THREE.TubeGeometry(wire.curve,Math.max(20,Math.ceil(start.distanceTo(end)*8)),.034,8,false);
}
function buildGraph() {
  const graph = new Map();
  const edge = (a,b,data={}) => { if (!a || !b) return; if (!graph.has(a)) graph.set(a,[]); if (!graph.has(b)) graph.set(b,[]); graph.get(a).push({node:b,...data}); graph.get(b).push({node:a,...data}); };
  wires.forEach(w => edge(w.a,w.b,{type:'wire',ref:w}));
  breadboardGroups.forEach(group => { for (let i = 1; i < group.length; i++) edge(group[0], group[i], { type: 'breadboard' }); });
  components.forEach(c => {
    if (c.type === 'resistor' && c.pins.length >= 2) edge(c.pins[0],c.pins[1],{type:'resistor',ref:c,resistance:Number(c.value)||220});
    if (c.type === 'button' && c.userData.pressed && c.pins.length >= 2) edge(c.pins[0],c.pins[1],{type:'switch',ref:c});
  });
  return graph;
}
function findPath(graph, start, goal) {
  const queue=[start], prev=new Map([[start,null]]), prevEdge=new Map();
  while(queue.length){const node=queue.shift();if(node===goal){const edges=[];let cur=goal;while(prev.get(cur)!==null){edges.push(prevEdge.get(cur));cur=prev.get(cur);}return edges;}for(const e of graph.get(node)||[]){if(!prev.has(e.node)){prev.set(e.node,node);prevEdge.set(e.node,e);queue.push(e.node);}}}
  return null;
}
function getBoardPin(board, name) { return board?.pinNames[name] || null; }
function outputPinName(board, pin) {
  const n = String(pin).trim();
  if (board.type === 'arduino') return `D${Number(n)}`;
  return `D${Number(n)}`;
}
function updateCircuit() {
  const graph = buildGraph(); const activeWireIds = new Set(); let active = 0, total = components.filter(c=>c.type==='led'||c.type==='rgb').length, currentTotal = 0;
  const board = activeBoard(); let voltage = board?.type === 'esp32' ? 3.3 : 5;
  components.filter(c=>c.type==='led').forEach(c=>{
    const pinA=c.pins.find(id=>pinMap.get(id)?.name==='A'), pinK=c.pins.find(id=>pinMap.get(id)?.name==='K');
    let lit=false, pathA=null, pathK=null, foundRes=0;
    if(board&&pinA&&pinK){
      for(const [pin,value] of outputs){if(value<=0)continue;const outId=getBoardPin(board,outputPinName(board,pin));if(outId){const p=findPath(graph,pinA,outId);if(p){pathA=p;break;}}}
      const grounds=['GND'].map(n=>getBoardPin(board,n)).filter(Boolean);
      for(const g of grounds){const p=findPath(graph,pinK,g);if(p){pathK=p;break;}}
      foundRes=[...(pathA||[]),...(pathK||[])].filter(e=>e.type==='resistor').reduce((sum,e)=>sum+(e.resistance||220),0);
      lit=!!(pathA&&pathK&&foundRes>=150);
      if(lit){[...(pathA||[]),...(pathK||[])].filter(e=>e.type==='wire').forEach(e=>activeWireIds.add(e.ref.id));}
    }
    c.active=lit;
    const drivenPin=getDrivenPinFromPath(board,pinA,graph); const pwm=pathA?.length ? (analogOutputs.get(String(drivenPin)) ?? outputs.get(String(drivenPin)) ?? 255) : 0;
    const power=lit?Math.max(.08,Math.min(1,pwm/255)):0;
    if(c.userData.dome){c.userData.dome.material.emissive.setHex(lit?0xff2028:0x120000);c.userData.dome.material.emissiveIntensity=lit?.25+power*1.45:.08;c.userData.dome.material.color.setHex(lit?0xff9ba0:0xff5c62);}
    if(c.userData.light){c.userData.light.intensity=lit?1.2+power*3.2:0;c.userData.light.color.setHex(0xff3843);}
    if(lit){active++;currentTotal+=Math.min(20,Math.max(0,(voltage-2)/Math.max(150,foundRes)*1000));}
  });
  components.filter(c=>c.type==='rgb').forEach(c=>{const common=c.pins.find(id=>pinMap.get(id)?.name==='K');const colors=['R','G','B'];const litColors=[];colors.forEach(ch=>{const p=c.pins.find(id=>pinMap.get(id)?.name===ch);let on=false;if(p&&common&&board){const out=[...outputs].some(([pin,v])=>v>0&&findPath(graph,p,getBoardPin(board,outputPinName(board,pin)))&&findPath(graph,common,getBoardPin(board,'GND')));on=out;}litColors.push(on);});const isOn=litColors.some(Boolean);c.active=isOn;if(isOn)active++;if(c.userData.light){c.userData.light.intensity=isOn?2.8:0;c.userData.light.color.setRGB(litColors[0]?1:0,litColors[1]?1:0,litColors[2]?1:0);}if(c.userData.dome){c.userData.dome.material.emissive.setRGB(litColors[0]?.5:0,litColors[1]?.5:0,litColors[2]?.5:0);}});
  wires.forEach(w=>{w.active=activeWireIds.has(w.id);});
  $('#voltageValue').innerHTML=`${voltage.toFixed(2)} <i>V</i>`;
  $('#currentValue').innerHTML=`${currentTotal.toFixed(2)} <i>mA</i>`;
  $('#activeLeds').innerHTML=`${active} <i>/ ${total}</i>`;
  const status=$('#circuitStatus'), message=$('#circuitMessage');
  if(total===0){status.textContent='EN ESPERA';status.style.color='#b7c4d3';message.textContent='Añade un LED, sensores o pantallas y conecta sus pines a una placa para probar tu programa.';}
  else if(active){status.textContent='CIRCUITO ACTIVO';status.style.color='#63e2ad';message.textContent=`${active} LED(s) encendido(s). La ruta incluye resistencia limitadora y referencia GND.`;}
  else{status.textContent='REVISAR CONEXIONES';status.style.color='#e6bd73';message.textContent='El circuito no tiene una ruta completa desde un pin de salida hasta GND. Revisa los cables y agrega una resistencia limitadora (≥150 Ω) en serie con el LED.';}
}
function getDrivenPinFromPath(board,pinA,graph){
  if(!board)return null;for(const [n,id] of Object.entries(board.pinNames)){if(!n.startsWith('D'))continue; if(findPath(graph,pinA,id)){return n.slice(1);}}return null;
}

function selectObject(object) {
  selectedObject = object;
  $('#inspectorEmpty').classList.toggle('hidden',!!object);
  $('#inspectorContent').classList.toggle('hidden',!object);
  if (!object) return;
  const type=object.type, name=object.name || partName(type), pins=object.pins || [];
  $('#inspectorContent').innerHTML = `<div class="inspect-title">${escapeHTML(name)}</div><div class="inspect-sub">${escapeHTML(type.toUpperCase())} · ${escapeHTML(object.id)}</div>
  <div class="prop-row"><span>Referencia</span><b>${escapeHTML(object.id)}</b></div>
  <div class="prop-row"><span>Valor nominal</span><b>${escapeHTML(String(object.value ?? '—'))}</b></div>
  <div class="prop-row"><span>Estado</span><b>${object.active?'Activo':'En reposo'}</b></div>
  <div class="prop-row"><span>Pines</span><b>${pins.length}</b></div>
  ${type==='resistor'?'<div class="prop-row"><span>Resistencia (Ω)</span><input id="partValue" type="number" min="1" max="1000000" value="'+(Number(object.value)||220)+'"></div>':''}
  ${type==='pot'?'<div class="prop-row"><span>Valor ADC (0–4095)</span><input id="partValue" type="number" min="0" max="4095" value="'+(object.userData.value||512)+'"></div>':''}
  ${type==='ldr'?'<div class="prop-row"><span>Lectura simulada</span><input id="partValue" type="number" min="0" max="1023" value="'+(object.userData.value||640)+'"></div>':''}
  ${type==='button'?'<div class="prop-row"><span>Entrada manual</span><button class="small-btn" id="toggleButton">'+(object.userData.pressed?'Presionado':'Presionar')+'</button></div>':''}
  ${type==='servo'?'<div class="prop-row"><span>Ángulo</span><b>'+Math.round(object.userData.servo||90)+'°</b></div>':''}
  <div class="section-divider"></div><div class="block-title">PINES DISPONIBLES <span>CLICK EN CABLEADO</span></div><div class="pin-list">${pins.map(id=>{const p=pinMap.get(id);const connected=wires.some(w=>w.a===id||w.b===id);return `<span class="pin-chip ${connected?'connected':''}">${escapeHTML(p?.name||id)}</span>`}).join('')}</div>`;
  $('#partValue')?.addEventListener('change',e=>{if(type==='resistor')object.value=Math.max(1,Number(e.target.value)||220);else object.userData.value=Number(e.target.value);updateInventory();updateCircuit();});
  $('#toggleButton')?.addEventListener('click',()=>{object.userData.pressed=!object.userData.pressed;object.userData.cap.position.y=object.userData.pressed?.31:.37;selectObject(object);updateCircuit();});
}
function removeObject(object) {
  if (!object) return;
  if (object.group) {
    object.pins?.forEach(id=>pinMap.delete(id));
    wires.filter(w=>object.pins?.includes(w.a)||object.pins?.includes(w.b)).forEach(removeWire);
    scene.remove(object.group);
    if (boards.includes(object)) { boards=boards.filter(b=>b!==object); if(activeBoardId===object.id)activeBoardId=boards.find(b=>b.type==='arduino'||b.type==='esp32')?.id||''; updateBoardSelect(); } else components=components.filter(c=>c!==object);
    interactables=interactables.filter(m=>!object.group.children.includes(m));
    if(selectedObject===object)selectObject(null);
    updateInventory();updateCircuit();notify(`${object.name||partName(object.type)} eliminado`);
  }
}
function updateInventory() {
  const counts = new Map(); components.forEach(c=>counts.set(partName(c.type),(counts.get(partName(c.type))||0)+1));
  const total=components.length+boards.length+wires.length; $('#totalMaterials').textContent=total; $('#materialsBadge').textContent=total;
  const list=$('#inventoryList');
  const entries=[...boards.map(b=>[b.name,1]),...counts.entries()]; if(wires.length) entries.push(['Cable jumper',wires.length]);
  list.innerHTML=entries.length?entries.map(([n,c])=>`<div class="inventory-row"><span>${escapeHTML(n)}</span><b>× ${c}</b></div>`).join(''):'<div class="inventory-empty">El inventario aparecerá aquí al añadir componentes.</div>';
  $('#materialsBadge').textContent=total;
  $('#count')?.replaceChildren();
}
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

function rayFromEvent(event) {
  const rect=canvas.getBoundingClientRect();pointer.x=((event.clientX-rect.left)/rect.width)*2-1;pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,camera);
}
function findPinHit(event) {
  rayFromEvent(event);
  const meshes=[];pinMap.forEach(p=>{if(p.mesh)meshes.push(p.mesh);});
  if (breadboardHitMesh) meshes.push(breadboardHitMesh); if (breadboardRailHitMesh) meshes.push(breadboardRailHitMesh);
  const hits=raycaster.intersectObjects(meshes,false);
  const hit=hits[0]; if(!hit)return null;
  if(hit.object.userData.isBreadboardHole)return hit.object.userData.instancePins?.[hit.instanceId]||null;
  return hit.object?.userData?.pinId||null;
}
function pointOnGround(event) {
  rayFromEvent(event);const point=new THREE.Vector3();if(!raycaster.ray.intersectPlane(groundPlane,point))return null;
  return {x:THREE.MathUtils.clamp(point.x,-6.9,6.9),z:THREE.MathUtils.clamp(point.z,-3.9,3.9)};
}
let pointerDown=null;
canvas.addEventListener('pointerdown',e=>{
  pointerDown={x:e.clientX,y:e.clientY,button:e.button};
  if(e.shiftKey&&!libraryMode&&!wireMode&&e.button===0){rayFromEvent(e);const hit=raycaster.intersectObjects(interactables.filter(o=>o&&o.isObject3D),true)[0];if(hit){let node=hit.object,ownerId=null;while(node&&!ownerId){ownerId=node.userData?.ownerId;node=node.parent;}const obj=[...boards,...components].find(o=>o.id===ownerId&&o.group);if(obj){draggingObject=obj;controls.enabled=false;const p=pointOnGround(e);if(p)dragOffset.set(obj.group.position.x-p.x,0,obj.group.position.z-p.z);$('#sceneHelp').textContent='Moviendo componente… suelta para colocar. R rota 90°.';}}}
});
canvas.addEventListener('pointermove',e=>{if(!draggingObject)return;const p=pointOnGround(e);if(!p)return;draggingObject.group.position.x=p.x+dragOffset.x;draggingObject.group.position.z=p.z+dragOffset.z;if(draggingObject.type==='arduino'||draggingObject.type==='esp32')draggingObject.group.position.y=.03;else draggingObject.group.position.y=(draggingObject.group.position.x>-.13&&draggingObject.group.position.x<5.43&&Math.abs(draggingObject.group.position.z)<2.3)?.34:.02;wires.filter(w=>draggingObject.pins?.includes(w.a)||draggingObject.pins?.includes(w.b)).forEach(updateWireGeometry);});
canvas.addEventListener('pointerup',e=>{
  if(draggingObject){draggingObject=null;controls.enabled=true;pointerDown=null;updateCircuit();updateInventory();$('#sceneHelp').textContent='Shift + arrastrar para mover · R para girar · Arrastra vacío para girar la cámara';return;}
  if(!pointerDown||pointerDown.button!==0||Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)>5){pointerDown=null;return;}
  if(libraryMode){const point=pointOnGround(e);if(!point)return;
    if(libraryMode==='arduino'||libraryMode==='esp32')addBoard(libraryMode,point.x,point.z);
    else addPart(libraryMode,point.x,point.z);
    libraryMode=null;wireMode=false;$('#sceneMode').textContent='MODO: SELECCIÓN';$('.lib-item.placing')?.classList.remove('placing');$('#connectMode').classList.remove('active');return;
  }
  const pinId=findPinHit(e);
  if(wireMode){if(!pinId){notify('Haz clic justo sobre un pin metálico');return;}if(!wireStart){wireStart=pinId;const p=pinMap.get(pinId);$('#sceneHelp').textContent=`Origen: ${p?.owner?.name||partName(p?.owner?.type)} · ${p?.name}. Elige el segundo pin.`;notify(`Pin inicial: ${p?.name}`);}else{const end=pinId;connectPins(wireStart,end,$('#wireColor').value);wireStart=null;$('#sceneHelp').textContent='Cable conectado. Selecciona otro par de pines para continuar.';}return;}
  rayFromEvent(e);const candidates=interactables.filter(o=>o&&o.isObject3D);const hit=raycaster.intersectObjects(candidates,true)[0];
  if(hit){let node=hit.object;let ownerId=null;while(node&&!ownerId){ownerId=node.userData?.ownerId;node=node.parent;}const obj=[...boards,...components].find(o=>o.id===ownerId);if(obj){if(obj.type==='arduino'||obj.type==='esp32'){activeBoardId=obj.id;updateBoardSelect();updateCircuit();}if(obj.type==='button'){obj.userData.pressed=!obj.userData.pressed;obj.userData.cap.position.y=obj.userData.pressed?.31:.37;updateCircuit();}selectObject(obj);return;}}
  selectObject(null);
});
canvas.addEventListener('pointercancel',()=>pointerDown=null);

function setLibraryMode(type,button) {
  libraryMode=type;wireMode=false;wireStart=null;
  document.querySelectorAll('.lib-item').forEach(b=>b.classList.toggle('placing',b===button));
  $('#connectMode').classList.remove('active');$('#sceneMode').textContent=`MODO: COLOCAR ${type.toUpperCase()}`;
  $('#sceneHelp').textContent=`Haz clic sobre la mesa para colocar ${partName(type)||type}. Esc para cancelar.`;
}
document.querySelectorAll('.lib-item').forEach(button=>button.addEventListener('click',()=>setLibraryMode(button.dataset.type,button)));
document.querySelectorAll('.cat').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.cat').forEach(b=>b.classList.toggle('active',b===button));
  const cat=button.dataset.cat;document.querySelectorAll('.lib-section').forEach(section=>section.classList.toggle('hidden',cat!=='all'&&section.dataset.section!==cat));
}));
$('#connectMode').addEventListener('click',()=>{libraryMode=null;wireMode=!wireMode;wireStart=null;document.querySelectorAll('.lib-item').forEach(b=>b.classList.remove('placing'));$('#connectMode').classList.toggle('active',wireMode);$('#sceneMode').textContent=wireMode?'MODO: CABLEADO':'MODO: SELECCIÓN';$('#sceneHelp').textContent=wireMode?'Selecciona dos pines metálicos para unirlos.':'Arrastra para girar · Rueda para acercar';});
$('#resetCamera').addEventListener('click',()=>{camera.position.set(9.4,10.8,12.2);controls.target.set(0,.2,0);controls.update();});
$('#toggleGrid').addEventListener('click',()=>{const grid=scene.children.find(o=>o.userData.isGrid);if(grid){showGrid=!showGrid;grid.visible=showGrid;}});
$('#deleteSelected').addEventListener('click',()=>{if(selectedObject)removeObject(selectedObject);else notify('Selecciona un componente primero');});
$('#clearBoard').addEventListener('click',()=>{[...components,...boards].forEach(removeObject);wires.slice().forEach(removeWire);updateInventory();updateCircuit();notify('Componentes y placas retirados; la protoboard permanece en la mesa.');});
window.addEventListener('keydown',e=>{if((e.key==='r'||e.key==='R')&&selectedObject?.group&&document.activeElement!==editor){selectedObject.group.rotation.y+=Math.PI/2;wires.filter(w=>selectedObject.pins?.includes(w.a)||selectedObject.pins?.includes(w.b)).forEach(updateWireGeometry);notify('Componente girado 90°');}if(e.key==='Escape'){libraryMode=null;wireMode=false;wireStart=null;document.querySelectorAll('.lib-item').forEach(b=>b.classList.remove('placing'));$('#connectMode').classList.remove('active');$('#sceneMode').textContent='MODO: SELECCIÓN';}if((e.key==='Delete'||e.key==='Backspace')&&selectedObject&&document.activeElement!==editor)removeObject(selectedObject);if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();runProgram();}});

function updateLineNumbers(){const lines=editor.value.split('\n').length;$('#lineNumbers').textContent=Array.from({length:lines},(_,i)=>i+1).join('\n');$('#codeLines').textContent=`${lines} líneas`;}
editor.value=examples.blink;updateLineNumbers();editor.addEventListener('input',updateLineNumbers);editor.addEventListener('scroll',()=>{$('#lineNumbers').scrollTop=editor.scrollTop;});editor.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const a=editor.selectionStart,b=editor.selectionEnd;editor.setRangeText('  ',a,b,'end');updateLineNumbers();}});
function adaptedExample(key){let code=examples[key]||examples.blink;const board=activeBoard();if(board?.type==='esp32'){
  if(key==='blink')code=code.replace('ledPin = 13','ledPin = 2');
  if(key==='fade')code=code.replace('ledPin = 9','ledPin = 23');
  if(key==='servo')code=code.replace('miServo.attach(9)','miServo.attach(23)');
  if(key==='button')code=code.replace('buttonPin = 2','buttonPin = 4').replace('ledPin = 13','ledPin = 2');
  if(key==='pot')code=code.replace('potPin = A0','potPin = 34');
  if(key==='buzzer')code=code.replace('buzzerPin = 8','buzzerPin = 23');
}return code;}
$('#exampleSelect').addEventListener('change',e=>{stopProgram();ensureExampleHardware(e.target.value);editor.value=adaptedExample(e.target.value);updateLineNumbers();notify(`Ejemplo cargado: ${e.target.options[e.target.selectedIndex].text}`);});
$('#formatCode').addEventListener('click',()=>{let level=0;editor.value=editor.value.split('\n').map(line=>{let t=line.trim();if(t.startsWith('}'))level=Math.max(0,level-1);const out='  '.repeat(level)+t;if(t.endsWith('{'))level++;return out;}).join('\n');updateLineNumbers();notify('Indentación aplicada');});
$('#clearSerial').addEventListener('click',clearSerial);$('#clearSerial2').addEventListener('click',clearSerial);
document.querySelectorAll('.view-tab').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.view-tab').forEach(b=>b.classList.toggle('active',b===button));const view=button.dataset.view;
  $('#sceneWrap').classList.toggle('hidden',view!=='3d');$('#codeDock').classList.toggle('hidden',view==='monitor');$('#monitorDock').classList.toggle('hidden',view!=='monitor');
  $('.work-area').classList.toggle('code-focused',view==='code');$('.work-area').classList.toggle('monitor-focused',view==='monitor');
  setTimeout(resizeScene,80);
}));
document.querySelectorAll('.right-tab').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.right-tab').forEach(b=>b.classList.toggle('active',b===button));const materialsTab=button.dataset.panel==='materials';$('#inspectorPanel').classList.toggle('hidden',materialsTab);$('#materialsPanel').classList.toggle('hidden',!materialsTab);}));

function extractFunction(code,name){const start=code.search(new RegExp(`\\b${name}\\s*\\(\\s*\\)\\s*\\{`));if(start<0)return null;const open=code.indexOf('{',start);let depth=0;for(let i=open;i<code.length;i++){if(code[i]==='{')depth++;if(code[i]==='}')depth--;if(depth===0)return code.slice(open+1,i);}return null;}
function removeComments(code){return code.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');}
function resolveSymbols(code){const vars={HIGH:1,LOW:0,OUTPUT:1,INPUT:0,INPUT_PULLUP:2,A0:14,A1:15,A2:16,A3:17,A4:18,A5:19};const re=/(?:const\s+)?(?:int|long|byte|uint8_t)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g;let m;while((m=re.exec(code))){const value=Number(m[2].trim());if(Number.isFinite(value))vars[m[1]]=value;else if(m[2].trim() in vars)vars[m[1]]=vars[m[2].trim()];}return vars;}
function splitStatements(body){
  const source=body;let index=0;const skip=()=>{while(index<source.length&&/\s/.test(source[index]))index++;};
  const balanced=(open,close)=>{skip();if(source[index]!==open)return null;const start=++index;let depth=1,quote=null,escape=false;while(index<source.length){const ch=source[index++];if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch===quote)quote=null;continue;}if(ch==='"'||ch==="'"){quote=ch;continue;}if(ch===open)depth++;if(ch===close&&--depth===0)return {value:source.slice(start,index-1),end:index};}throw new Error('Bloque sin cerrar en el código.');};
  const readOne=()=>{
    skip();if(index>=source.length||source[index]==='}')return null;
    if(source[index]==='{'){const block=balanced('{','}');return splitStatements(block.value);}
    if(source.startsWith('if',index)&&!/[\w]/.test(source[index+2]||'')){
      index+=2;const cond=balanced('(',')');if(!cond)throw new Error('Condición if inválida.');const yes=readOne();skip();let no=[];if(source.startsWith('else',index)){index+=4;const branch=readOne();no=Array.isArray(branch)?branch:branch?[branch]:[];}return {kind:'if',condition:cond.value,then:Array.isArray(yes)?yes:yes?[yes]:[],otherwise:no};
    }
    if(source.startsWith('for',index)&&!/[\w]/.test(source[index+3]||'')){
      index+=3;const head=balanced('(',')');if(!head)throw new Error('Cabecera for inválida.');const body=readOne();return {kind:'for',header:head.value,body:Array.isArray(body)?body:body?[body]:[]};
    }
    const start=index;let paren=0,quote=null,escape=false;
    while(index<source.length){const ch=source[index];if(quote){index++;if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch===quote)quote=null;continue;}if(ch==='"'||ch==="'"){quote=ch;index++;continue;}if(ch==='(')paren++;else if(ch===')')paren=Math.max(0,paren-1);if(ch===';'&&paren===0){const value=source.slice(start,index).trim();index++;return value||null;}if(ch==='}'&&paren===0)break;index++;}
    const value=source.slice(start,index).trim();return value||null;
  };
  const result=[];while(index<source.length){skip();if(source[index]==='}')break;const item=readOne();if(item)result.push(item);else if(index<source.length)index++;}return result;
}
function parseProgram(code){const stripped=removeComments(code);const setup=extractFunction(stripped,'setup'),loop=extractFunction(stripped,'loop');if(setup===null||loop===null)throw new Error('El programa debe declarar void setup() y void loop().');if((stripped.match(/{/g)||[]).length!==(stripped.match(/}/g)||[]).length)throw new Error('Hay llaves sin cerrar. Revisa el bloque setup() o loop().');const symbols=resolveSymbols(stripped);return {setup:splitStatements(setup),loop:splitStatements(loop),symbols};}
function resolveNumber(value,symbols){const v=String(value||'').trim();if(v in symbols)return symbols[v];if(/^A[0-5]$/.test(v))return 14+Number(v.slice(1));if(v==='HIGH')return 1;if(v==='LOW')return 0;const n=Number(v);return Number.isFinite(n)?n:null;}
function evaluateOperand(value,symbols){
  const text=String(value||'').trim();let m;
  if((m=text.match(/^digitalRead\s*\(\s*([^)]+)\s*\)$/))){const button=components.find(c=>c.type==='button');const inputMode=pinModes.get(String(resolveNumber(m[1],symbols)))==='INPUT_PULLUP';return inputMode?(button?.userData.pressed?0:1):(button?.userData.pressed?1:0);}
  if((m=text.match(/^analogRead\s*\(\s*([^)]+)\s*\)$/))){const sensor=components.find(c=>c.type==='pot'||c.type==='ldr');return Number(sensor?.userData.value??512);}
  return resolveNumber(text,symbols);
}
function evaluateCondition(condition,symbols){
  const text=String(condition).trim();const orParts=text.split(/\s*\|\|\s*/);if(orParts.length>1)return orParts.some(x=>evaluateCondition(x,symbols));
  const andParts=text.split(/\s*&&\s*/);if(andParts.length>1)return andParts.every(x=>evaluateCondition(x,symbols));
  const match=text.match(/^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);if(!match)return Boolean(evaluateOperand(text,symbols));
  const a=evaluateOperand(match[1],symbols),b=evaluateOperand(match[3],symbols);switch(match[2]){case '==':case '===':return a==b;case '!=':case '!==':return a!=b;case '>':return a>b;case '<':return a<b;case '>=':return a>=b;case '<=':return a<=b;default:return false;}
}
function updateLoopExpression(expression,symbols){const text=expression.trim();let m;if((m=text.match(/^([A-Za-z_]\w*)\+\+$/))){symbols[m[1]]=(Number(symbols[m[1]])||0)+1;return;}if((m=text.match(/^([A-Za-z_]\w*)--$/))){symbols[m[1]]=(Number(symbols[m[1]])||0)-1;return;}if((m=text.match(/^([A-Za-z_]\w*)\s*([+\-])=\s*(.+)$/))){symbols[m[1]]=(Number(symbols[m[1]])||0)+(m[2]==='+'?1:-1)*(evaluateOperand(m[3],symbols)||0);return;}runCommand(text,symbols);
}
function activeBoard(){return boards.find(b=>(b.type==='arduino'||b.type==='esp32')&&b.id===activeBoardId)||boards.find(b=>b.type==='arduino'||b.type==='esp32')||null;}
function updateBoardSelect(){const sel=$('#boardTarget');if(!sel)return;const boardsOnly=boards.filter(b=>b.type==='arduino'||b.type==='esp32');const current=activeBoardId;sel.innerHTML=boardsOnly.map(b=>`<option value="${escapeHTML(b.id)}">${escapeHTML(b.name)}</option>`).join('');if(boardsOnly.some(b=>b.id===current))sel.value=current;else if(boardsOnly[0]){activeBoardId=boardsOnly[0].id;sel.value=activeBoardId;}}
$('#boardTarget').addEventListener('change',e=>{activeBoardId=e.target.value;updateCircuit();notify(`Placa activa: ${activeBoard()?.name||'ninguna'}`);});
function findBoardForPin(pin){return activeBoard();}
function writeOutput(pin,value,analog=false){const key=String(pin);if(analog){analogOutputs.set(key,value);outputs.set(key,value>0?1:0);}else{outputs.set(key,value?255:0);analogOutputs.set(key,value?255:0);}updateCircuit();updateBoardUserLED();}
function updateBoardUserLED(){boards.forEach(b=>{if(b.type==='esp32'&&b.userLed){const v=outputs.get('2')||0;b.userLed.material.emissive.setHex(v?0x1255ff:0x0b243a);}});}
function displayObject(type){return components.find(c=>c.type===type&&c.userData.screen)||null;}
function displayTarget(type){return displayObject(type)?.userData.screen||null;}
function displayIsWired(type){
  const object=displayObject(type), board=activeBoard(); if(!object||!board)return false;
  const graph=buildGraph(); const wanted=type==='lcd' ? [['SDA','SDA'],['SCL','SCL'],['GND','GND'],['VCC','5V']] : [['SDA',board.type==='esp32'?'D21':'SDA'],['SCL',board.type==='esp32'?'D22':'SCL'],['GND','GND'],['VCC',board.type==='esp32'?'3V3':'5V']];
  return wanted.every(([partName,boardName])=>{const a=object.pins.find(id=>pinMap.get(id)?.name===partName);const b=board.pinNames[boardName];return a&&b&&!!findPath(graph,a,b);});
}
function setDisplayLines(target,row,text){if(!target)return;const lines=target.lines||['',''];lines[row]=String(text);target.lines=lines;renderScreen(target);}
function partPinId(object,name){return object?.pins.find(id=>pinMap.get(id)?.name===name)||null;}
function autoConnectPart(object, mapping){const board=activeBoard();if(!object||!board)return;for(const [partName,boardName,color] of mapping){const a=partPinId(object,partName),b=board.pinNames[boardName];if(a&&b&&!wires.some(w=>(w.a===a&&w.b===b)||(w.a===b&&w.b===a)))connectPins(a,b,color||'#e8bd52');}}
function ensureExampleHardware(example){
  let board=activeBoard();
  if(example==='esp32'&&!boards.some(b=>b.type==='esp32')){addBoard('esp32',-3.75,2.5,true,'esp32-devkit');board=activeBoard();updateBoardSelect();}else if(example==='esp32'){activeBoardId=boards.find(b=>b.type==='esp32')?.id||activeBoardId;updateBoardSelect();board=activeBoard();}
  if(example==='fade'&&!components.some(c=>c.id==='pwm-led')){
    const r=addPart('resistor',1.75,.92,{quiet:true,id:'pwm-resistor',value:220});
    const d=addPart('led',2.82,.92,{quiet:true,id:'pwm-led'});
    const d9=board?.pinNames[board?.type==='esp32'?'D23':'D9'], gnd=board?.pinNames.GND;
    if(d9)connectPins(d9,r.pins[0],'#ef5555');connectPins(r.pins[1],d.pins[0],'#e8bd52');if(gnd)connectPins(d.pins[1],gnd,'#303d50');
  }
  if(example==='lcd'&&!components.some(c=>c.type==='lcd')){
    const lcd=addPart('lcd',2.8,1.55,{quiet:true,id:'lcd-1602'});
    if(board?.type==='esp32')autoConnectPart(lcd,[['GND','GND','#303d50'],['VCC','3V3','#ef5555'],['SDA','D21','#e8bd52'],['SCL','D22','#4d9ee8']]);
    else autoConnectPart(lcd,[['GND','GND','#303d50'],['VCC','5V','#ef5555'],['SDA','SDA','#e8bd52'],['SCL','SCL','#4d9ee8']]);
  }
  if(example==='matrix'&&!components.some(c=>c.type==='matrix')){
    const matrix=addPart('matrix',4.0,1.45,{quiet:true,id:'matrix-8x8'});
    if(board?.type==='esp32')autoConnectPart(matrix,[['GND','GND','#303d50'],['VCC','3V3','#ef5555'],['DIN','D23','#e8bd52'],['CS','D5','#4d9ee8'],['CLK','D18','#50c995']]);
    else autoConnectPart(matrix,[['GND','GND','#303d50'],['VCC','5V','#ef5555'],['DIN','D11','#e8bd52'],['CS','D10','#4d9ee8'],['CLK','D13','#50c995']]);
  }
  if(example==='servo'&&!components.some(c=>c.type==='servo')){
    const servo=addPart('servo',4.1,-1.35,{quiet:true,id:'servo-sg90'});
    autoConnectPart(servo,[['GND','GND','#303d50'],[ '5V',board?.type==='esp32'?'3V3':'5V','#ef5555'],['SIG',board?.type==='esp32'?'D23':'D9','#e8bd52']]);
  }
  if(example==='button'&&!components.some(c=>c.type==='button')){
    const button=addPart('button',4.15,-.78,{quiet:true,id:'button-input'});
    autoConnectPart(button,[['1',board?.type==='esp32'?'D4':'D2','#e8bd52'],['2','GND','#303d50']]);
  }
  if(example==='pot'&&!components.some(c=>c.type==='pot')){
    const pot=addPart('pot',4.2,.15,{quiet:true,id:'pot-analog'});
    autoConnectPart(pot,[['GND','GND','#303d50'],['SIG',board?.type==='esp32'?'D34':'A0','#e8bd52'],['VCC',board?.type==='esp32'?'3V3':'5V','#ef5555']]);
  }
  if(example==='oled'&&!components.some(c=>c.type==='oled')){
    const oled=addPart('oled',4.0,-.3,{quiet:true,id:'oled-12864'});
    if(board?.type==='esp32')autoConnectPart(oled,[['GND','GND','#303d50'],['VCC','3V3','#ef5555'],['SDA','D21','#e8bd52'],['SCL','D22','#4d9ee8']]);
    else autoConnectPart(oled,[['GND','GND','#303d50'],['VCC','5V','#ef5555'],['SDA','SDA','#e8bd52'],['SCL','SCL','#4d9ee8']]);
  }
  if(example==='buzzer'&&!components.some(c=>c.type==='buzzer')){
    const buzzer=addPart('buzzer',4.25,-1.3,{quiet:true,id:'buzzer-1'});
    autoConnectPart(buzzer,[['+',board?.type==='esp32'?'D23':'D8','#e8bd52'],['-','GND','#303d50']]);
  }
}
function runCommand(command,symbols){
  const cmd=command.trim();let m;
  if((m=cmd.match(/^(?:const\s+)?(?:int|long|byte|uint8_t|float|bool)\s+([A-Za-z_]\w*)\s*=\s*([^;]+)$/))){const v=evaluateOperand(m[2],symbols);if(v!==null)symbols[m[1]]=v;return null;}
  if((m=cmd.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/))){const v=evaluateOperand(m[2],symbols);if(v!==null)symbols[m[1]]=v;else throw new Error(`No se puede evaluar: ${cmd}`);return null;}
  if((m=cmd.match(/^pinMode\s*\(\s*([^,]+)\s*,\s*([^)]+)\)$/))){const pin=resolveNumber(m[1],symbols);if(pin===null)throw new Error(`No se reconoce el pin: ${m[1]}`);pinModes.set(String(pin),m[2].trim());return null;}
  if((m=cmd.match(/^digitalWrite\s*\(\s*([^,]+)\s*,\s*([^)]+)\)$/))){const pin=resolveNumber(m[1],symbols),v=resolveNumber(m[2],symbols);if(pin===null||v===null)throw new Error(`Parámetros inválidos en ${cmd}`);writeOutput(pin,v);return null;}
  if((m=cmd.match(/^analogWrite\s*\(\s*([^,]+)\s*,\s*([^)]+)\)$/))){const pin=resolveNumber(m[1],symbols),v=resolveNumber(m[2],symbols);if(pin===null||v===null)throw new Error(`Parámetros inválidos en ${cmd}`);writeOutput(pin,THREE.MathUtils.clamp(v,0,255),true);return null;}
  if((m=cmd.match(/^delay\s*\(\s*([^)]+)\)$/))){const ms=resolveNumber(m[1],symbols);return {wait:THREE.MathUtils.clamp(ms??100,0,10000)};}
  if((m=cmd.match(/^Serial\.(?:println|print)\s*\(\s*(.*?)\s*\)$/))){const value=m[1].replace(/^['"]|['"]$/g,'');logSerial(resolveNumber(value,symbols)??value);return null;}
  if(/^Serial\.begin\s*\(/.test(cmd)||cmd==='return')return null;
  if((m=cmd.match(/^(?:lcd|display)\.setCursor\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/))){runState.cursor={col:Number(m[1]),row:Number(m[2])};return null;}
  if((m=cmd.match(/^(?:lcd|display)\.print\s*\(\s*(.*?)\s*\)$/))){const value=m[1].replace(/^['"]|['"]$/g,'');const obj=displayObject(cmd.startsWith('lcd.')?'lcd':'oled'),target=obj?.userData.screen;const ready=obj&&(obj.type==='lcd'?obj.userData.initialized:displayIsWired('oled'));if(target&&ready){const row=Math.min(target.lines.length-1,runState.cursor.row||0);setDisplayLines(target,row,(target.lines[row]||'').slice(0,runState.cursor.col||0)+value);}else logSerial(`Pantalla no disponible o sin conexiones: ${value}`);return null;}
  if(/^lcd\.(?:init|begin|backlight|clear)\s*\(/.test(cmd)){const obj=displayObject('lcd'),t=obj?.userData.screen;if(obj&&!displayIsWired('lcd')){obj.userData.initialized=false;logSerial('LCD no responde: revisa SDA, SCL, VCC y GND.');return null;}if(obj)obj.userData.initialized=true;if(t&&cmd.includes('clear')){t.lines=['',''];renderScreen(t);}return null;}
  if(/^display\.(?:begin|clearDisplay|display)\s*\(/.test(cmd)){const obj=displayObject('oled'),t=obj?.userData.screen;if(obj)obj.userData.initialized=displayIsWired('oled');if(t&&cmd.includes('clear')){t.lines=['','','',''];renderScreen(t);}if(obj&&!obj.userData.initialized)logSerial('OLED no responde: revisa SDA, SCL, VCC y GND.');return null;}
  if((m=cmd.match(/^matrix\.setLed\s*\(\s*\d+\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(true|false)\s*\)$/))){const t=displayTarget('matrix');if(t){t.pixels[THREE.MathUtils.clamp(Number(m[1]),0,7)][THREE.MathUtils.clamp(Number(m[2]),0,7)]=m[3]==='true';renderScreen(t);}return null;}
  if(/^matrix\.clear\s*\(/.test(cmd)){const t=displayTarget('matrix');if(t){t.pixels=Array.from({length:8},()=>Array(8).fill(false));renderScreen(t);}return null;}
  if((m=cmd.match(/^miServo\.write\s*\(\s*([^)]+)\)$/))||(m=cmd.match(/^servo\.write\s*\(\s*([^)]+)\)$/))){const angle=THREE.MathUtils.clamp(resolveNumber(m[1],symbols)??90,0,180);const c=components.find(x=>x.type==='servo');if(c){c.userData.servo=angle;c.userData.servoArm.rotation.y=THREE.MathUtils.degToRad(angle-90);}return null;}
  if(/^miServo\.attach\s*\(/.test(cmd)||/^servo\.attach\s*\(/.test(cmd)||/^matrix\.begin\s*\(/.test(cmd))return null;
  if((m=cmd.match(/^tone\s*\(\s*([^,]+)\s*,\s*([^)]+)\)$/))){const hz=resolveNumber(m[2],symbols)||440;const b=components.find(c=>c.type==='buzzer');if(b){b.userData.sound=true;b.userData.frequency=hz;}try{const AudioCtx=window.AudioContext||window.webkitAudioContext;if(AudioCtx){audioContext ||= new AudioCtx();if(audioContext.state==='suspended')audioContext.resume();if(buzzerOscillator){buzzerOscillator.stop();buzzerOscillator=null;}buzzerOscillator=audioContext.createOscillator();buzzerGain=audioContext.createGain();buzzerOscillator.type='square';buzzerOscillator.frequency.value=hz;buzzerGain.gain.value=.018;buzzerOscillator.connect(buzzerGain);buzzerGain.connect(audioContext.destination);buzzerOscillator.start();}}catch(err){console.warn('Audio no disponible',err);}logSerial(`Tono simulado: ${hz} Hz`);return null;}
  if(/^noTone\s*\(/.test(cmd)){components.filter(c=>c.type==='buzzer').forEach(c=>c.userData.sound=false);if(buzzerOscillator){try{buzzerOscillator.stop();}catch{}buzzerOscillator=null;}return null;}
  if((m=cmd.match(/^(?:int|long|byte|float)\s+([A-Za-z_]\w*)\s*=\s*analogRead\s*\(\s*([^)]+)\)$/))){symbols[m[1]]=evaluateOperand(`analogRead(${m[2]})`,symbols);logSerial(`${m[1]} = ${symbols[m[1]]}`);return null;}
  if((m=cmd.match(/^(?:int|long|byte|bool)\s+([A-Za-z_]\w*)\s*=\s*digitalRead\s*\(\s*([^)]+)\)$/))){symbols[m[1]]=evaluateOperand(`digitalRead(${m[2]})`,symbols);logSerial(`${m[1]} = ${symbols[m[1]]}`);return null;}
  if((m=cmd.match(/^analogRead\s*\(\s*([^)]+)\)$/))){const pin=resolveNumber(m[1],symbols);const sensor=components.find(c=>c.type==='pot'||c.type==='ldr');logSerial(`analogRead(${pin}) = ${sensor?.userData.value??512}`);return null;}
  if((m=cmd.match(/^digitalRead\s*\(\s*([^)]+)\)$/))){const pin=resolveNumber(m[1],symbols);const button=components.find(c=>c.type==='button');logSerial(`digitalRead(${pin}) = ${button?.userData.pressed?1:0}`);return null;}
  if(/^#include/.test(cmd)||/^Servo\s+\w+/.test(cmd)||/^LiquidCrystal_I2C\s+\w+/.test(cmd)||/^MAX7219\s+\w+/.test(cmd))return null;
  if(cmd==='')return null;
  throw new Error(`Instrucción aún no soportada: ${cmd}`);
}
const runState={cursor:{row:0,col:0}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function executeCommands(commands,symbols,token){
  for(const command of commands){if(token!==runToken||!running)return;
    if(typeof command==='string'){const result=runCommand(command,symbols);if(result?.wait)await sleep(result.wait);continue;}
    if(command.kind==='if'){await executeCommands(evaluateCondition(command.condition,symbols)?command.then:command.otherwise,symbols,token);continue;}
    if(command.kind==='for'){
      const parts=command.header.split(';').map(x=>x.trim());if(parts.length!==3)throw new Error('El for debe usar la forma for (int i=0; i<5; i++).');
      runCommand(parts[0],symbols);let guard=0;while(running&&token===runToken&&evaluateCondition(parts[1],symbols)&&guard++<50){await executeCommands(command.body,symbols,token);updateLoopExpression(parts[2],symbols);}if(guard>=50)logSerial('Aviso: el for se limitó a 50 repeticiones por ciclo.');
    }
  }
}
async function runProgram(){
  stopProgram(false);let program;try{program=parseProgram(editor.value);}catch(error){setStatus(`● Error: ${error.message}`,'#f18b96');logSerial(`ERROR DE COMPILACIÓN: ${error.message}`);notify(error.message);return;}
  const board=activeBoard();if(!board){notify('Agrega un Arduino UNO o ESP32 antes de ejecutar');return;}
  outputs.clear();analogOutputs.clear();pinModes.clear();runState.cursor={row:0,col:0};components.filter(c=>c.type==='led'||c.type==='rgb').forEach(c=>{c.active=false;});
  running=true;const token=++runToken;setStatus('● Compilando…','#6cd9e6');logSerial('--------------------------------');logSerial(`Compilación educativa para ${board.name}`);logSerial('API compatible: pinMode, digitalWrite, analogWrite, delay, Serial, LCD, matriz, Servo.');
  await sleep(180);
  if(token!==runToken)return;
  setStatus('● Programa en ejecución','#65daa6');logSerial('Programa iniciado.');
  try{
    await executeCommands(program.setup,program.symbols,token);
    while(running&&token===runToken){const start=performance.now();await executeCommands(program.loop,program.symbols,token);if(running&&token===runToken)await sleep(12);loopCounter++;const elapsed=performance.now()-start;currentLoopRate=elapsed>0?1000/Math.max(elapsed,80):0;$('#loopRate').innerHTML=`${currentLoopRate.toFixed(1)} <i>Hz</i>`;lastLoopTime=performance.now();if(program.loop.length===0)await sleep(100);}
  }catch(error){setStatus(`● Error: ${error.message}`,'#f18b96');logSerial(`ERROR: ${error.message}`);running=false;}
}
function stopProgram(update=true){if(running){running=false;runToken++;if(update){setStatus('● Programa detenido','#e3bf7c');logSerial('Programa detenido.');}}outputs.clear();analogOutputs.clear();components.filter(c=>c.type==='buzzer').forEach(c=>c.userData.sound=false);if(buzzerOscillator){try{buzzerOscillator.stop();}catch{}buzzerOscillator=null;}if(scene){updateCircuit();updateBoardUserLED();}}
$('#runCode').addEventListener('click',runProgram);$('#stopCode').addEventListener('click',()=>stopProgram());

function serializeProject(){return {version:3,name:$('#projectName').textContent,boards:boards.filter(b=>b.type==='arduino'||b.type==='esp32').map(b=>({type:b.type,x:b.group.position.x,z:b.group.position.z,id:b.id})),activeBoardId,components:components.map(c=>({type:c.type,x:c.group.position.x,z:c.group.position.z,id:c.id,value:c.value,userData:{servo:c.userData.servo,value:c.userData.value}})),wires:wires.map(w=>({a:w.a,b:w.b,color:w.color})),code:editor.value};}
function saveProject(){localStorage.setItem('protolab-studio-project',JSON.stringify(serializeProject()));notify('Proyecto guardado en este navegador.');}
function loadProject(data){[...components,...boards].forEach(removeObject);wires.slice().forEach(removeWire);const boardIds=new Map();(data.boards||[]).forEach(b=>{if(b.type==='arduino'||b.type==='esp32'){const created=addBoard(b.type,b.x,b.z,true,b.id);boardIds.set(b.id,created);}});activeBoardId=data.activeBoardId||boards.find(b=>b.type==='arduino'||b.type==='esp32')?.id||'';updateBoardSelect();(data.components||[]).forEach(c=>{const created=addPart(c.type,c.x,c.z,{quiet:true,id:c.id,value:c.value});if(c.userData){Object.assign(created.userData,c.userData);if(created.userData.servoArm&&c.userData.servo!=null)created.userData.servoArm.rotation.y=THREE.MathUtils.degToRad(c.userData.servo-90);}});(data.wires||[]).forEach(w=>connectPins(w.a,w.b,w.color));if(data.code){editor.value=data.code;updateLineNumbers();}updateInventory();updateCircuit();notify('Proyecto cargado.');}
$('#saveProject').addEventListener('click',saveProject);
$('#loadProject').addEventListener('click',()=>{const saved=localStorage.getItem('protolab-studio-project');if(!saved){notify('Todavía no hay un proyecto guardado.');return;}try{loadProject(JSON.parse(saved));}catch(error){notify('No se pudo cargar: '+error.message);}});
$('#exportProject').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(serializeProject(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='protolab-project.json';a.click();URL.revokeObjectURL(url);notify('JSON del proyecto exportado.');});

function buildStarterProject(){
  const uno=addBoard('arduino',-3.6,-.05,true,'uno-main');activeBoardId=uno.id;updateBoardSelect();
  // A prewired LED + resistor circuit makes the first run immediately observable.
  const resistor=addPart('resistor',1.38,-.95,{quiet:true,id:'r-start',value:220});
  const led=addPart('led',2.86,-.95,{quiet:true,id:'led-start'});
  const d13=uno.pinNames.D13, gnd=uno.pinNames.GND;
  connectPins(d13,resistor.pins[0],'#ef5555');
  connectPins(resistor.pins[1],led.pins[0],'#e8bd52');
  connectPins(led.pins[1],gnd,'#303d50');
  selectObject(null);updateInventory();updateCircuit();
  logSerial('Circuito de ejemplo montado: UNO → 220 Ω → LED → GND.');
  logSerial('Pulsa Ejecutar para iniciar el ejemplo blink del editor.');
}

// Screen controls: selected view tabs and board selection are initialized after the renderer.
initScene();
if (renderer) {
  buildStarterProject();
  // Marca que la escena, el inventario y el circuito inicial quedaron montados.
  window.__PROTOLAB_READY = true;
  // A helpful, non-blocking note about the educational interpreter.
  setStatus('● Listo para compilar');
}
