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
const MCU_BOARD_TYPES = new Set(['arduino','unor4','esp32','mega','nano','esp32s3','pico','stm32','leonardo','esp8266','picow','teensy']);
const isMCUBoard = board => !!board && MCU_BOARD_TYPES.has(board.type);
const isEspBoard = board => ['esp32','esp32s3','esp8266'].includes(board?.type);
const is3V3Board = board => ['esp32','esp32s3','esp8266','pico','picow','stm32','teensy'].includes(board?.type);
const boardPowerPin = board => board?.pinNames?.['5V'] ? '5V' : board?.pinNames?.VIN ? 'VIN' : board?.pinNames?.VBUS ? 'VBUS' : '3V3';
const boardLogicPin = board => board?.pinNames?.['3V3'] ? '3V3' : boardPowerPin(board);
let lastAnimationTime = performance.now();
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
}`,
  robotArm: `// Brazo robotico de 4 ejes + pinza
// API educativa ProtoLab: arm.write(base, hombro, codo, muneca, pinza)
void setup() {
  Serial.begin(9600);
  Serial.println("Brazo robotico listo");
}

void loop() {
  arm.write(90, 55, 115, 90, 25);
  Serial.println("Posicion de reposo");
  delay(900);
  arm.write(45, 80, 65, 120, 70);
  Serial.println("Tomando objeto");
  delay(900);
  arm.write(135, 35, 100, 75, 70);
  Serial.println("Moviendo objeto");
  delay(900);
  arm.write(90, 55, 115, 90, 25);
  delay(900);
}`,
  robotCar: `// Rover 4 ruedas: avance, giro y reversa
// API educativa ProtoLab: robot.drive(izquierda, derecha)
void setup() {
  Serial.begin(115200);
  Serial.println("Rover preparado");
}

void loop() {
  robot.drive(170, 170);
  Serial.println("Avanzando");
  delay(1200);
  robot.drive(140, -140);
  Serial.println("Giro sobre su eje");
  delay(650);
  robot.drive(-150, -150);
  Serial.println("Retrocediendo");
  delay(900);
  robot.stop();
  delay(700);
}`,
  lineFollower: `// Robot seguidor de linea: correccion diferencial
// En el montaje virtual puedes cambiar la lectura del modulo IR.
void setup() {
  Serial.begin(9600);
  Serial.println("Seguidor de linea iniciado");
}

void loop() {
  robot.drive(155, 155);
  Serial.println("Linea centrada: avance");
  delay(700);
  robot.drive(95, 165);
  Serial.println("Correccion hacia la izquierda");
  delay(500);
  robot.drive(165, 95);
  Serial.println("Correccion hacia la derecha");
  delay(500);
}`,
  hexapod: `// Hexapodo: marcha de seis patas, 12 servos via PCA9685
void setup() {
  Serial.begin(115200);
  Serial.println("Hexapodo calibrado: 12 canales PWM listos");
}

void loop() {
  hexapod.walk(1);
  Serial.println("Marcha activa");
  delay(1800);
  hexapod.stop();
  Serial.println("Pausa");
  delay(700);
}`,
  stepper: `// Motor paso a paso con driver tipo A4988
// API educativa ProtoLab: stepper.move(pasos)
void setup() {
  Serial.begin(9600);
  Serial.println("Driver paso a paso listo");
}

void loop() {
  stepper.move(200);
  Serial.println("Una vuelta adelante (200 pasos)");
  delay(900);
  stepper.move(-200);
  Serial.println("Una vuelta atras");
  delay(900);
}`,
  joystick: `// Lectura de joystick de dos ejes y pulsador
const int ejeX = A0;
const int ejeY = A1;
void setup() {
  Serial.begin(9600);
}
void loop() {
  int x = analogRead(ejeX);
  int y = analogRead(ejeY);
  Serial.println("Joystick X/Y: valores analogicos simulados");
  delay(250);
}`,
  dht: `// Sensor ambiental DHT22 (lecturas demostrativas)
void setup() {
  Serial.begin(9600);
  Serial.println("DHT22 conectado");
}
void loop() {
  Serial.println("Temperatura: 24.5 C");
  Serial.println("Humedad: 48.0 %");
  delay(1500);
}`,
  relay: `// Control de modulo relay de un canal
const int relayPin = 7;
void setup() {
  pinMode(relayPin, OUTPUT);
  Serial.begin(9600);
}
void loop() {
  digitalWrite(relayPin, HIGH);
  Serial.println("Rele activado");
  delay(1000);
  digitalWrite(relayPin, LOW);
  Serial.println("Rele desactivado");
  delay(1000);
}`,
  imu: `// Modulo IMU MPU6050: demostracion de lectura I2C
void setup() {
  Serial.begin(115200);
  Serial.println("MPU6050 inicializado en I2C");
}
void loop() {
  Serial.println("Accel X: 0.02 g | Y: 0.98 g | Z: 0.04 g");
  Serial.println("Gyro X: 0.1 | Y: -0.2 | Z: 0.0");
  delay(500);
}`,
  robotArm6: `// Brazo industrial de 6 grados de libertad + pinza
// API visual ProtoLab: arm6.write(J1,J2,J3,J4,J5,J6,apertura)
void setup() { Serial.begin(115200); Serial.println("Brazo 6 GDL listo"); }
void loop() {
  arm6.write(90,70,110,90,90,90,20); Serial.println("Posicion inicial"); delay(900);
  arm6.write(55,100,75,110,45,130,75); Serial.println("Tomando pieza"); delay(1000);
  arm6.write(135,65,120,60,135,45,75); Serial.println("Traslado de pieza"); delay(1100);
  arm6.write(90,70,110,90,90,90,20); delay(900);
}`,
  traffic: `// Semaforo de tres luces con tiempos
const int redPin=8; const int yellowPin=9; const int greenPin=10;
void setup(){ pinMode(redPin,OUTPUT); pinMode(yellowPin,OUTPUT); pinMode(greenPin,OUTPUT); Serial.begin(9600); }
void loop(){
 digitalWrite(redPin,HIGH); digitalWrite(yellowPin,LOW); digitalWrite(greenPin,LOW); Serial.println("ALTO"); delay(1400);
 digitalWrite(redPin,LOW); digitalWrite(yellowPin,HIGH); Serial.println("PRECAUCION"); delay(500);
 digitalWrite(yellowPin,LOW); digitalWrite(greenPin,HIGH); Serial.println("AVANCE"); delay(1400);
}`,
  parking: `// Sensor de estacionamiento con ultrasonico + buzzer
// API educativa: sonar.read() obtiene la distancia virtual en cm.
void setup(){ Serial.begin(9600); Serial.println("Asistente de estacionamiento activo"); }
void loop(){
 int distance=sonar.read(); Serial.println(distance);
 if(distance<15){ tone(8,1200); Serial.println("ALERTA: objeto cercano"); } else { noTone(8); Serial.println("Zona libre"); }
 delay(350);
}`,
  irrigation: `// Riego automatico con sensor de suelo y relay
// soil.read() entrega humedad virtual entre 0 y 100 %.
const int pumpRelay=5;
void setup(){ pinMode(pumpRelay,OUTPUT); Serial.begin(9600); }
void loop(){
 int moisture=soil.read(); Serial.println(moisture);
 if(moisture<35){ digitalWrite(pumpRelay,HIGH); Serial.println("Riego activado"); }
 else { digitalWrite(pumpRelay,LOW); Serial.println("Humedad suficiente"); }
 delay(1200);
}`,
  conveyor: `// Banda transportadora con giro reversible
// API visual ProtoLab: conveyor.setSpeed(-255..255)
void setup(){ Serial.begin(9600); Serial.println("Banda lista"); }
void loop(){
 conveyor.setSpeed(180); Serial.println("Avance"); delay(1200);
 conveyor.setSpeed(85); Serial.println("Velocidad reducida"); delay(900);
 conveyor.setSpeed(-120); Serial.println("Marcha inversa"); delay(700);
 conveyor.setSpeed(0); Serial.println("Detenida"); delay(900);
}`,
  drone: `// Dron cuadricoptero educativo con cuatro rotores
