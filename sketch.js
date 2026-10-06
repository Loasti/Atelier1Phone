const FRICTION = 0.985;
const ACCEL_SCALE = 0.25;
const MAX_SPEED = 12;
const BASELINE_DRIFT = 0.004;

let kingdom;
let zoom = 1;
let panX = 0;
let panMax = 0;
let vel = 0;
let baseline = 0;
let baselineReady = false;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  background(0);
  lockGestures();
  enableSensorTap('Tap to enable motion sensors');

  kingdom = await loadImage('KingdomStillImage.png');
  layout();
}

function layout() {
  zoom = height / kingdom.height;
  panMax = max(0, kingdom.width * zoom - width);
  panX = constrain(panX, 0, panMax);
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

  if (!window.sensorsEnabled) {
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(20);
    text('Tap the screen to start', width / 2, height / 2);
    return;
  }

  const raw = accelerationX || 0;

  if (!baselineReady) {
    baseline = raw;
    baselineReady = true;
  }
  baseline = lerp(baseline, raw, BASELINE_DRIFT);

  vel += (raw - baseline) * ACCEL_SCALE;
  vel *= FRICTION;
  vel = constrain(vel, -MAX_SPEED, MAX_SPEED);

  const next = panX + vel;
  if (next <= 0 || next >= panMax) {
    vel = 0;
    panX = constrain(next, 0, panMax);
  } else {
    panX = next;
  }

  const srcW = width / zoom;
  const srcH = height / zoom;
  const srcX = panX / zoom;
  const srcY = (kingdom.height - srcH) / 2;

  image(kingdom, 0, 0, width, height, srcX, srcY, srcW, srcH);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layout();
}

function mousePressed() {
  baselineReady = false;
  vel = 0;
  return false;
}
