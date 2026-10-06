const SCALE = 6;
const SMOOTH_TAU = 0.06;
const FLOW_W = 128;
const FLOW_H = 72;
const FLOW_SEARCH = 16;
const FLOW_DEADBAND = 20;
const FLOW_SIGN = -1;

let kingdom;
let cam;
let g;
let prevCols = null;
let zoom = 1;
let panX = 0;
let panMax = 0;
let speed = 0;
let lastTime = 0;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  background(0);
  lockGestures();

  cam = createPhoneCamera('environment', false, 'fitHeight');
  enableCameraTap('Tap to enable camera');

  g = createGraphics(FLOW_W, FLOW_H);
  g.pixelDensity(1);
  g.noSmooth();

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

function columnProfile() {
  const px = g.pixels;
  const cols = new Float32Array(FLOW_W);

  for (let x = 0; x < FLOW_W; x++) {
    let sum = 0;
    for (let y = 0; y < FLOW_H; y++) {
      const i = (y * FLOW_W + x) * 4;
      sum += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    }
    cols[x] = sum / FLOW_H;
  }
  return cols;
}

function correlationPeak(prev, cur) {
  let mp = 0;
  let mc = 0;
  for (let x = 0; x < FLOW_W; x++) {
    mp += prev[x];
    mc += cur[x];
  }
  mp /= FLOW_W;
  mc /= FLOW_W;

  const n = 2 * FLOW_SEARCH + 1;
  const scores = new Float32Array(n);
  let best = -Infinity;
  let bestI = FLOW_SEARCH;

  for (let d = -FLOW_SEARCH; d <= FLOW_SEARCH; d++) {
    let sum = 0;
    let count = 0;
    for (let x = 0; x < FLOW_W; x++) {
      const xx = x + d;
      if (xx < 0 || xx >= FLOW_W) continue;
      sum += (prev[x] - mp) * (cur[xx] - mc);
      count++;
    }
    const score = count > 0 ? sum / count : -Infinity;
    scores[d + FLOW_SEARCH] = score;
    if (score > best) {
      best = score;
      bestI = d + FLOW_SEARCH;
    }
  }

  const dx = bestI - FLOW_SEARCH;
  if (bestI === 0 || bestI === n - 1) return dx;

  const denom = scores[bestI - 1] - 2 * scores[bestI] + scores[bestI + 1];
  if (denom === 0) return dx;
  return dx + 0.5 * (scores[bestI - 1] - scores[bestI + 1]) / denom;
}

function advancePan(dt) {
  g.image(cam.video || cam.videoElement, 0, 0, FLOW_W, FLOW_H);
  g.loadPixels();

  const cols = columnProfile();
  if (!prevCols) {
    prevCols = cols;
    return;
  }

  const dx = correlationPeak(prevCols, cols);
  prevCols = cols;

  const rate = dx / dt;
  const target = Math.abs(rate) < FLOW_DEADBAND ? 0 : FLOW_SIGN * rate * SCALE;

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

  const live = window.cameraEnabled && cam && cam.ready;

  if (live && dt > 0) {
    advancePan(dt);
  } else {
    prevCols = null;
  }

  const srcW = width / zoom;
  const srcH = height / zoom;
  const srcX = constrain(panX / zoom, 0, kingdom.width - srcW);
  const srcY = (kingdom.height - srcH) / 2;

  image(kingdom, 0, 0, width, height, srcX, srcY, srcW, srcH);

  if (!live) {
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(20);
    text(
      window.cameraEnabled ? 'Starting camera…' : 'Tap the screen to start',
      width / 2,
      height / 2
    );
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layout();
}

function mousePressed() {
  prevCols = null;
  speed = 0;
  return false;
}