// drone.setAll(0..255), drone.setMotor(1..4,0..255)
// drone.takeoff() y drone.land() animan el modelo 3D.
void setup(){ Serial.begin(115200); Serial.println("Control de vuelo inicializado"); }
void loop(){
  drone.setAll(90); drone.takeoff(); Serial.println("Despegue y estabilizacion"); delay(1800);
  drone.setAll(145); Serial.println("Ascenso controlado"); delay(1500);
  drone.setMotor(1,165); drone.setMotor(2,125); Serial.println("Correccion de actitud"); delay(1200);
  drone.setAll(110); Serial.println("Vuelo estacionario"); delay(1400);
  drone.land(); Serial.println("Aterrizaje"); delay(1800);
  drone.setAll(0); delay(900);
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
  const now = performance.now(); const dt = Math.min(.05, Math.max(.001, (now-lastAnimationTime)/1000)); lastAnimationTime = now;
  const t = now * .001;
  components.forEach(c => {
    if ((c.type === 'led' || c.type === 'rgb') && c.userData.light && c.active) c.userData.light.intensity = 1.8 + Math.sin(t * 7) * .22;
    if (c.type === 'servo' && c.userData.servoArm) { const target = THREE.MathUtils.degToRad((c.userData.servo ?? 90) - 90); c.userData.servoArm.rotation.y += (target-c.userData.servoArm.rotation.y)*.13; }
    if (c.type === 'buzzer' && c.userData.membrane) c.userData.membrane.position.y = .475 + (c.userData.sound ? Math.sin(t*(c.userData.frequency||440)*.04)*.018 : 0);
    if((c.type==='robotArm'||c.type==='robotArm6')&&c.userData.jointPivots){c.userData.jointPivots.forEach((pivot,i)=>{const angle=c.userData.jointTargets?.[i]??90;const target=THREE.MathUtils.degToRad(angle-90);const axis=i===0?'y':(c.type==='robotArm6'&&i===4?'z':'x');pivot.rotation[axis]+=(target-pivot.rotation[axis])*.12;});const grip=THREE.MathUtils.degToRad((c.userData.gripperTarget??25)/2);if(c.userData.gripperParts){c.userData.gripperParts[0].rotation.y=grip;c.userData.gripperParts[1].rotation.y=-grip;}}
    if(c.type==='conveyor'&&c.userData.rollers){const speed=c.userData.speed||0;c.userData.rollers.forEach(r=>r.rotation.x+=speed*dt*.006);}
    if(c.type==='drone'&&c.userData.propellers){const speeds=c.userData.motorSpeeds||[0,0,0,0];c.userData.propellers.forEach((rotor,i)=>{rotor.rotation.y+=speeds[i]*dt*.11*(i%2===0?1:-1);});const targetY=c.userData.flying?1.55:.18;c.group.position.y+=(targetY-c.group.position.y)*Math.min(1,dt*2.8);const tiltX=((speeds[0]+speeds[1])-(speeds[2]+speeds[3]))*.00055;const tiltZ=((speeds[0]+speeds[2])-(speeds[1]+speeds[3]))*.00055;c.userData.frame.rotation.x+=(tiltX-c.userData.frame.rotation.x)*.08;c.userData.frame.rotation.z+=(tiltZ-c.userData.frame.rotation.z)*.08;}
    if(c.type==='robotRover'&&c.userData.wheels){const d=c.userData.drive||{left:0,right:0};c.userData.wheels.forEach((wheel,i)=>{const speed=i%2===0?d.left:d.right;wheel.rotation.x+=speed*dt*.012;});if(Math.abs(d.left)+Math.abs(d.right)>0){c.userData.chassis.position.y=.68+Math.sin(t*18)*.018;c.userData.chassis.rotation.y+=(d.right-d.left)*dt*.0008;c.group.position.z+=((d.left+d.right)/2)*dt*.0008;c.group.position.z=THREE.MathUtils.clamp(c.group.position.z,-3.2,3.2);}else c.userData.chassis.position.y+=(.68-c.userData.chassis.position.y)*.1;}
    if(c.type==='hexapod'&&c.userData.legs){c.userData.legs.forEach(leg=>{const phase=t*5*(c.userData.walkSpeed||1)+leg.phase;const amp=c.userData.walking?.28:0;leg.hip.rotation.z=leg.side*(.08+Math.sin(phase)*amp);leg.knee.rotation.z=-leg.side*(.12+Math.max(0,Math.sin(phase))*amp*1.3);});}
    if(c.type==='stepper'&&c.userData.rotor){const target=THREE.MathUtils.degToRad(c.userData.stepTarget||0);c.userData.rotor.rotation.y+=(target-c.userData.rotor.rotation.y)*.18;}
    if(c.type==='motor'&&c.userData.motorShaft)c.userData.motorShaft.rotation.y+=(c.userData.speed||0)*dt*.01;
    if(c.type==='gripper'&&c.userData.gripperPivots){const a=THREE.MathUtils.degToRad((c.userData.gripperTarget||25)/2);c.userData.gripperPivots[0].rotation.y=a;c.userData.gripperPivots[1].rotation.y=-a;}
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
function setBoardPinAlias(boardObj, alias, actualName) { if(boardObj.pinNames[actualName]) boardObj.pinNames[alias]=boardObj.pinNames[actualName]; }
function addBoard(type, x, z, quiet = false, forcedId = null) {
  const group = new THREE.Group(); const id = forcedId || `board-${boardSerial++}`;
  const boardMeta = ({
    arduino: { name:'Arduino UNO R3', width:3.65, depth:2.5, color:0x16704e },
    unor4: { name:'Arduino UNO R4 WiFi', width:3.65, depth:2.5, color:0x16704e },
    teensy: { name:'Teensy 4.1', width:2.95, depth:1.85, color:0x1b5687 },
    esp32: { name:'ESP32 DevKit V1', width:2.7, depth:1.65, color:0x152c4b },
    mega: { name:'Arduino Mega 2560', width:4.55, depth:2.8, color:0x176b4e },
    nano: { name:'Arduino Nano', width:2.25, depth:1.65, color:0x176b4e },
    esp32s3: { name:'ESP32-S3 DevKit', width:2.95, depth:1.8, color:0x16395b },
    pico: { name:'Raspberry Pi Pico', width:2.35, depth:1.55, color:0x176c9c },
    picow: { name:'Raspberry Pi Pico W', width:2.35, depth:1.55, color:0x176c9c },
    stm32: { name:'STM32 Blue Pill', width:2.65, depth:1.85, color:0x185a9a },
    leonardo: { name:'Arduino Leonardo', width:3.65, depth:2.5, color:0x176b4e },
    esp8266: { name:'ESP8266 NodeMCU', width:2.75, depth:1.85, color:0x163e55 }
  })[type] || { name:type, width:2.7, depth:1.65, color:0x263d59 };
  const boardObj = { id, type, name:boardMeta.name, group, pins:[], pinNames:{}, width:boardMeta.width, depth:boardMeta.depth };
  group.position.set(x, .03, z); group.userData.ownerId = id; group.userData.type = type; scene.add(group); boards.push(boardObj); activeBoardId = id; updateBoardSelect();
  const pcb = baseMat(boardMeta.color, .5, .08);
  makeMesh(new THREE.BoxGeometry(boardObj.width, .16, boardObj.depth), pcb, group, [0, .06, 0]);
  // PCB edge chamfers and mounting holes.
  const holeMat = baseMat(0xd8d9d3, .3, .6), black = baseMat(0x101923, .32, .1), silver = baseMat(0xb9c5ce, .27, .78);
  for (const px of [-boardObj.width / 2 + .17, boardObj.width / 2 - .17]) for (const pz of [-boardObj.depth / 2 + .17, boardObj.depth / 2 - .17]) {
    makeMesh(new THREE.CylinderGeometry(.075, .075, .012, 16), holeMat, group, [px, .145, pz]);
    makeMesh(new THREE.CylinderGeometry(.043, .043, .016, 14), black, group, [px, .155, pz]);
  }
  if (type === 'arduino' || type === 'unor4') {
    // Arduino UNO family package, USB-B connector, barrel jack, oscillator and capacitors.
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
    const label = makeLabel(type==='unor4'?'UNO R4  WiFi':'ARDUINO  UNO', '#b7e8cb', 'rgba(13,72,52,.95)', 350, 64); label.position.set(.15, .16, .8); label.scale.set(1.1, .2, 1); group.add(label);
    const topPins = ['D0','D1','D2','D3','D4','D5','D6','D7','D8','D9','D10','D11','D12','D13'];
    topPins.forEach((name, i) => { const px = -.92 + i * .142; addPin(group, boardObj, name, [px, .26, -1.03], .055); boardObj.pinNames[name] = boardObj.pins.at(-1); makeMesh(new THREE.BoxGeometry(.09, .05, .12), black, group, [px, .16, -1.03]); });
    const bottomPins = ['IOREF','RESET','3V3','5V','GND','GND','VIN','A0','A1','A2','A3','A4','A5','SDA','SCL'];
    bottomPins.forEach((name, i) => { const px = -.99 + i * .14; addPin(group, boardObj, name, [px, .26, 1.04], .052); boardObj.pinNames[name] = boardObj.pins.at(-1); makeMesh(new THREE.BoxGeometry(.09, .05, .12), black, group, [px, .16, 1.04]); });
  } else if (type === 'esp32') {
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
    boardObj.pinNames.SDA=boardObj.pinNames.D21; boardObj.pinNames.SCL=boardObj.pinNames.D22;
    const label = makeLabel('ESP32  DEVKIT', '#c4daf8', 'rgba(20,48,79,.96)', 350, 64); label.position.set(0,.16,.92); label.scale.set(.9,.18,1); group.add(label);
  } else {
    // Extended development boards: realistic PCB silhouettes, chips and labeled pin rows.
    const topLabel = type === 'mega' ? 'MEGA 2560' : type === 'nano' ? 'NANO' : type === 'leonardo' ? 'LEONARDO' : type === 'esp32s3' ? 'ESP32-S3' : type === 'esp8266' ? 'ESP8266 NODEMCU' : type === 'picow' ? 'RASPBERRY PI PICO W' : type === 'pico' ? 'RASPBERRY PI PICO' : type === 'teensy' ? 'TEENSY 4.1' : 'STM32 BLUE PILL';
    makeMesh(new THREE.BoxGeometry(boardObj.width*.34,.22,boardObj.depth*.42), black, group, [0,.25,0]);
    makeMesh(new THREE.BoxGeometry(boardObj.width*.25,.035,boardObj.depth*.28), baseMat(type==='pico'?0x172b42:0x202e3c,.35,.3), group, [0,.38,0]);
    for(let i=0;i<6;i++) makeMesh(new THREE.BoxGeometry(.035,.018,.28),silver,group,[-.18+i*.072,.405,-.12]);
    const label=makeLabel(topLabel, type==='pico'?'#d6e9ff':'#c5e6d8', 'rgba(8,24,38,.95)', 360, 64);
    label.position.set(0,.17,boardObj.depth*.34); label.scale.set(Math.min(1.35,boardObj.width*.32),.19,1); group.add(label);
    const addNamedPin=(name,x,z,alias=null)=>{ addPin(group,boardObj,name,[x,.25,z],.048); const id=boardObj.pins.at(-1); boardObj.pinNames[name]=id; if(alias)boardObj.pinNames[alias]=id; makeMesh(new THREE.BoxGeometry(.075,.035,.075),black,group,[x,.135,z]); };
    if(type==='mega'){
      for(let n=0;n<27;n++){const x=-1.95+n*.15;addNamedPin(`D${n}`,x,-boardObj.depth*.42);}
      for(let n=27;n<54;n++){const x=-1.95+(n-27)*.15;addNamedPin(`D${n}`,x,boardObj.depth*.42);}
      for(let n=0;n<16;n++){const x=-1.55+n*.205;addNamedPin(`A${n}`,x,0);}
      ['5V','3V3','GND','VIN','SDA','SCL'].forEach((name,i)=>addNamedPin(name,-1.9+i*.24,boardObj.depth*.18));
    } else if(type==='nano'){
      const left=['D13','3V3','REF','A0','A1','A2','A3','A4','A5','A6','A7','5V','RST','GND','VIN'];
      const right=['D12','D11','D10','D9','D8','D7','D6','D5','D4','D3','D2','D1','D0','GND','5V'];
      left.forEach((name,i)=>addNamedPin(name,-.91,-.68+i*.097));
      right.forEach((name,i)=>addNamedPin(name,.91,-.68+i*.097));
      boardObj.pinNames.SDA=boardObj.pinNames.A4;boardObj.pinNames.SCL=boardObj.pinNames.A5;
    } else if(type==='leonardo'){
      const left=['D13','3V3','REF','A0','A1','A2','A3','A4','A5','A6','A7','5V','RST','GND','VIN'];
      const right=['D12','D11','D10','D9','D8','D7','D6','D5','D4','D3','D2','D1','D0','GND','5V'];
      left.forEach((name,i)=>addNamedPin(name,-1.27,-.99+i*.14));
      right.forEach((name,i)=>addNamedPin(name,1.27,-.99+i*.14));
      boardObj.pinNames.SDA=boardObj.pinNames.D2;boardObj.pinNames.SCL=boardObj.pinNames.D3;
    } else if(type==='esp8266'){
      const left=['3V3','GND','D8','D7','D6','D5','GND','3V3'];
      const right=['VIN','GND','D0','D1','D2','D3','D4','RX','TX'];
      left.forEach((name,i)=>addNamedPin(name,-1.02,-.62+i*.17));
      right.forEach((name,i)=>addNamedPin(name,1.02,-.68+i*.17));
      boardObj.pinNames.SDA=boardObj.pinNames.D2;boardObj.pinNames.SCL=boardObj.pinNames.D1;
      const led=makeMesh(new THREE.SphereGeometry(.06,14,10),new THREE.MeshStandardMaterial({color:0x42bde6,emissive:0x0a2235}),group,[.72,.29,.48]);boardObj.userLed=led;
    } else if(type==='esp32s3'){
      const left=['3V3','EN','GPIO4','GPIO5','GPIO6','GPIO7','GPIO8','GPIO9','GPIO10','GPIO11','GPIO12','GPIO13','GPIO14','GPIO15','GND'];
      const right=['5V','GND','GPIO1','GPIO2','GPIO3','GPIO16','GPIO17','GPIO18','GPIO21','GPIO33','GPIO34','GPIO35','GPIO36','GPIO37','GPIO38'];
      left.forEach((name,i)=>{const x=-1.17,z=-.69+i*.098;addNamedPin(name,x,z,name.startsWith('GPIO')?`D${name.slice(4)}`:null);});
      right.forEach((name,i)=>{const x=1.17,z=-.69+i*.098;addNamedPin(name,x,z,name.startsWith('GPIO')?`D${name.slice(4)}`:null);});
      boardObj.pinNames.SDA=boardObj.pinNames.D21;boardObj.pinNames.SCL=boardObj.pinNames.D18;
      const led=makeMesh(new THREE.SphereGeometry(.065,16,12),new THREE.MeshStandardMaterial({color:0x52b9ed,emissive:0x0b243a}),group,[.72,.28,.48]);boardObj.userLed=led;
    } else if(type==='pico'||type==='picow'){
      const left=['GP0','GP1','GND','GP2','GP3','GP4','GP5','GND','GP6','GP7','GP8','GP9','GND','GP10','GP11','GP12','GP13','GND','GP14','GP15'];
      const right=['GP16','GP17','GND','GP18','GP19','GP20','GP21','GND','GP22','RUN','GP26','GP27','GP28','ADC_VREF','3V3','3V3_EN','VBUS','VSYS','GND','GND'];
      left.forEach((name,i)=>{const z=-.64+i*.067;addNamedPin(name,-.91,z,name.startsWith('GP')?`D${name.slice(2)}`:null);});
      right.forEach((name,i)=>{const z=-.64+i*.067;addNamedPin(name,.91,z,name.startsWith('GP')?`D${name.slice(2)}`:null);});
      boardObj.pinNames.SDA=boardObj.pinNames.D4;boardObj.pinNames.SCL=boardObj.pinNames.D5;boardObj.pinNames['3V3']=boardObj.pinNames['3V3'];
    } else if(type==='teensy'){
      for(let n=0;n<14;n++)addNamedPin(`D${n}`,-1.12,-.72+n*.11);
      for(let n=0;n<10;n++)addNamedPin(`A${n}`,1.12,-.55+n*.12);
      ['3V3','GND','VIN','SDA','SCL'].forEach((name,i)=>addNamedPin(name,-.65+i*.32,.78));
    } else if(type==='stm32'){
      const left=Array.from({length:16},(_,i)=>`PA${i}`).concat(['3V3','GND']);
      const right=Array.from({length:16},(_,i)=>`PB${i}`).concat(['5V','GND']);
      left.forEach((name,i)=>{const z=-.72+i*.073;addNamedPin(name,-1.05,z,i<16?`D${i}`:null);});
      right.forEach((name,i)=>{const z=-.72+i*.073;addNamedPin(name,1.05,z,i<16?`D${i+16}`:null);});
      boardObj.pinNames.SDA=boardObj.pinNames.PB7;boardObj.pinNames.SCL=boardObj.pinNames.PB6;
    }
  }
  for (const child of group.children) if (child.isMesh && !child.userData.pinId) interactables.push(child);
  updateInventory();
  if (!quiet) { selectObject(boardObj); notify(`${boardObj.name} añadido`); }
  return boardObj;
}

function addPart(type, x, z, opts = {}) {
  const id = opts.id || `part-${serialId++}`;
  const onBreadboard = x > 2.65-2.78 && x < 2.65+2.78 && Math.abs(z) < 2.3;
  const group = new THREE.Group(); group.position.set(x, type==='drone' ? .18 : (onBreadboard ? .34 : .02), z); scene.add(group);
  const object = { id, type, group, pins: [], name: partName(type), value: opts.value ?? defaultValue(type), active: false, selected: false, userData: {} };
  group.userData.ownerId = id; group.userData.type = type;
  const pin = (name, px, pz, y = .07, r) => addPin(group, object, name, [px, y, pz], r || .052);
  const bodyDark = baseMat(0x1d2936, .44, .2), silver = baseMat(0xc4d0d6, .26, .78), leg = baseMat(0xaebdc5, .27, .8);
  if (type === 'led' || type === 'rgb') {
    const rgb = type === 'rgb';
    const ledPalette = { Rojo:0xff5c62, Amarillo:0xffc84b, Verde:0x42df8a, Azul:0x54a9ff, Blanco:0xe9f3ff };
    const ledHex = rgb ? 0x8ed5e8 : (ledPalette[String(object.value)] || 0xff5c62);
    const glass = new THREE.MeshPhysicalMaterial({ color: ledHex, roughness: .12, transmission: .06, thickness: .6, clearcoat: 1, clearcoatRoughness: .08, emissive: rgb ? 0x00151b : 0x120000, emissiveIntensity: .1 });
    makeMesh(new THREE.CylinderGeometry(.17, .18, .09, 24), baseMat(0x222e3d, .3, .35), group, [0, .25, 0]);
    const dome = makeMesh(new THREE.SphereGeometry(rgb ? .2 : .19, 24, 18), glass, group, [0, .39, 0]); dome.scale.y = .9;
    makeMesh(new THREE.CylinderGeometry(.115, .15, .07, 20), baseMat(rgb ? 0x708d9a : 0x9c3840, .2, .18), group, [0, .3, 0]);
    if (rgb) ['R','G','B','K'].forEach((n, i) => pin(n, -.24 + i * .16, .02, .035, .045));
    else { pin('A', -.115, 0, .02, .05); pin('K', .115, 0, .02, .05); }
    const light = new THREE.PointLight(rgb ? 0x6fd9ff : ledHex, 0, 2.2, 2); light.position.set(0, .6, 0); group.add(light);
    object.userData.dome = dome; object.userData.light = light; object.userData.baseColor = ledHex; object.userData.ledColor = ledHex;
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
  } else if (type === 'motor') {
    makeMesh(new THREE.CylinderGeometry(.3,.3,.78,32),baseMat(0x87939a,.28,.72),group,[0,.42,0]);
    makeMesh(new THREE.CylinderGeometry(.31,.31,.08,32),baseMat(0x243342,.3,.55),group,[0,.05,0]);
    const shaft=new THREE.Group();shaft.position.set(0,.84,0);group.add(shaft);
    makeMesh(new THREE.CylinderGeometry(.075,.075,.42,18),silver,shaft,[0,.2,0]);object.userData.motorShaft=shaft;object.userData.speed=0;
    pin('+',-.14,-.42,.035);pin('-',.14,-.42,.035);
  } else if (type === 'motorDriver') {
    makeMesh(new THREE.BoxGeometry(1.45,.13,1.12),baseMat(0x176548,.48,.1),group,[0,.16,0]);
    makeMesh(new THREE.BoxGeometry(.42,.3,.68),baseMat(0x252d35,.35,.45),group,[0,.37,-.05]);
    for(let i=0;i<6;i++)makeMesh(new THREE.BoxGeometry(.13,.16,.12),baseMat(0x9a7040,.55,.28),group,[-.56+i*.22,.29,.42]);
    for(let i=0;i<4;i++)makeMesh(new THREE.BoxGeometry(.1,.19,.12),baseMat(0xaaaeb0,.35,.55),group,[-.48+i*.32,.29,-.48]);
    ['ENA','IN1','IN2','IN3','IN4','ENB','5V','GND','12V'].forEach((n,i)=>pin(n,-.58+(i%5)*.28, i<5?-.58:.58,.035,.04));
    object.userData.enabled=false;
  } else if (type === 'stepperDriver') {
    makeMesh(new THREE.BoxGeometry(.95,.13,1.22),baseMat(0x1a6a55,.46,.12),group,[0,.13,0]);
    makeMesh(new THREE.BoxGeometry(.48,.28,.53),baseMat(0x262f3b,.35,.35),group,[0,.34,-.08]);
    makeMesh(new THREE.BoxGeometry(.34,.06,.32),baseMat(0x87949e,.3,.62),group,[0,.51,-.08]);
    for(let i=0;i<6;i++)makeMesh(new THREE.BoxGeometry(.075,.11,.075),baseMat(0xc4a45e,.35,.48),group,[-.34+i*.136,.28,.47]);
    ['VMOT','GND','VDD','STEP','DIR','EN','1A','1B','2A','2B'].forEach((n,i)=>pin(n,-.54+(i%5)*.27,i<5?-.59:.59,.035,.035));
  } else if (type === 'stepper') {
    makeMesh(new THREE.BoxGeometry(1.05,.18,1.05),baseMat(0x53616c,.3,.68),group,[0,.11,0]);
    makeMesh(new THREE.CylinderGeometry(.43,.43,.58,36),baseMat(0x9aa4aa,.28,.72),group,[0,.48,0]);
    makeMesh(new THREE.CylinderGeometry(.13,.13,.48,18),silver,group,[0,.98,0]);
    const rotor=new THREE.Group();rotor.position.set(0,.98,0);group.add(rotor);makeMesh(new THREE.BoxGeometry(.28,.035,.08),baseMat(0xe7d9b8,.25,.25),rotor,[.16,.14,0]);object.userData.rotor=rotor;object.userData.stepTarget=0;
    ['A1','A2','B1','B2','VCC','GND'].forEach((n,i)=>pin(n,-.5+i*.2,-.58,.035,.04));
  } else if (type === 'relay') {
    makeMesh(new THREE.BoxGeometry(1.12,.12,.9),baseMat(0x17684b,.46),group,[0,.13,0]);
    makeMesh(new THREE.BoxGeometry(.58,.44,.54),baseMat(0x1f4f9a,.42,.12),group,[.16,.4,-.02]);
    makeMesh(new THREE.BoxGeometry(.34,.1,.28),baseMat(0x172534,.35,.25),group,[-.32,.27,.06]);
    const led=makeMesh(new THREE.SphereGeometry(.065,14,12),new THREE.MeshStandardMaterial({color:0x4dff9b,emissive:0x001b09}),group,[-.37,.34,-.32]);object.userData.relayLed=led;object.userData.relayOn=false;
    ['VCC','GND','IN','NO','COM','NC'].forEach((n,i)=>pin(n,-.48+i*.19,-.5,.035,.04));
  } else if (type === 'dht') {
    makeMesh(new THREE.BoxGeometry(.72,.16,.86),baseMat(0xe7e8df,.68),group,[0,.18,0]);
    makeMesh(new THREE.BoxGeometry(.58,.06,.58),baseMat(0xf7f6ed,.8),group,[0,.28,0]);
    for(let i=0;i<6;i++)makeMesh(new THREE.BoxGeometry(.035,.012,.36),baseMat(0xc5c6bd,.8),group,[0,.32,-.22+i*.088]);
    ['VCC','DATA','NC','GND'].forEach((n,i)=>pin(n,-.3+i*.2,-.52,.035,.04));object.userData.temperature=24.5;object.userData.humidity=48;
  } else if (type === 'ir') {
    makeMesh(new THREE.BoxGeometry(.85,.12,.55),baseMat(0x176e57,.45),group,[0,.14,0]);
    makeMesh(new THREE.CylinderGeometry(.105,.105,.17,18),baseMat(0x141c27,.28,.25),group,[-.2,.3,-.04]);
    makeMesh(new THREE.CylinderGeometry(.105,.105,.17,18),baseMat(0x3d2020,.28,.25),group,[.2,.3,-.04]);
    makeMesh(new THREE.SphereGeometry(.07,14,12),baseMat(0x1a0b0c,.2,.2),group,[.2,.4,-.04]);
    ['VCC','OUT','GND'].forEach((n,i)=>pin(n,-.28+i*.28,-.35,.035,.04));object.userData.detected=false;
  } else if (type === 'mpu') {
    makeMesh(new THREE.BoxGeometry(.86,.13,.86),baseMat(0x176b9b,.45,.12),group,[0,.14,0]);
    makeMesh(new THREE.BoxGeometry(.38,.18,.38),baseMat(0x252f3c,.3,.3),group,[0,.29,0]);
    makeMesh(new THREE.BoxGeometry(.16,.02,.16),baseMat(0xa9b5bd,.35,.65),group,[0,.39,0]);
    ['VCC','GND','SCL','SDA','XDA','XCL','AD0','INT'].forEach((n,i)=>pin(n,-.34+i*.1,-.48,.035,.035));
  } else if (type === 'joystick') {
    makeMesh(new THREE.BoxGeometry(.98,.13,.98),baseMat(0x17634d,.5),group,[0,.13,0]);
    makeMesh(new THREE.CylinderGeometry(.28,.28,.17,28),baseMat(0x1e2b39,.4),group,[0,.27,0]);
    const stick=new THREE.Group();stick.position.set(0,.38,0);group.add(stick);makeMesh(new THREE.CylinderGeometry(.09,.1,.68,18),baseMat(0x303c47,.28,.25),stick,[0,.31,0]);makeMesh(new THREE.SphereGeometry(.2,22,16),baseMat(0x202a35,.25,.2),stick,[0,.66,0]);object.userData.stick=stick;
    ['GND','5V','VRX','VRY','SW'].forEach((n,i)=>pin(n,-.4+i*.2,-.55,.035,.04));object.userData.x=512;object.userData.y=512;
  } else if (type === 'lineSensor') {
    makeMesh(new THREE.BoxGeometry(1.15,.12,.55),baseMat(0x1a704e,.45),group,[0,.13,0]);
    for(const x of [-.36,0,.36]){makeMesh(new THREE.CylinderGeometry(.1,.1,.12,16),baseMat(0x141b22,.35),group,[x,.25,-.12]);makeMesh(new THREE.SphereGeometry(.055,12,10),baseMat(0x171d24,.2),group,[x,.32,-.12]);}
    ['VCC','GND','S1','S2','S3'].forEach((n,i)=>pin(n,-.42+i*.21,-.37,.035,.04));object.userData.values=[1,0,1];
  } else if (type === 'pir') {
    makeMesh(new THREE.BoxGeometry(.78,.13,.62),baseMat(0x17684e,.48),group,[0,.13,0]);
    makeMesh(new THREE.CylinderGeometry(.31,.31,.3,28),baseMat(0xcbd1c8,.22,.12),group,[0,.34,-.05]);
    const dome=makeMesh(new THREE.SphereGeometry(.31,24,18),new THREE.MeshPhysicalMaterial({color:0xe8e9dc,roughness:.18,transmission:.12,clearcoat:1}),group,[0,.5,-.05]);dome.scale.y=.58;
    ['VCC','OUT','GND'].forEach((n,i)=>pin(n,-.25+i*.25,-.36,.035,.04));object.userData.detected=false;
  } else if (type === 'soil') {
    makeMesh(new THREE.BoxGeometry(.48,.12,.58),baseMat(0x176c52,.48),group,[0,.16,.2]);
    makeMesh(new THREE.BoxGeometry(.1,.1,.15),baseMat(0x222e3a,.32,.25),group,[0,.27,.2]);
    for(const x of [-.13,.13]){makeMesh(new THREE.BoxGeometry(.055,.12,1.05),baseMat(0x9eabb1,.3,.7),group,[x,-.28,-.38]);makeMesh(new THREE.BoxGeometry(.07,.16,.2),baseMat(0xb9c3c8,.28,.7),group,[x,-.62,-.78]);}
    ['VCC','GND','AO','DO'].forEach((n,i)=>pin(n,-.3+i*.2,-.2,.035,.04));object.userData.moisture=42;
  } else if (type === 'bmp280') {
    makeMesh(new THREE.BoxGeometry(.64,.12,.68),baseMat(0x176ca0,.42,.2),group,[0,.13,0]);
    makeMesh(new THREE.BoxGeometry(.3,.18,.3),baseMat(0x222d39,.32,.35),group,[0,.29,-.04]);
    makeMesh(new THREE.BoxGeometry(.17,.025,.17),silver,group,[0,.39,-.04]);
    ['VCC','GND','SCL','SDA','CSB','SDO'].forEach((n,i)=>pin(n,-.34+i*.136,-.39,.035,.034));object.userData.temperature=23.8;object.userData.pressure=1012.7;
  } else if (type === 'rfid') {
    makeMesh(new THREE.BoxGeometry(1.12,.12,1.42),baseMat(0x174e80,.46,.18),group,[0,.13,0]);
    const coil=baseMat(0xd2a54c,.36,.62);for(let i=0;i<4;i++){const torus=makeMesh(new THREE.TorusGeometry(.42-i*.065,.018,7,48),coil,group,[0,.205,0]);torus.rotation.x=Math.PI/2;}
    makeMesh(new THREE.BoxGeometry(.27,.16,.24),bodyDark,group,[0,.27,-.47]);
    ['SDA','SCK','MOSI','MISO','IRQ','GND','RST','3V3'].forEach((n,i)=>pin(n,-.48+i*.137,-.72,.035,.03));
  } else if (type === 'servoDriver') {
    makeMesh(new THREE.BoxGeometry(1.22,.13,1.08),baseMat(0x176b52,.46),group,[0,.14,0]);
    makeMesh(new THREE.BoxGeometry(.36,.13,.36),baseMat(0x252f3d,.32,.42),group,[-.25,.27,.1]);
    makeMesh(new THREE.BoxGeometry(.18,.1,.2),silver,group,[.34,.25,-.22]);
    for(let i=0;i<16;i++){const x=-.51+(i%8)*.145,z=i<8?-.46:.46;pin(`CH${i}`,x,z,.035,.026);makeMesh(new THREE.BoxGeometry(.055,.035,.07),bodyDark,group,[x,.08,z]);}
    ['VCC','GND','SDA','SCL','OE'].forEach((n,i)=>pin(n,-.42+i*.21,.57,.035,.035));
  } else if (type === 'conveyor') {
    const frame=baseMat(0x35495a,.34,.62), beltMat=baseMat(0x202a32,.74,.04), rollerMat=baseMat(0x9daab3,.28,.68);
    makeMesh(new THREE.BoxGeometry(1.65,.18,2.2),frame,group,[0,.42,0]);makeMesh(new THREE.BoxGeometry(1.52,.08,1.78),beltMat,group,[0,.55,0]);
    const rollers=[];for(const z of [-.94,.94]){const roller=new THREE.Group();roller.position.set(0,.56,z);group.add(roller);makeMesh(new THREE.CylinderGeometry(.13,.13,1.55,24),rollerMat,roller,[0,0,0],[0,0,Math.PI/2]);rollers.push(roller);}
    for(const x of [-.65,.65])for(const z of [-.78,.78])makeMesh(new THREE.BoxGeometry(.1,.42,.1),frame,group,[x,.2,z]);
    makeMesh(new THREE.BoxGeometry(.42,.3,.42),baseMat(0x202d3a,.4,.4),group,[.98,.42,.62]);object.userData.rollers=rollers;object.userData.speed=0;
    ['VCC','GND','PWM','DIR'].forEach((n,i)=>pin(n,-.3+i*.2,-.65,.035,.04));
  } else if (type === 'drone') {
    const carbon=baseMat(0x202d3b,.34,.58), alloy=baseMat(0x9eacb8,.26,.72), shell=baseMat(0x176d83,.3,.42), propMat=baseMat(0x182532,.3,.28), lightGreen=new THREE.MeshStandardMaterial({color:0x49e3a2,emissive:0x06351d}), lightRed=new THREE.MeshStandardMaterial({color:0xff5f68,emissive:0x3c080b});
    const frame=new THREE.Group();group.add(frame);object.userData.frame=frame;
    makeMesh(new THREE.BoxGeometry(.92,.24,.78),shell,frame,[0,.48,0]);makeMesh(new THREE.BoxGeometry(.62,.12,.52),carbon,frame,[0,.64,0]);
    makeMesh(new THREE.BoxGeometry(.43,.16,.32),baseMat(0x202b38,.28,.6),frame,[0,.75,-.03]);makeMesh(new THREE.BoxGeometry(.32,.12,.27),baseMat(0x293a4a,.28,.62),frame,[0,.84,-.03]);
    const propellers=[];const positions=[[-1.18,-1.18],[1.18,-1.18],[-1.18,1.18],[1.18,1.18]];
    positions.forEach(([x,z],i)=>{const arm=new THREE.Group();arm.position.set(0,.48,0);frame.add(arm);const beam=makeMesh(new THREE.BoxGeometry(.16,.13,Math.hypot(x,z)*1.12),carbon,arm,[x*.5,0,z*.5]);beam.rotation.y=Math.atan2(x,z);const motor=new THREE.Group();motor.position.set(x,.06,z);arm.add(motor);makeMesh(new THREE.CylinderGeometry(.22,.22,.16,28),alloy,motor,[0,.05,0]);makeMesh(new THREE.CylinderGeometry(.09,.09,.12,20),carbon,motor,[0,.16,0]);const rotor=new THREE.Group();rotor.position.y=.24;motor.add(rotor);makeMesh(new THREE.BoxGeometry(.86,.025,.09),propMat,rotor,[0,0,0]);const blade2=makeMesh(new THREE.BoxGeometry(.86,.025,.09),propMat,rotor,[0,0,0]);blade2.rotation.y=Math.PI/2;makeMesh(new THREE.SphereGeometry(.065,14,10),alloy,rotor,[0,.025,0]);propellers.push(rotor);if(i<2){const led=makeMesh(new THREE.SphereGeometry(.08,12,10),i===0?lightGreen:lightRed,frame,[x*.9,.58,z*.9]);const glow=new THREE.PointLight(i===0?0x45ff9a:0xff4653,.55,1.2);glow.position.copy(led.position);frame.add(glow);}});
    for(const x of [-.36,.36]){const skid=new THREE.Group();skid.position.set(x,.18,0);frame.add(skid);makeMesh(new THREE.CylinderGeometry(.025,.025,.55,10),alloy,skid,[0,-.1,0]);makeMesh(new THREE.CylinderGeometry(.025,.025,.72,10),alloy,skid,[0,-.35,0],[Math.PI/2,0,0]);}
    object.userData.propellers=propellers;object.userData.motorSpeeds=[0,0,0,0];object.userData.flying=false;
    ['5V','GND','M1','M2','M3','M4'].forEach((n,i)=>pin(n,-.47+i*.19,-.58,.035,.035));
  } else if (type === 'robotArm6') {
    const alloy=baseMat(0xc2ccd4,.27,.76), blue=baseMat(0x176da8,.3,.5), joint=baseMat(0x273847,.3,.65), gold=baseMat(0xe2ac53,.27,.6), rubber=baseMat(0x17232d,.56,.08);
    makeMesh(new THREE.CylinderGeometry(.7,.76,.22,48),rubber,group,[0,.14,0]);makeMesh(new THREE.CylinderGeometry(.5,.58,.2,42),blue,group,[0,.34,0]);
    const pivots=[];const base=new THREE.Group();base.position.set(0,.48,0);group.add(base);pivots.push(base);makeMesh(new THREE.CylinderGeometry(.25,.3,.3,28),joint,base,[0,.16,0]);
    const shoulder=new THREE.Group();shoulder.position.set(0,.34,0);base.add(shoulder);pivots.push(shoulder);makeMesh(new THREE.SphereGeometry(.25,22,18),gold,shoulder,[0,0,0]);makeMesh(new THREE.BoxGeometry(.34,.28,1.0),blue,shoulder,[0,0,-.5]);
    const elbow=new THREE.Group();elbow.position.set(0,0,-1.0);shoulder.add(elbow);pivots.push(elbow);makeMesh(new THREE.SphereGeometry(.21,20,16),joint,elbow,[0,0,0]);makeMesh(new THREE.BoxGeometry(.27,.24,.82),alloy,elbow,[0,0,-.41]);
    const wrist1=new THREE.Group();wrist1.position.set(0,0,-.84);elbow.add(wrist1);pivots.push(wrist1);makeMesh(new THREE.SphereGeometry(.18,18,14),gold,wrist1,[0,0,0]);makeMesh(new THREE.BoxGeometry(.2,.2,.35),blue,wrist1,[0,0,-.17]);
    const wrist2=new THREE.Group();wrist2.position.set(0,0,-.36);wrist1.add(wrist2);pivots.push(wrist2);makeMesh(new THREE.CylinderGeometry(.14,.14,.24,20),joint,wrist2,[0,0,-.08],[Math.PI/2,0,0]);makeMesh(new THREE.BoxGeometry(.16,.16,.28),alloy,wrist2,[0,0,-.2]);
    const flange=new THREE.Group();flange.position.set(0,0,-.31);wrist2.add(flange);pivots.push(flange);makeMesh(new THREE.CylinderGeometry(.18,.18,.09,24),gold,flange,[0,0,-.02],[Math.PI/2,0,0]);
    const jawL=new THREE.Group();jawL.position.set(-.12,0,-.12);flange.add(jawL);makeMesh(new THREE.BoxGeometry(.07,.08,.32),alloy,jawL,[0,0,-.14]);const jawR=new THREE.Group();jawR.position.set(.12,0,-.12);flange.add(jawR);makeMesh(new THREE.BoxGeometry(.07,.08,.32),alloy,jawR,[0,0,-.14]);
    object.userData.jointPivots=pivots;object.userData.jointTargets=[90,70,110,90,90,90];object.userData.gripperTarget=25;object.userData.gripperParts=[jawL,jawR];
    ['5V','GND',...Array.from({length:6},(_,i)=>`J${i+1}`),'GRIP'].forEach((n,i)=>pin(n,-.62+i*.155,-.72,.035,.034));
  } else if (type === 'robotArm') {
    const alloy=baseMat(0xb9c7d2,.28,.72), blue=baseMat(0x176aa4,.32,.48), darkJoint=baseMat(0x263849,.32,.62), rubber=baseMat(0x17232d,.55,.1), gold=baseMat(0xdba84f,.28,.55);
    makeMesh(new THREE.CylinderGeometry(.66,.72,.22,48),rubber,group,[0,.14,0]);
    makeMesh(new THREE.CylinderGeometry(.48,.55,.2,40),blue,group,[0,.34,0]);
    const basePivot=new THREE.Group();basePivot.position.set(0,.48,0);group.add(basePivot);makeMesh(new THREE.CylinderGeometry(.25,.29,.28,28),darkJoint,basePivot,[0,.18,0]);
    const shoulder=new THREE.Group();shoulder.position.set(0,.38,0);basePivot.add(shoulder);makeMesh(new THREE.SphereGeometry(.27,24,18),gold,shoulder,[0,0,0]);
    makeMesh(new THREE.BoxGeometry(.34,.3,1.12),blue,shoulder,[0,0,-.58]);makeMesh(new THREE.BoxGeometry(.39,.13,.72),alloy,shoulder,[0,.02,-.58]);
    const elbow=new THREE.Group();elbow.position.set(0,0,-1.13);shoulder.add(elbow);makeMesh(new THREE.SphereGeometry(.24,24,18),darkJoint,elbow,[0,0,0]);
    makeMesh(new THREE.BoxGeometry(.28,.25,.92),alloy,elbow,[0,0,-.46]);makeMesh(new THREE.BoxGeometry(.32,.1,.68),blue,elbow,[0,-.02,-.46]);
    const wrist=new THREE.Group();wrist.position.set(0,0,-.93);elbow.add(wrist);makeMesh(new THREE.SphereGeometry(.19,20,16),gold,wrist,[0,0,0]);
    makeMesh(new THREE.BoxGeometry(.18,.18,.36),blue,wrist,[0,0,-.18]);
    const claw=new THREE.Group();claw.position.set(0,0,-.4);wrist.add(claw);makeMesh(new THREE.BoxGeometry(.3,.12,.22),darkJoint,claw,[0,0,-.05]);
    const leftFinger=new THREE.Group();leftFinger.position.set(-.14,0,-.12);claw.add(leftFinger);makeMesh(new THREE.BoxGeometry(.08,.1,.38),alloy,leftFinger,[0,0,-.17]);
    const rightFinger=new THREE.Group();rightFinger.position.set(.14,0,-.12);claw.add(rightFinger);makeMesh(new THREE.BoxGeometry(.08,.1,.38),alloy,rightFinger,[0,0,-.17]);
    object.userData.jointPivots=[basePivot,shoulder,elbow,wrist];object.userData.jointAngles=[90,55,115,90];object.userData.jointTargets=[90,55,115,90];object.userData.gripper=25;object.userData.gripperTarget=25;object.userData.gripperParts=[leftFinger,rightFinger];
    ['5V','GND','BASE','SHOULDER','ELBOW','WRIST','GRIP'].forEach((n,i)=>pin(n,-.58+i*.19,-.7,.035,.04));
  } else if (type === 'robotRover') {
    const chassis=new THREE.Group();group.add(chassis);object.userData.chassis=chassis;const roverRubber=baseMat(0x17232d,.62,.08);
    makeMesh(new THREE.BoxGeometry(1.65,.28,2.25),baseMat(0x263d50,.38,.4),chassis,[0,.48,0]);makeMesh(new THREE.BoxGeometry(1.35,.12,1.7),baseMat(0x176a50,.45,.12),chassis,[0,.68,0]);
    makeMesh(new THREE.BoxGeometry(.95,.22,.32),baseMat(0x303c49,.42,.3),chassis,[0,.82,-.55]);
    const wheels=[];for(const x of [-.94,.94])for(const z of [-.72,.72]){const wheel=new THREE.Group();wheel.position.set(x,.32,z);chassis.add(wheel);makeMesh(new THREE.CylinderGeometry(.31,.31,.2,32),roverRubber,wheel,[0,0,0],[0,0,Math.PI/2]);makeMesh(new THREE.CylinderGeometry(.17,.17,.205,24),baseMat(0xa1adb5,.28,.65),wheel,[0,0,0],[0,0,Math.PI/2]);wheels.push(wheel);}
    const head=makeMesh(new THREE.BoxGeometry(.92,.15,.38),baseMat(0x167c80,.42),chassis,[0,.62,-1.05]);
    for(const x of [-.25,.25]){makeMesh(new THREE.CylinderGeometry(.15,.15,.1,24),silver,chassis,[x,.68,-1.14],[Math.PI/2,0,0]);makeMesh(new THREE.CircleGeometry(.1,20),baseMat(0x4b7888,.24,.4),chassis,[x,.68,-1.2],[-Math.PI/2,0,0]);}
    object.userData.wheels=wheels;object.userData.drive={left:0,right:0};object.userData.steering=0;
    ['5V','GND','ENA','IN1','IN2','ENB','IN3','IN4','TRIG','ECHO'].forEach((n,i)=>pin(n,-.72+i*.16,-.9,.035,.035));
  } else if (type === 'hexapod') {
    const shell=baseMat(0x253f56,.3,.5), alloy2=baseMat(0xb9c5ce,.3,.7), jointMat=baseMat(0xd69c43,.3,.5);
    makeMesh(new THREE.BoxGeometry(1.18,.42,1.42),shell,group,[0,.72,0]);makeMesh(new THREE.BoxGeometry(.85,.13,1.05),baseMat(0x1b2b3b,.3,.5),group,[0,.99,0]);
    const legs=[];for(let side of [-1,1])for(let i=0;i<3;i++){const z=-.52+i*.52;const hip=new THREE.Group();hip.position.set(side*.54,.72,z);group.add(hip);makeMesh(new THREE.SphereGeometry(.15,16,12),jointMat,hip,[side*.08,0,0]);makeMesh(new THREE.BoxGeometry(.62,.12,.14),alloy2,hip,[side*.35,-.04,0],[0,0,side*.13]);const knee=new THREE.Group();knee.position.set(side*.66,-.04,0);hip.add(knee);makeMesh(new THREE.SphereGeometry(.11,14,12),jointMat,knee,[0,0,0]);makeMesh(new THREE.BoxGeometry(.12,.52,.13),alloy2,knee,[side*.02,-.25,0],[0,0,-side*.08]);legs.push({hip,knee,phase:i*Math.PI/2+(side>0?Math.PI:0),side});}
    object.userData.legs=legs;object.userData.walking=false;object.userData.walkSpeed=1;
    ['5V','GND',...Array.from({length:12},(_,i)=>`S${i+1}`)].forEach((n,i)=>pin(n,-.68+i*.105,-.77,.035,.03));
  } else if (type === 'gripper') {
    const metal2=baseMat(0xbac5cb,.27,.72), frame=baseMat(0x253d52,.35,.5);
    makeMesh(new THREE.BoxGeometry(.74,.18,.48),frame,group,[0,.18,0]);const pivotL=new THREE.Group();pivotL.position.set(-.2,.25,-.18);group.add(pivotL);const pivotR=new THREE.Group();pivotR.position.set(.2,.25,-.18);group.add(pivotR);
    makeMesh(new THREE.BoxGeometry(.13,.12,.62),metal2,pivotL,[-.05,0,-.28]);makeMesh(new THREE.BoxGeometry(.13,.12,.62),metal2,pivotR,[.05,0,-.28]);object.userData.gripperPivots=[pivotL,pivotR];object.userData.gripperTarget=25;
    ['5V','GND','SIG'].forEach((n,i)=>pin(n,-.24+i*.24,-.35,.035,.04));
  }
  components.push(object); for (const child of group.children) if (child.isMesh && !child.userData.isPin) interactables.push(child);
  updateInventory(); if (!opts.quiet) { selectObject(object); notify(`${object.name} añadido a la mesa`); }
  return object;
}
function partName(type) { return ({ led:'LED rojo', rgb:'LED RGB', resistor:'Resistencia', lcd:'Pantalla LCD 16×2', oled:'Pantalla OLED 128×64', matrix:'Matriz LED 8×8', segment:'Display 7 segmentos', button:'Push button', pot:'Potenciómetro', buzzer:'Zumbador', servo:'Servo motor SG90', ultrasonic:'Sensor HC-SR04', ldr:'Fotoresistencia LDR', capacitor:'Condensador', transistor:'Transistor NPN', motor:'Motor DC', motorDriver:'Driver L298N', stepperDriver:'Driver A4988', stepper:'Motor paso a paso NEMA 17', relay:'Módulo relay 1 canal', dht:'Sensor DHT22', ir:'Sensor infrarrojo IR', mpu:'IMU MPU6050', joystick:'Joystick analógico', lineSensor:'Seguidor de línea 3 canales', robotArm:'Brazo robótico 4 GDL', robotArm6:'Brazo robótico 6 GDL', drone:'Dron cuadricóptero', robotRover:'Rover robótico 4WD', hexapod:'Robot hexápodo', gripper:'Pinza robótica', conveyor:'Banda transportadora', servoDriver:'Driver PWM PCA9685', pir:'Sensor PIR de movimiento', soil:'Sensor de humedad de suelo', bmp280:'Sensor BMP280', rfid:'Lector RFID RC522' })[type] || type; }
function defaultValue(type) { return ({ resistor:220, capacitor:'100 µF', led:'Rojo', pot:512, ldr:640, transistor:'NPN', motor:'DC 6 V', motorDriver:'L298N', stepperDriver:'A4988 · microstepping', stepper:'NEMA 17 · 200 pasos', relay:'5 V · 10 A', dht:'24.5 °C / 48 %', ir:'Digital', mpu:'6 ejes', joystick:'X:512 Y:512', lineSensor:'3 canales', robotArm:'4 ejes + pinza', robotArm6:'6 ejes + pinza', drone:'4 motores brushless · ESC virtuales', robotRover:'4WD diferencial', hexapod:'6 patas · 12 servos', gripper:'Pinza 2 dedos', conveyor:'PWM · reversible', servoDriver:'16 canales PWM', pir:'Detección PIR', soil:'Humedad 0–100 %', bmp280:'Presión y temperatura', rfid:'13.56 MHz · RFID' })[type] ?? '—'; }

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
  return `D${Number(n)}`;
}
function updateCircuit() {
  const graph = buildGraph(); const activeWireIds = new Set(); let active = 0, total = components.filter(c=>c.type==='led'||c.type==='rgb').length, currentTotal = 0;
  const board = activeBoard(); let voltage = isEspBoard(board) ? 3.3 : 5;
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
    const ledHex=c.userData.ledColor||0xff5c62; const glowHex=new THREE.Color(ledHex).lerp(new THREE.Color(0xffffff),.34).getHex();
    if(c.userData.dome){c.userData.dome.material.emissive.setHex(lit?ledHex:0x120000);c.userData.dome.material.emissiveIntensity=lit?.25+power*1.45:.08;c.userData.dome.material.color.setHex(lit?glowHex:ledHex);}
    if(c.userData.light){c.userData.light.intensity=lit?1.2+power*3.2:0;c.userData.light.color.setHex(ledHex);}
    if(lit){active++;currentTotal+=Math.min(20,Math.max(0,(voltage-2)/Math.max(150,foundRes)*1000));}
  });
  components.filter(c=>c.type==='rgb').forEach(c=>{const common=c.pins.find(id=>pinMap.get(id)?.name==='K');const colors=['R','G','B'];const litColors=[];colors.forEach(ch=>{const p=c.pins.find(id=>pinMap.get(id)?.name===ch);let on=false;if(p&&common&&board){const out=[...outputs].some(([pin,v])=>v>0&&findPath(graph,p,getBoardPin(board,outputPinName(board,pin)))&&findPath(graph,common,getBoardPin(board,'GND')));on=out;}litColors.push(on);});const isOn=litColors.some(Boolean);c.active=isOn;if(isOn)active++;if(c.userData.light){c.userData.light.intensity=isOn?2.8:0;c.userData.light.color.setRGB(litColors[0]?1:0,litColors[1]?1:0,litColors[2]?1:0);}if(c.userData.dome){c.userData.dome.material.emissive.setRGB(litColors[0]?.5:0,litColors[1]?.5:0,litColors[2]?.5:0);}});
  components.filter(c=>c.type==='relay').forEach(relay=>{const input=partPinId(relay,'IN');const driven=Object.entries(board?.pinNames||{}).find(([name,id])=>/^D\d+$/.test(name)&&input&&findPath(graph,input,id)&&outputs.get(name.slice(1)));const on=!!driven;relay.userData.relayOn=on;if(relay.userData.relayLed){relay.userData.relayLed.material.emissive.setHex(on?0x1dff66:0x001b09);relay.userData.relayLed.material.emissiveIntensity=on?1.1:.1;}});
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
  ${type==='soil'?'<div class="prop-row"><span>Humedad del suelo (%)</span><input id="partValue" type="number" min=0 max=100 value="'+(object.userData.moisture??42)+'"></div>':''}
  ${type==='ultrasonic'?'<div class="prop-row"><span>Distancia (cm)</span><input id="partValue" type="number" min=2 max=400 value="'+(object.userData.distance??34)+'"></div>':''}
  ${type==='button'?'<div class="prop-row"><span>Entrada manual</span><button class="small-btn" id="toggleButton">'+(object.userData.pressed?'Presionado':'Presionar')+'</button></div>':''}
  ${type==='servo'?'<div class="prop-row"><span>Ángulo</span><input id="servoAngle" type="range" min=0 max=180 value="'+Math.round(object.userData.servo||90)+'"><b id="servoAngleLabel">'+Math.round(object.userData.servo||90)+'°</b></div>':''}
  ${(type==='robotArm'||type==='robotArm6')?(object.userData.jointTargets||[]).map((v,i)=>`<div class="prop-row"><span>${(type==='robotArm6'?['Base','Hombro','Codo','Muñeca 1','Muñeca 2','Rotación herramienta']:['Base','Hombro','Codo','Muñeca'])[i]}</span><input data-joint="${i}" type="range" min=0 max=180 value="${Math.round(v)}"><b>${Math.round(v)}°</b></div>`).join('')+'<div class="prop-row"><span>Apertura de pinza</span><input id="gripAngle" type="range" min=0 max=100 value="'+Math.round(object.userData.gripperTarget??25)+'"><b id="gripAngleLabel">'+Math.round(object.userData.gripperTarget??25)+'%</b></div>':''}
  ${type==='drone'?'<div class="prop-row"><span>Vuelo</span><button class="small-btn" id="droneFlight">'+(object.userData.flying?'Aterrizar':'Despegar')+'</button></div>'+[0,1,2,3].map(i=>'<div class="prop-row"><span>Motor '+(i+1)+'</span><input data-drone-motor="'+i+'" type="range" min=0 max=255 value="'+Math.round(object.userData.motorSpeeds?.[i]||0)+'"><b>'+Math.round(object.userData.motorSpeeds?.[i]||0)+'</b></div>').join(''):''}
  ${type==='robotRover'?'<div class="prop-row"><span>Motor izquierdo</span><input id="roverLeft" type="range" min=-255 max=255 value="'+Math.round(object.userData.drive?.left||0)+'"><b>'+Math.round(object.userData.drive?.left||0)+'</b></div><div class="prop-row"><span>Motor derecho</span><input id="roverRight" type="range" min=-255 max=255 value="'+Math.round(object.userData.drive?.right||0)+'"><b>'+Math.round(object.userData.drive?.right||0)+'</b></div>':''}
  ${type==='hexapod'?'<div class="prop-row"><span>Marcha</span><button class="small-btn" id="toggleWalk">'+(object.userData.walking?'Detener':'Caminar')+'</button></div>':''}
  ${type==='gripper'?'<div class="prop-row"><span>Apertura</span><input id="gripperOpen" type="range" min=0 max=100 value="'+Math.round(object.userData.gripperTarget||25)+'"><b id="gripperOpenLabel">'+Math.round(object.userData.gripperTarget||25)+'%</b></div>':''}
  ${type==='motor'||type==='conveyor'?'<div class="prop-row"><span>Velocidad / sentido</span><input id="motorSpeed" type="range" min=-255 max=255 value="'+Math.round(object.userData.speed||0)+'"><b id="motorSpeedLabel">'+Math.round(object.userData.speed||0)+'</b></div>':''}
  <div class="section-divider"></div><div class="block-title">PINES DISPONIBLES <span>CLICK EN CABLEADO</span></div><div class="pin-list">${pins.map(id=>{const p=pinMap.get(id);const connected=wires.some(w=>w.a===id||w.b===id);return `<span class="pin-chip ${connected?'connected':''}">${escapeHTML(p?.name||id)}</span>`}).join('')}</div>`;
  $('#partValue')?.addEventListener('change',e=>{if(type==='resistor')object.value=Math.max(1,Number(e.target.value)||220);else if(type==='soil')object.userData.moisture=THREE.MathUtils.clamp(Number(e.target.value)||0,0,100);else if(type==='ultrasonic')object.userData.distance=THREE.MathUtils.clamp(Number(e.target.value)||2,2,400);else object.userData.value=Number(e.target.value);updateInventory();updateCircuit();});
  $('#toggleButton')?.addEventListener('click',()=>{object.userData.pressed=!object.userData.pressed;object.userData.cap.position.y=object.userData.pressed?.31:.37;selectObject(object);updateCircuit();});
  $('#servoAngle')?.addEventListener('input',e=>{object.userData.servo=Number(e.target.value);object.userData.servoArm.rotation.y=THREE.MathUtils.degToRad(object.userData.servo-90);$('#servoAngleLabel').textContent=object.userData.servo+'°';});
  $('#inspectorContent').querySelectorAll('[data-joint]').forEach(input=>input.addEventListener('input',e=>{const i=Number(e.target.dataset.joint);object.userData.jointTargets[i]=Number(e.target.value);e.target.nextElementSibling.textContent=e.target.value+'°';}));
  $('#gripAngle')?.addEventListener('input',e=>{object.userData.gripperTarget=Number(e.target.value);$('#gripAngleLabel').textContent=e.target.value+'%';});
  $('#droneFlight')?.addEventListener('click',()=>{object.userData.flying=!object.userData.flying;selectObject(object);});
  $('#inspectorContent').querySelectorAll('[data-drone-motor]').forEach(input=>input.addEventListener('input',e=>{const i=Number(e.target.dataset.droneMotor);object.userData.motorSpeeds[i]=Number(e.target.value);e.target.nextElementSibling.textContent=e.target.value;}));
  $('#roverLeft')?.addEventListener('input',e=>{object.userData.drive.left=Number(e.target.value);e.target.nextElementSibling.textContent=e.target.value;});
  $('#roverRight')?.addEventListener('input',e=>{object.userData.drive.right=Number(e.target.value);e.target.nextElementSibling.textContent=e.target.value;});
  $('#toggleWalk')?.addEventListener('click',()=>{object.userData.walking=!object.userData.walking;selectObject(object);});
  $('#gripperOpen')?.addEventListener('input',e=>{object.userData.gripperTarget=Number(e.target.value);$('#gripperOpenLabel').textContent=e.target.value+'%';});
  $('#motorSpeed')?.addEventListener('input',e=>{object.userData.speed=Number(e.target.value);$('#motorSpeedLabel').textContent=e.target.value;});
}
function removeObject(object) {
  if (!object) return;
  if (object.group) {
    object.pins?.forEach(id=>pinMap.delete(id));
    wires.filter(w=>object.pins?.includes(w.a)||object.pins?.includes(w.b)).forEach(removeWire);
    scene.remove(object.group);
    if (boards.includes(object)) { boards=boards.filter(b=>b!==object); if(activeBoardId===object.id)activeBoardId=boards.find(isMCUBoard)?.id||''; updateBoardSelect(); } else components=components.filter(c=>c!==object);
    interactables=interactables.filter(m=>!object.group.children.includes(m));
    if(selectedObject===object)selectObject(null);
    updateInventory();updateCircuit();notify(`${object.name||partName(object.type)} eliminado`);
  }
}
function updateInventory() {
  const counts = new Map();
  [...boards.map(b=>b.name),...components.map(c=>partName(c.type))].forEach(name=>counts.set(name,(counts.get(name)||0)+1));
  const total=components.length+boards.length+wires.length; $('#totalMaterials').textContent=total; $('#materialsBadge').textContent=total;
  const list=$('#inventoryList'); const entries=[...counts.entries()]; if(wires.length) entries.push(['Cable jumper',wires.length]);
  list.innerHTML=entries.length?entries.map(([n,c])=>`<div class="inventory-row"><span>${escapeHTML(n)}</span><b>× ${c}</b></div>`).join(''):'<div class="inventory-empty">El inventario aparecerá aquí al añadir componentes.</div>';
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
canvas.addEventListener('pointermove',e=>{if(!draggingObject)return;const p=pointOnGround(e);if(!p)return;draggingObject.group.position.x=p.x+dragOffset.x;draggingObject.group.position.z=p.z+dragOffset.z;if(MCU_BOARD_TYPES.has(draggingObject.type))draggingObject.group.position.y=.03;else draggingObject.group.position.y=(draggingObject.group.position.x>-.13&&draggingObject.group.position.x<5.43&&Math.abs(draggingObject.group.position.z)<2.3)?.34:.02;wires.filter(w=>draggingObject.pins?.includes(w.a)||draggingObject.pins?.includes(w.b)).forEach(updateWireGeometry);});
canvas.addEventListener('pointerup',e=>{
  if(draggingObject){draggingObject=null;controls.enabled=true;pointerDown=null;updateCircuit();updateInventory();$('#sceneHelp').textContent='Shift + arrastrar para mover · R para girar · Arrastra vacío para girar la cámara';return;}
  if(!pointerDown||pointerDown.button!==0||Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)>5){pointerDown=null;return;}
  if(libraryMode){const point=pointOnGround(e);if(!point)return;
    if(MCU_BOARD_TYPES.has(libraryMode))addBoard(libraryMode,point.x,point.z);
    else addPart(libraryMode,point.x,point.z);
    libraryMode=null;wireMode=false;$('#sceneMode').textContent='MODO: SELECCIÓN';$('.lib-item.placing')?.classList.remove('placing');$('#connectMode').classList.remove('active');return;
  }
  const pinId=findPinHit(e);
  if(wireMode){if(!pinId){notify('Haz clic justo sobre un pin metálico');return;}if(!wireStart){wireStart=pinId;const p=pinMap.get(pinId);$('#sceneHelp').textContent=`Origen: ${p?.owner?.name||partName(p?.owner?.type)} · ${p?.name}. Elige el segundo pin.`;notify(`Pin inicial: ${p?.name}`);}else{const end=pinId;connectPins(wireStart,end,$('#wireColor').value);wireStart=null;$('#sceneHelp').textContent='Cable conectado. Selecciona otro par de pines para continuar.';}return;}
  rayFromEvent(e);const candidates=interactables.filter(o=>o&&o.isObject3D);const hit=raycaster.intersectObjects(candidates,true)[0];
  if(hit){let node=hit.object;let ownerId=null;while(node&&!ownerId){ownerId=node.userData?.ownerId;node=node.parent;}const obj=[...boards,...components].find(o=>o.id===ownerId);if(obj){if(MCU_BOARD_TYPES.has(obj.type)){activeBoardId=obj.id;updateBoardSelect();updateCircuit();}if(obj.type==='button'){obj.userData.pressed=!obj.userData.pressed;obj.userData.cap.position.y=obj.userData.pressed?.31:.37;updateCircuit();}selectObject(obj);return;}}
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
function adaptedExample(key){let code=examples[key]||examples.blink;const board=activeBoard();if(isEspBoard(board)){
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
  if(/^sonar\.read\s*\(\s*\)$/.test(text)){return Number(components.find(c=>c.type==='ultrasonic')?.userData.distance??34);}
  if(/^soil\.read\s*\(\s*\)$/.test(text)){return Number(components.find(c=>c.type==='soil')?.userData.moisture??42);}
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
function activeBoard(){return boards.find(b=>isMCUBoard(b)&&b.id===activeBoardId)||boards.find(isMCUBoard)||null;}
function updateBoardSelect(){const sel=$('#boardTarget');if(!sel)return;const boardsOnly=boards.filter(isMCUBoard);const current=activeBoardId;sel.innerHTML=boardsOnly.map(b=>`<option value="${escapeHTML(b.id)}">${escapeHTML(b.name)}</option>`).join('');if(boardsOnly.some(b=>b.id===current))sel.value=current;else if(boardsOnly[0]){activeBoardId=boardsOnly[0].id;sel.value=activeBoardId;}}
$('#boardTarget').addEventListener('change',e=>{activeBoardId=e.target.value;updateCircuit();notify(`Placa activa: ${activeBoard()?.name||'ninguna'}`);});
function findBoardForPin(pin){return activeBoard();}
function writeOutput(pin,value,analog=false){const key=String(pin);if(analog){analogOutputs.set(key,value);outputs.set(key,value>0?1:0);}else{outputs.set(key,value?255:0);analogOutputs.set(key,value?255:0);}updateCircuit();updateBoardUserLED();}
function updateBoardUserLED(){boards.forEach(b=>{if(isEspBoard(b)&&b.userLed){const v=outputs.get('2')||0;b.userLed.material.emissive.setHex(v?0x1255ff:0x0b243a);}});}
function displayObject(type){return components.find(c=>c.type===type&&c.userData.screen)||null;}
function displayTarget(type){return displayObject(type)?.userData.screen||null;}
function displayIsWired(type){
  const object=displayObject(type), board=activeBoard(); if(!object||!board)return false;
  const graph=buildGraph(); const wanted=[['SDA','SDA'],['SCL','SCL'],['GND','GND'],['VCC',is3V3Board(board)?'3V3':boardPowerPin(board)]];
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
    const d9=board?.pinNames[isEspBoard(board)?'D23':'D9'], gnd=board?.pinNames.GND;
    if(d9)connectPins(d9,r.pins[0],'#ef5555');connectPins(r.pins[1],d.pins[0],'#e8bd52');if(gnd)connectPins(d.pins[1],gnd,'#303d50');
  }
  if(example==='lcd'&&!components.some(c=>c.type==='lcd')){
    const lcd=addPart('lcd',2.8,1.55,{quiet:true,id:'lcd-1602'});
    autoConnectPart(lcd,[['GND','GND','#303d50'],['VCC',is3V3Board(board)?'3V3':boardPowerPin(board),'#ef5555'],['SDA','SDA','#e8bd52'],['SCL','SCL','#4d9ee8']]);
  }
  if(example==='matrix'&&!components.some(c=>c.type==='matrix')){
    const matrix=addPart('matrix',4.0,1.45,{quiet:true,id:'matrix-8x8'});
    if(isEspBoard(board))autoConnectPart(matrix,[['GND','GND','#303d50'],['VCC','3V3','#ef5555'],['DIN','D23','#e8bd52'],['CS','D5','#4d9ee8'],['CLK','D18','#50c995']]);
    else autoConnectPart(matrix,[['GND','GND','#303d50'],['VCC','5V','#ef5555'],['DIN','D11','#e8bd52'],['CS','D10','#4d9ee8'],['CLK','D13','#50c995']]);
  }
  if(example==='servo'&&!components.some(c=>c.type==='servo')){
    const servo=addPart('servo',4.1,-1.35,{quiet:true,id:'servo-sg90'});
    autoConnectPart(servo,[['GND','GND','#303d50'],[ '5V',isEspBoard(board)?'3V3':'5V','#ef5555'],['SIG',isEspBoard(board)?'D23':'D9','#e8bd52']]);
  }
  if(example==='button'&&!components.some(c=>c.type==='button')){
    const button=addPart('button',4.15,-.78,{quiet:true,id:'button-input'});
    autoConnectPart(button,[['1',isEspBoard(board)?'D4':'D2','#e8bd52'],['2','GND','#303d50']]);
  }
  if(example==='pot'&&!components.some(c=>c.type==='pot')){
    const pot=addPart('pot',4.2,.15,{quiet:true,id:'pot-analog'});
    autoConnectPart(pot,[['GND','GND','#303d50'],['SIG',isEspBoard(board)?'D34':'A0','#e8bd52'],['VCC',isEspBoard(board)?'3V3':'5V','#ef5555']]);
  }
  if(example==='oled'&&!components.some(c=>c.type==='oled')){
    const oled=addPart('oled',4.0,-.3,{quiet:true,id:'oled-12864'});
    autoConnectPart(oled,[['GND','GND','#303d50'],['VCC',is3V3Board(board)?'3V3':boardPowerPin(board),'#ef5555'],['SDA','SDA','#e8bd52'],['SCL','SCL','#4d9ee8']]);
  }
  if(example==='buzzer'&&!components.some(c=>c.type==='buzzer')){
    const buzzer=addPart('buzzer',4.25,-1.3,{quiet:true,id:'buzzer-1'});
    autoConnectPart(buzzer,[['+',isEspBoard(board)?'D23':'D8','#e8bd52'],['-','GND','#303d50']]);
  }
  const projectBoardType = ({robotArm:'mega',robotArm6:'mega',drone:'esp32',robotCar:'esp32',lineFollower:'nano',hexapod:'esp32s3',stepper:'mega',joystick:'arduino',dht:'esp32',relay:'arduino',imu:'picow',traffic:'leonardo',parking:'esp32',irrigation:'esp8266',conveyor:'mega'})[example];
  if(projectBoardType){let selectedBoard=boards.find(b=>b.type===projectBoardType);if(!selectedBoard){selectedBoard=addBoard(projectBoardType,-3.55,2.45,true);selectedBoard.group.position.y=.03;}activeBoardId=selectedBoard.id;updateBoardSelect();board=selectedBoard;}
  if(example==='robotArm'&&!components.some(c=>c.type==='robotArm')){
    const arm=addPart('robotArm',4.35,-.8,{quiet:true,id:'arm-4dof'});
    autoConnectPart(arm,[['5V','5V','#ef5555'],['GND','GND','#303d50'],['BASE','D9','#e8bd52'],['SHOULDER','D10','#e8bd52'],['ELBOW','D11','#e8bd52'],['WRIST','D12','#e8bd52'],['GRIP','D8','#e8bd52']]);
  }
  if((example==='robotCar'||example==='lineFollower')&&!components.some(c=>c.type==='robotRover')){
    const rover=addPart('robotRover',4.45,.9,{quiet:true,id:'rover-4wd'});
    const driver=addPart('motorDriver',1.7,2.7,{quiet:true,id:'driver-l298n'});
    for(const name of ['ENA','IN1','IN2','ENB','IN3','IN4']){const a=partPinId(rover,name),b=partPinId(driver,name);if(a&&b)connectPins(a,b,'#e8bd52');}
    const motorPins=isEspBoard(board)?[['ENA','D25'],['IN1','D26'],['IN2','D27'],['ENB','D14'],['IN3','D12'],['IN4','D13']]:[['ENA','D5'],['IN1','D7'],['IN2','D8'],['ENB','D6'],['IN3','D9'],['IN4','D10']];
    autoConnectPart(driver,[['5V',boardPowerPin(board),'#ef5555'],['GND','GND','#303d50'],...motorPins.map(([a,b])=>[a,b,'#e8bd52'])]);
    if(example==='lineFollower'){const sensor=addPart('lineSensor',4.2,-1.8,{quiet:true,id:'line-sensor-3ch'});autoConnectPart(sensor,[['VCC','5V','#ef5555'],['GND','GND','#303d50'],['S1','D2','#e8bd52'],['S2','D3','#e8bd52'],['S3','D4','#e8bd52']]);}
  }
  if(example==='hexapod'&&!components.some(c=>c.type==='hexapod')){
    const bot=addPart('hexapod',4.2,.8,{quiet:true,id:'hexapod-12servo'});
    const driver=addPart('servoDriver',1.65,2.55,{quiet:true,id:'hexapod-pca9685'});
    autoConnectPart(driver,[['VCC',boardPowerPin(board),'#ef5555'],['GND','GND','#303d50'],['SDA','SDA','#e8bd52'],['SCL','SCL','#4d9ee8']]);
    for(let i=0;i<12;i++){const a=partPinId(bot,`S${i+1}`),b=partPinId(driver,`CH${i}`);if(a&&b)connectPins(a,b,'#e8bd52');}
  }
  if(example==='stepper'&&!components.some(c=>c.type==='stepper')){
    const motor=addPart('stepper',4.1,.6,{quiet:true,id:'stepper-nema17'});const driver=addPart('stepperDriver',1.7,2.7,{quiet:true,id:'driver-a4988'});
    for(const [motorPin,driverPin] of [['A1','1A'],['A2','1B'],['B1','2A'],['B2','2B']]){const a=partPinId(motor,motorPin),b=partPinId(driver,driverPin);if(a&&b)connectPins(a,b,'#50c995');}
    autoConnectPart(driver,[['STEP','D2','#e8bd52'],['DIR','D3','#4d9ee8'],['EN','D4','#e8bd52'],['VDD','5V','#ef5555'],['GND','GND','#303d50'],['VMOT','VIN','#ef5555']]);
  }
  if(example==='joystick'&&!components.some(c=>c.type==='joystick')){const joy=addPart('joystick',4.15,.8,{quiet:true,id:'joystick-xy'});autoConnectPart(joy,[['GND','GND','#303d50'],['5V','5V','#ef5555'],['VRX','A0','#e8bd52'],['VRY','A1','#4d9ee8']]);}
  if(example==='dht'&&!components.some(c=>c.type==='dht')){const sensor=addPart('dht',4.2,.8,{quiet:true,id:'dht22-env'});autoConnectPart(sensor,[['VCC','3V3','#ef5555'],['GND','GND','#303d50'],['DATA','D4','#e8bd52']]);}
  if(example==='relay'&&!components.some(c=>c.type==='relay')){const relay=addPart('relay',4.15,.8,{quiet:true,id:'relay-1ch'});autoConnectPart(relay,[['VCC','5V','#ef5555'],['GND','GND','#303d50'],['IN','D7','#e8bd52']]);}
  if(example==='imu'&&!components.some(c=>c.type==='mpu')){const imu=addPart('mpu',4.15,.8,{quiet:true,id:'mpu6050'});autoConnectPart(imu,[['VCC',boardLogicPin(board),'#ef5555'],['GND','GND','#303d50'],['SDA','SDA','#e8bd52'],['SCL','SCL','#4d9ee8']]);}
  if(example==='robotArm6'&&!components.some(c=>c.type==='robotArm6')){const arm=addPart('robotArm6',4.3,-.7,{quiet:true,id:'arm-6dof'});const driver=addPart('servoDriver',1.65,2.55,{quiet:true,id:'pca9685-16ch'});autoConnectPart(driver,[['VCC','5V','#ef5555'],['GND','GND','#303d50'],['SDA','SDA','#e8bd52'],['SCL','SCL','#4d9ee8']]);for(let i=0;i<6;i++){const a=partPinId(arm,`J${i+1}`),b=partPinId(driver,`CH${i}`);if(a&&b)connectPins(a,b,'#e8bd52');}}
  if(example==='drone'&&!components.some(c=>c.type==='drone')){const quad=addPart('drone',4.15,.7,{quiet:true,id:'quadcopter-f450'});autoConnectPart(quad,[['5V',boardPowerPin(board),'#ef5555'],['GND','GND','#303d50'],['M1','D25','#e8bd52'],['M2','D26','#e8bd52'],['M3','D27','#e8bd52'],['M4','D14','#e8bd52']]);}
  if(example==='traffic'&&!components.some(c=>c.id==='traffic-red')){for(const [id,x,color] of [['traffic-red',3.65,'Rojo'],['traffic-yellow',4.25,'Amarillo'],['traffic-green',4.85,'Verde']]){const r=addPart('resistor',x,-.45,{quiet:true,id:id+'-r',value:220});const led=addPart('led',x,.35,{quiet:true,id,value:color});connectPins(r.pins[1],led.pins[0],'#e8bd52');const gnd=board?.pinNames.GND;if(gnd)connectPins(led.pins[1],gnd,'#303d50');}for(const [id,pin] of [['traffic-red','D8'],['traffic-yellow','D9'],['traffic-green','D10']]){const r=components.find(c=>c.id===id+'-r');if(r&&board?.pinNames[pin])connectPins(board.pinNames[pin],r.pins[0],'#ef5555');}}
  if(example==='parking'&&!components.some(c=>c.type==='ultrasonic')){const sonar=addPart('ultrasonic',4.15,-.45,{quiet:true,id:'hc-sr04-parking'});const buzzer=addPart('buzzer',4.15,1.15,{quiet:true,id:'parking-buzzer'});autoConnectPart(sonar,[['VCC',boardPowerPin(board),'#ef5555'],['GND','GND','#303d50'],['TRIG','D5','#e8bd52'],['ECHO','D18','#4d9ee8']]);autoConnectPart(buzzer,[['+','D23','#e8bd52'],['-','GND','#303d50']]);}
  if(example==='irrigation'&&!components.some(c=>c.type==='soil')){addPart('soil',4.2,-.65,{quiet:true,id:'soil-moisture'});const relay=addPart('relay',1.9,2.7,{quiet:true,id:'irrigation-relay'});const soil=components.find(c=>c.type==='soil');autoConnectPart(soil,[['VCC','3V3','#ef5555'],['GND','GND','#303d50'],['AO','D0','#e8bd52'],['DO','D1','#4d9ee8']]);autoConnectPart(relay,[['VCC',boardPowerPin(board),'#ef5555'],['GND','GND','#303d50'],['IN','D5','#e8bd52']]);}
  if(example==='conveyor'&&!components.some(c=>c.type==='conveyor')){const belt=addPart('conveyor',4.1,.7,{quiet:true,id:'conveyor-module'});autoConnectPart(belt,[['VCC','5V','#ef5555'],['GND','GND','#303d50'],['PWM','D9','#e8bd52'],['DIR','D8','#4d9ee8']]);}
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
  if((m=cmd.match(/^arm\.(?:write|move)\s*\(\s*([^)]+)\)$/))){const vals=m[1].split(',').map(v=>resolveNumber(v,symbols));const arm=components.find(c=>c.type==='robotArm');if(!arm){logSerial('Brazo no encontrado: agrega un Brazo robótico 4 GDL.');return null;}if(vals.some(v=>v===null))throw new Error('arm.write requiere cinco ángulos numéricos.');arm.userData.jointTargets=vals.slice(0,4).map(v=>THREE.MathUtils.clamp(v,0,180));if(vals.length>4)arm.userData.gripperTarget=THREE.MathUtils.clamp(vals[4],0,100);logSerial(`Brazo → base ${vals[0]}°, hombro ${vals[1]}°, codo ${vals[2]}°, muñeca ${vals[3]}°`);return null;}
  if((m=cmd.match(/^arm\.setJoint\s*\(\s*(\d+)\s*,\s*([^)]+)\)$/))){const arm=components.find(c=>c.type==='robotArm');const i=THREE.MathUtils.clamp(Number(m[1]),0,3);if(arm)arm.userData.jointTargets[i]=THREE.MathUtils.clamp(resolveNumber(m[2],symbols)??90,0,180);return null;}
  if((m=cmd.match(/^drone\.setAll\s*\(\s*([^)]+)\)$/))){const speed=THREE.MathUtils.clamp(resolveNumber(m[1],symbols)??0,0,255);components.filter(c=>c.type==='drone').forEach(c=>c.userData.motorSpeeds=[speed,speed,speed,speed]);return null;}
  if((m=cmd.match(/^drone\.setMotor\s*\(\s*(\d+)\s*,\s*([^)]+)\)$/))){const index=THREE.MathUtils.clamp(Number(m[1])-1,0,3),speed=THREE.MathUtils.clamp(resolveNumber(m[2],symbols)??0,0,255);components.filter(c=>c.type==='drone').forEach(c=>{c.userData.motorSpeeds[index]=speed;});return null;}
  if(/^drone\.takeoff\s*\(\s*\)$/.test(cmd)){components.filter(c=>c.type==='drone').forEach(c=>c.userData.flying=true);logSerial('Dron: despegue virtual');return null;}
  if(/^drone\.land\s*\(\s*\)$/.test(cmd)){components.filter(c=>c.type==='drone').forEach(c=>c.userData.flying=false);logSerial('Dron: aterrizaje virtual');return null;}
  if((m=cmd.match(/^arm6\.write\s*\(\s*([^)]+)\)$/))){const vals=m[1].split(',').map(v=>resolveNumber(v,symbols));const arm=components.find(c=>c.type==='robotArm6');if(!arm){logSerial('Brazo de 6 GDL no encontrado.');return null;}if(vals.some(v=>v===null)||vals.length<6)throw new Error('arm6.write requiere seis ángulos y una apertura opcional.');arm.userData.jointTargets=vals.slice(0,6).map(v=>THREE.MathUtils.clamp(v,0,180));if(vals.length>6)arm.userData.gripperTarget=THREE.MathUtils.clamp(vals[6],0,100);logSerial('Brazo 6 GDL: objetivo de articulaciones actualizado.');return null;}
  if((m=cmd.match(/^conveyor\.setSpeed\s*\(\s*([^)]+)\)$/))){const speed=THREE.MathUtils.clamp(resolveNumber(m[1],symbols)??0,-255,255);components.filter(c=>c.type==='conveyor').forEach(c=>c.userData.speed=speed);return null;}
  if((m=cmd.match(/^robot\.drive\s*\(\s*([^,]+)\s*,\s*([^)]+)\)$/))){const rover=components.find(c=>c.type==='robotRover');if(!rover){logSerial('Rover no encontrado: agrega un Rover 4WD.');return null;}rover.userData.drive={left:THREE.MathUtils.clamp(resolveNumber(m[1],symbols)??0,-255,255),right:THREE.MathUtils.clamp(resolveNumber(m[2],symbols)??0,-255,255)};return null;}
  if(/^robot\.stop\s*\(\s*\)$/.test(cmd)){components.filter(c=>c.type==='robotRover').forEach(c=>c.userData.drive={left:0,right:0});return null;}
  if((m=cmd.match(/^hexapod\.walk\s*\(\s*([^)]*)\)$/))){components.filter(c=>c.type==='hexapod').forEach(c=>{c.userData.walking=true;c.userData.walkSpeed=Math.max(.2,Math.abs(resolveNumber(m[1],symbols)??1));});return null;}
  if(/^hexapod\.stop\s*\(\s*\)$/.test(cmd)){components.filter(c=>c.type==='hexapod').forEach(c=>c.userData.walking=false);return null;}
  if((m=cmd.match(/^stepper\.(?:move|step)\s*\(\s*([^)]+)\)$/))){const steps=resolveNumber(m[1],symbols)??0;components.filter(c=>c.type==='stepper').forEach(c=>c.userData.stepTarget=(c.userData.stepTarget||0)+steps*Math.PI*2/200);logSerial(`Motor paso a paso: ${steps} pasos`);return null;}
  if((m=cmd.match(/^stepper\.setSpeed\s*\(\s*([^)]+)\)$/))){const speed=resolveNumber(m[1],symbols)??10;logSerial(`Velocidad de paso configurada: ${speed} RPM (modelo visual)`);return null;}
  if((m=cmd.match(/^motor\.(?:setSpeed|write)\s*\(\s*([^)]+)\)$/))){const speed=resolveNumber(m[1],symbols)??0;components.filter(c=>c.type==='motor').forEach(c=>c.userData.speed=THREE.MathUtils.clamp(speed,-255,255));return null;}
  if(/^#include/.test(cmd)||/^(?:Servo|RobotArm|RobotArm6|Stepper|LiquidCrystal_I2C|DHT|Adafruit_SSD1306)\s+\w+/.test(cmd))return null;
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

function serializeProject(){return {version:5,name:$('#projectName').textContent,boards:boards.filter(isMCUBoard).map(b=>({type:b.type,x:b.group.position.x,z:b.group.position.z,id:b.id})),activeBoardId,components:components.map(c=>({type:c.type,x:c.group.position.x,z:c.group.position.z,id:c.id,value:c.value,userData:{servo:c.userData.servo,value:c.userData.value,moisture:c.userData.moisture,distance:c.userData.distance,jointTargets:c.userData.jointTargets,gripperTarget:c.userData.gripperTarget,drive:c.userData.drive,walking:c.userData.walking,stepTarget:c.userData.stepTarget,speed:c.userData.speed,motorSpeeds:c.userData.motorSpeeds,flying:c.userData.flying}})),wires:wires.map(w=>({a:w.a,b:w.b,color:w.color})),code:editor.value};}
function saveProject(){localStorage.setItem('protolab-studio-project',JSON.stringify(serializeProject()));notify('Proyecto guardado en este navegador.');}
function loadProject(data){[...components,...boards].forEach(removeObject);wires.slice().forEach(removeWire);const boardIds=new Map();(data.boards||[]).forEach(b=>{if(MCU_BOARD_TYPES.has(b.type)){const created=addBoard(b.type,b.x,b.z,true,b.id);boardIds.set(b.id,created);}});activeBoardId=data.activeBoardId||boards.find(isMCUBoard)?.id||'';updateBoardSelect();(data.components||[]).forEach(c=>{const created=addPart(c.type,c.x,c.z,{quiet:true,id:c.id,value:c.value});if(c.userData){Object.assign(created.userData,c.userData);if(created.userData.servoArm&&c.userData.servo!=null)created.userData.servoArm.rotation.y=THREE.MathUtils.degToRad(c.userData.servo-90);if(created.userData.drive&&c.userData.drive)created.userData.drive={...c.userData.drive};if(c.userData.jointTargets)created.userData.jointTargets=[...c.userData.jointTargets];}});(data.wires||[]).forEach(w=>connectPins(w.a,w.b,w.color));if(data.code){editor.value=data.code;updateLineNumbers();}updateInventory();updateCircuit();notify('Proyecto cargado.');}
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
