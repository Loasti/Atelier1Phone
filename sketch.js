const SCALE = 400;
const MAX_ACCEL = 8;
const MAX_SPEED = 3000;
const SMOOTH_TAU = 0.06;
const REST_ACCEL = 0.6;
const ARM_TIME = 0.5;

let kingdom;
let zoom = 1;
let panX = 0;
let panMax = 0;
let speed = 0;
let baseline = 0;
let armLeft = ARM_TIME;
let armSum = 0;
let armN = 0;
let lastTime = 0;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  background(0);
  lockGestures();
  enableSensorTap('Tap to enable motion sensors');

  kingdom = await loadImage('KingdomStillImage.png');
  lastTime = millis() / 1000;
  layout();
}

function layout() {
  const fitHeight = height / kingdom.height;
  const fitWidth = width / kingdom.width;
  zoom = fitHeight;
  panMax = kingdom.width * zoom - width;
  if (panMax <= 0) {
    zoom = fitWidth;
    panMax = 0;
  }
  panX = constrain(panX, 0, panMax);
}

function advancePan(dt) {
  const raw = accelerationX || 0;

  if (armLeft > 0) {
    armSum += raw;
    armN++;
    armLeft -= dt;
    speed = 0;
    if (armLeft <= 0 && armN > 0) baseline = armSum / armN;
    return;
  }

  const a = constrain(raw - baseline, -MAX_ACCEL, MAX_ACCEL);
  const target = abs(a) < REST_ACCEL ? 0 : SCALE * a;

  speed = lerp(speed, target, constrain(dt / (SMOOTH_TAU + dt), 0, 1));
  panX = constrain(panX + speed * dt, 0, panMax);
}

function draw() {
  background(0);

  if (!kingdom) {
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(18);
    text('Loading image…', width / 2, height / 2);
    return;
  }

  const now = millis() / 1000;
  const dt = constrain(now - lastTime, 0, 0.1);
  lastTime = now;

  if (window.sensorsEnabled && dt > 0) {
    advancePan(dt);
  }

  const srcW = width / zoom;
  const srcH = height / zoom;
  const srcX = constrain(panX / zoom, 0, kingdom.width - srcW);
  const srcY = (kingdom.height - srcH) / 2;

  image(kingdom, 0, 0, width, height, srcX, srcY, srcW, srcH);

  if (!window.sensorsEnabled) {
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(20);
    text('Tap the screen to start', width / 2, height / 2);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layout();
}

function mousePressed() {
  if (window.sensorsEnabled) {
    armLeft = ARM_TIME;
    armSum = 0;
    armN = 0;
    speed = 0;
  }
  return false;
}
