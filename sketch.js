// Otto Field
// An AR window into a tabletop world. Point the rear camera at a tabletop and
// an Otto — the Otto1.gif sprite — anchors itself above the largest green
// object in view. The green object is the origin of a small tabletop field:
// food and other players' Ottos live in that field, and this Otto wanders,
// eats, flees or hunts according to its six stats.

const SCAN_W = 160;
const SCAN_H = 90;
const SCAN_EVERY = 2;
const MIN_BLOB = 0.0025; // smallest green blob, as a fraction of the scan frame

const SHARE_HOST = 'https://p5-phone-share.npuckett.workers.dev';
const SHARE_ROOM = 'a1-orbit';
const SHARE_APP = 'my-project';

// Transparent bounds around the creature inside the 360 × 360 GIF.
const OTTO_CROP = { x: 109, y: 135, w: 135, h: 149 };

// The tabletop field is measured in field units. The green marker is four
// units across, so a 7 cm sticky note makes one unit about 1.75 cm. Sight,
// speed and food distances are all in these units, which keeps the behaviour
// physical: moving the phone closer scales the field, not the rules.
const FIELD_UNITS_ACROSS = 4;
const FIELD_TILT = 0.55; // vertical squash, so the field reads as a tabletop plane
const FIELD_RADIUS = 22; // Ottos stay inside this radius, and inside the screen
const OTTO_UNITS_TALL = 3.2;
const EAT_RADIUS = 1.3;
const CONTACT_RADIUS = 1.9;
const FLEE_RANGE = 12;

// Food and time.
const FOOD_AMOUNT = 10;
const FOOD_MAX = 6;
const FOOD_RADIUS = 0.45;
const SPAWN_EVERY = 5;
const DAY_SECONDS = 240; // a whole EnergyRequirement burns over this many seconds

const FIGHT_COOLDOWN = 1.1;

const STAT_ROWS = [
  { key: 'attack', label: 'ATTACK', min: 1, max: 30, step: 1 },
  { key: 'speed', label: 'SPEED', min: 0.5, max: 8, step: 0.1 },
  { key: 'size', label: 'SIZE', min: 0.4, max: 2.5, step: 0.05 },
  { key: 'sight', label: 'SIGHT', min: 2, max: 20, step: 1 },
  { key: 'aggression', label: 'AGGRESSION', min: 0, max: 30, step: 1 },
  { key: 'energyRequirement', label: 'ENERGY/DAY', min: 10, max: 120, step: 5 },
];

const MODE_LABEL = {
  wander: 'WANDERING',
  eat: 'SEEKING FOOD',
  flee: 'FLEEING',
  hunt: 'HUNTING',
};

let cam;
let scan;
let mask;
let visited;
let stack;

let marker;
let otto;
let ottoGif;
let field;
let remote = new Map();
let localFood = {};
let foodSpawnTimer = 0;

let lastMillis = 0;
let scanTick = 0;
let joinHit = null;
let tuneHit = null;
let panel = { open: false, rows: [], drag: null, fieldHit: null };
let showField = false;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(min(2, displayDensity()));
  frameRate(60);
  lockGestures();
  textFont('monospace');

  // Shared room for the class session. `me.otto` is this phone's creature;
  // the other phones see it in `guests`. Food lives in `shared.food`.
  shareSetup({
    host: SHARE_HOST,
    room: SHARE_ROOM,
    app: SHARE_APP,
    shared: { food: {} },
    me: {
      name: 'Otto',
      otto: { x: 0, y: 0, size: 1, attack: 10, aggression: 10, sight: 8 },
    },
  });

  scan = createGraphics(SCAN_W, SCAN_H);
  scan.pixelDensity(1);
  scan.noSmooth();

  mask = new Uint8Array(SCAN_W * SCAN_H);
  visited = new Uint8Array(SCAN_W * SCAN_H);
  stack = new Int32Array(SCAN_W * SCAN_H);

  ottoGif = null;
  try {
    ottoGif = await loadImage('Otto1.gif');
  } catch (e) {
    console.warn('Could not load Otto1.gif', e);
  }

  resetTracking();
  seedFood(localFood, 3);
  lastMillis = millis() / 1000;

  cam = createPhoneCamera('environment', false, 'cover');
  enableCameraTap('TAP TO ENTER THE OTTO FIELD');
  showDesktopQr({ label: 'Scan to open on your phone' });
}

function shareReady() {
  // Keep the shared schema stable even if another client created the room.
  if (!shared.food || typeof shared.food !== 'object') shared.food = {};
  remote.clear();
  foodSpawnTimer = 0;
  if (shareIsHost) seedFood(shared.food, 3);
}

function resetTracking() {
  marker = { found: false, x: 0, y: 0, w: 0, h: 0, size: 0 };
  field = { ok: false, x: 0, y: 0, px: 40, tx: 0, ty: 0, tpx: 40 };
  localFood = {};
  foodSpawnTimer = 0;

  otto = {
    has: false,
    lock: 0,
    lost: 0,
    pos: { x: 0, y: 0 },
    facing: 1,
    moving: false,
    pop: 0,
    mode: 'wander',
    target: null,
    wander: null,
    think: 0,
    fightCd: 0,
    energy: 50,
    stats: {
      attack: 10,
      speed: 2.5,
      size: 1,
      sight: 8,
      aggression: 10,
      energyRequirement: 50,
    },
  };
  otto.energy = otto.stats.energyRequirement * 0.55;
}

function draw() {
  const now = millis() / 1000;
  const dt = constrain(now - lastMillis, 0, 0.1);
  lastMillis = now;

  const live =
    window.cameraEnabled &&
    cam &&
    cam.ready &&
    cam.videoElement &&
    cam.videoElement.readyState >= 2;

  if (!live) {
    drawWaiting(now);
    return;
  }

  image(cam);

  if (++scanTick >= SCAN_EVERY) {
    scanTick = 0;
    scanForGreen();
  }

  updateField(dt);
  updateRemote(dt);
  updateFood(dt);

  if (marker.found && !otto.has) enterField();

  if (marker.found) {
    otto.lost = 0;
    otto.lock += (1 - otto.lock) * (1 - Math.exp(-dt / 0.12));
  } else {
    otto.lost += dt;
    if (otto.lost > 0.12) otto.lock *= Math.exp(-dt / 0.18);
  }

  if (otto.has && field.ok) {
    updateBehaviour(dt);
    otto.pop *= Math.exp(-dt / 0.18);
  }

  drawFood();
  if (showField) drawFieldDebug();
  drawRemoteOttos();
  drawLocalOtto();
  drawHud();
  if (panel.open) drawPanel();
}

// ---------------------------------------------------------------- detection

function scanForGreen() {
  const video = cam.video || cam.videoElement;
  if (!video) return;

  scan.image(video, 0, 0, SCAN_W, SCAN_H);
  scan.loadPixels();
  const px = scan.pixels;

  // Mark pixels that are clearly green: green dominates both other channels
  // and carries a little saturation, so greys, skin, wood and white paper drop out.
  mask.fill(0);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const r = px[p];
    const g = px[p + 1];
    const b = px[p + 2];
    if (g < 46) continue;
    const high = r > b ? r : b;
    const low = r < b ? r : b;
    if (g > high * 1.1 && g - low > g * 0.2) mask[i] = 1;
  }

  // Largest connected green blob wins. Everything else is noise on the table.
  visited.fill(0);
  let bestArea = 0;
  let bestSx = 0;
  let bestSy = 0;
  let bestMinX = 0;
  let bestMaxX = 0;
  let bestMinY = 0;
  let bestMaxY = 0;

  for (let y = 0; y < SCAN_H; y++) {
    for (let x = 0; x < SCAN_W; x++) {
      const start = y * SCAN_W + x;
      if (!mask[start] || visited[start]) continue;

      let head = 0;
      let tail = 0;
      stack[tail++] = start;
      visited[start] = 1;

      let area = 0;
      let sx = 0;
      let sy = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (head < tail) {
        const idx = stack[head++];
        const pxX = idx % SCAN_W;
        const pxY = (idx - pxX) / SCAN_W;

        area++;
        sx += pxX;
        sy += pxY;
        if (pxX < minX) minX = pxX;
        if (pxX > maxX) maxX = pxX;
        if (pxY < minY) minY = pxY;
        if (pxY > maxY) maxY = pxY;

        if (pxX > 0) {
          const n = idx - 1;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack[tail++] = n; }
        }
        if (pxX < SCAN_W - 1) {
          const n = idx + 1;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack[tail++] = n; }
        }
        if (pxY > 0) {
          const n = idx - SCAN_W;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack[tail++] = n; }
        }
        if (pxY < SCAN_H - 1) {
          const n = idx + SCAN_W;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack[tail++] = n; }
        }
      }

      if (area > bestArea) {
        bestArea = area;
        bestSx = sx / area;
        bestSy = sy / area;
        bestMinX = minX;
        bestMaxX = maxX;
        bestMinY = minY;
        bestMaxY = maxY;
      }
    }
  }

  if (bestArea < SCAN_W * SCAN_H * MIN_BLOB) {
    marker.found = false;
    return;
  }

  // Map scan-buffer coordinates back into the camera's on-screen rectangle.
  const dims = cam.getDimensions();
  marker.found = true;
  marker.x = dims.x + ((bestSx + 0.5) / SCAN_W) * dims.width;
  marker.y = dims.y + ((bestSy + 0.5) / SCAN_H) * dims.height;
  marker.w = ((bestMaxX - bestMinX + 1) / SCAN_W) * dims.width;
  marker.h = ((bestMaxY - bestMinY + 1) / SCAN_H) * dims.height;
  marker.size = Math.sqrt(marker.w * marker.h);
}

// -------------------------------------------------------------------- field

function updateField(dt) {
  if (marker.found) {
    field.tx = marker.x;
    field.ty = marker.y;
    field.tpx = marker.w / FIELD_UNITS_ACROSS;

    if (!field.ok) {
      // First lock: snap straight to the marker instead of sliding in.
      field.x = field.tx;
      field.y = field.ty;
      field.px = field.tpx;
      field.ok = true;
    }
  }
  if (!field.ok) return;

  const kp = 1 - Math.exp(-dt / 0.09);
  const ks = 1 - Math.exp(-dt / 0.16);
  field.x = lerp(field.x, field.tx, kp);
  field.y = lerp(field.y, field.ty, kp);
  field.px = lerp(field.px, field.tpx, ks);
}

// How far the Otto may roam before it would leave the camera view. The marker
// is rarely centred, so this shrinks towards the nearest screen edge.
function fieldLimit() {
  if (!field || !field.ok || !otto) return 3;
  const pxy = field.px * FIELD_TILT;
  const sprite = OTTO_UNITS_TALL * otto.stats.size * field.px;
  const acrossX = Math.min(field.x, width - field.x) / field.px;
  const down = (height - field.y) / pxy;
  const up = (field.y - sprite) / pxy;
  const limit = Math.min(acrossX, down, Math.max(0.5, up));
  return Math.max(3, Math.min(FIELD_RADIUS, limit * 0.85));
}

function fieldToScreen(fx, fy) {
  return {
    x: field.x + fx * field.px,
    y: field.y + fy * field.px * FIELD_TILT,
  };
}

function enterField() {
  otto.has = true;
  otto.lock = 0;
  otto.pos.x = 0;
  otto.pos.y = 0;
  otto.energy = otto.stats.energyRequirement * 0.55;
  otto.mode = 'wander';
  otto.target = null;
  otto.wander = null;
  otto.think = 0;
  otto.fightCd = 0;
}

// ---------------------------------------------------------------- behaviour

function updateBehaviour(dt) {
  const st = otto.stats;

  otto.fightCd = Math.max(0, otto.fightCd - dt);
  otto.energy = Math.max(
    0,
    otto.energy - (st.energyRequirement / DAY_SECONDS) * dt
  );

  const store = currentFood();
  if (store) eatNearby(store);

  otto.think -= dt;
  if (otto.think <= 0) {
    otto.think = 0.25;
    chooseIntent();
  }

  moveOtto(dt);

  // Keep the Otto on the tabletop and inside the camera view.
  const limit = fieldLimit();
  const d = Math.hypot(otto.pos.x, otto.pos.y);
  if (d > limit) {
    otto.pos.x = (otto.pos.x / d) * limit;
    otto.pos.y = (otto.pos.y / d) * limit;
  }

  syncMe();
}

function chooseIntent() {
  const st = otto.stats;

  // Nearest other Otto inside the sight radius.
  let enemy = null;
  let enemyD = Infinity;
  for (const r of remote.values()) {
    const d = Math.hypot(r.x - otto.pos.x, r.y - otto.pos.y);
    if (d <= st.sight + r.size * 0.6 && d < enemyD) {
      enemy = r;
      enemyD = d;
    }
  }

  // Nearest food inside the sight radius.
  let food = null;
  let foodD = Infinity;
  const store = currentFood();
  if (store) {
    for (const id in store) {
      const f = store[id];
      if (!f || typeof f.x !== 'number') continue;
      const d = Math.hypot(f.x - otto.pos.x, f.y - otto.pos.y);
      if (d <= st.sight && d < foodD) {
        food = f;
        foodD = d;
      }
    }
  }

  // Aggression against the other Otto's Size decides fight or flight.
  const scared = enemy && st.aggression < enemy.size * 10;
  const hungry = otto.energy < st.energyRequirement * 0.98;

  if (scared) {
    otto.mode = 'flee';
    otto.target = { x: enemy.x, y: enemy.y };
    return;
  }

  if (food && hungry) {
    otto.mode = 'eat';
    otto.target = { x: food.x, y: food.y };
    return;
  }

  if (enemy) {
    otto.mode = 'hunt';
    otto.target = { x: enemy.x, y: enemy.y, foe: enemy };
    return;
  }

  otto.mode = 'wander';
  if (
    !otto.wander ||
    Math.hypot(otto.wander.x - otto.pos.x, otto.wander.y - otto.pos.y) < 1.5
  ) {
    const a = Math.random() * Math.PI * 2;
    const r = 1 + Math.random() * Math.min(8, fieldLimit() * 0.6);
    otto.wander = { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  otto.target = otto.wander;
}

function moveOtto(dt) {
  const st = otto.stats;
  const t = otto.target;
  otto.moving = false;
  if (!t) return;

  let tx = t.x;
  let ty = t.y;
  let speed = st.speed * (otto.energy <= 0 ? 0.45 : 1);

  if (otto.mode === 'flee') {
    const dx = otto.pos.x - t.x;
    const dy = otto.pos.y - t.y;
    const d = Math.hypot(dx, dy) || 1;
    tx = otto.pos.x + (dx / d) * FLEE_RANGE;
    ty = otto.pos.y + (dy / d) * FLEE_RANGE;
    speed *= 1.2;
  } else if (otto.mode === 'wander') {
    speed *= 0.45;
  }

  const dx = tx - otto.pos.x;
  const dy = ty - otto.pos.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.06) {
    const step = Math.min(d, speed * dt);
    otto.pos.x += (dx / d) * step;
    otto.pos.y += (dy / d) * step;
    otto.facing = dx >= 0 ? 1 : -1;
    otto.moving = true;
  }

  if (otto.mode === 'hunt') fightIfTouching();
}

function fightIfTouching() {
  if (otto.fightCd > 0) return;
  const foe = otto.target && otto.target.foe;
  if (!foe || !remote.has(foe.id)) return;

  const d = Math.hypot(foe.x - otto.pos.x, foe.y - otto.pos.y);
  if (d > CONTACT_RADIUS + foe.size * 0.4) return;

  otto.fightCd = FIGHT_COOLDOWN;
  const win = otto.stats.attack >= foe.attack;
  const bite = Math.max(2, foe.attack * 0.6);
  otto.energy = Math.max(0, otto.energy - (win ? bite * 0.4 : bite));

  // Bounce apart. The other phone runs the same comparison from the same
  // broadcast stats, so both creatures see the same result.
  const nx = otto.pos.x - foe.x || 0.001;
  const ny = otto.pos.y - foe.y || 0.001;
  const n = Math.hypot(nx, ny);
  otto.pos.x += (nx / n) * 2.4;
  otto.pos.y += (ny / n) * 2.4;
  otto.pop = 1;
  otto.wander = null;
}

function eatNearby(store) {
  const full = otto.stats.energyRequirement;
  if (otto.energy >= full) return;

  for (const id in store) {
    const f = store[id];
    if (!f || typeof f.x !== 'number') continue;
    if (Math.hypot(f.x - otto.pos.x, f.y - otto.pos.y) > EAT_RADIUS) continue;

    otto.energy = Math.min(
      full,
      otto.energy + (Number(f.amount) || FOOD_AMOUNT)
    );
    delete store[id];
    otto.pop = 1;
    return;
  }
}

// --------------------------------------------------------------------- food

function currentFood() {
  if (shareConnected) return shared.food || null;
  return localFood;
}

function updateFood(dt) {
  const store = currentFood();
  if (!store) return;

  // Any phone may top up the room, not just the host. Spawning stays capped at
  // FOOD_MAX, so a room whose host is an old or idle client still gets food.
  foodSpawnTimer -= dt;
  if (foodSpawnTimer > 0) return;

  foodSpawnTimer = SPAWN_EVERY;
  const count = Object.keys(store).length;
  seedFood(store, count === 0 ? 2 : 1);
}

function seedFood(store, howMany) {
  let count = Object.keys(store).length;
  for (let i = 0; i < howMany && count < FOOD_MAX; i++, count++) {
    const a = Math.random() * Math.PI * 2;
    const reach = Math.min(FIELD_RADIUS * 0.75, fieldLimit() * 0.75);
    const r = 1.5 + Math.random() * reach;
    store['f' + Math.floor(Math.random() * 1e9)] = {
      x: Math.round(Math.cos(a) * r * 100) / 100,
      y: Math.round(Math.sin(a) * r * 100) / 100,
      amount: FOOD_AMOUNT,
    };
  }
}

// --------------------------------------------------------------------- share

function syncMe() {
  if (!window.me) return;
  const o = me.otto || (me.otto = {});
  o.x = Math.round(otto.pos.x * 100) / 100;
  o.y = Math.round(otto.pos.y * 100) / 100;
  o.size = Math.round(otto.stats.size * 100) / 100;
  o.attack = otto.stats.attack;
  o.aggression = otto.stats.aggression;
  o.sight = otto.stats.sight;
}

function updateRemote(dt) {
  const seen = new Set();

  if (shareConnected && Array.isArray(guests)) {
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i];
      const data = g && g.otto;
      if (!data || typeof data.x !== 'number') continue;

      const id = g.id || 'guest-' + i;
      seen.add(id);

      let r = remote.get(id);
      if (!r) {
        r = {
          id,
          x: data.x,
          y: data.y,
          tx: data.x,
          ty: data.y,
          size: 1,
          attack: 10,
          aggression: 10,
          sight: 8,
          facing: 1,
          lock: 0,
        };
        remote.set(id, r);
      }

      r.tx = data.x;
      r.ty = data.y;
      r.size = numberOr(data.size, 1);
      r.attack = numberOr(data.attack, 10);
      r.aggression = numberOr(data.aggression, 10);
      r.sight = numberOr(data.sight, 8);
      if (Math.abs(r.tx - r.x) > 0.02) r.facing = r.tx >= r.x ? 1 : -1;
    }
  }

  for (const [id, r] of remote) {
    if (!seen.has(id)) {
      r.lock -= dt * 3;
      if (r.lock <= 0) remote.delete(id);
      continue;
    }
    const k = 1 - Math.exp(-dt / 0.08);
    r.x = lerp(r.x, r.tx, k);
    r.y = lerp(r.y, r.ty, k);
    r.lock = lerp(r.lock, 1, 1 - Math.exp(-dt / 0.15));
  }
}

function numberOr(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

// ------------------------------------------------------------------ drawing

function drawWaiting(now) {
  background(5, 8, 12);

  noStroke();
  fill(235, 250, 255, 230);
  textAlign(CENTER, CENTER);
  textSize(constrain(width * 0.075, 22, 44));
  text('OTTO FIELD', width / 2, height * 0.44);

  fill(130, 200, 225, 200);
  textSize(constrain(width * 0.034, 11, 16));
  text(
    window.cameraEnabled ? 'STARTING CAMERA...' : 'TAP TO START',
    width / 2,
    height * 0.44 + min(width, height) * 0.1
  );
}

function drawLocalOtto() {
  if (!otto.has || otto.lock < 0.01 || !ottoGif || !field.ok) return;
  const p = fieldToScreen(otto.pos.x, otto.pos.y);
  drawOttoAt(p.x, p.y, otto.stats.size, otto.lock, otto.facing, otto.pop);
}

function drawRemoteOttos() {
  if (!field.ok || !ottoGif) return;
  for (const r of remote.values()) {
    if (r.lock <= 0.01) continue;
    const p = fieldToScreen(r.x, r.y);
    drawOttoAt(p.x, p.y, r.size, r.lock, r.facing, 0);
  }
}

function drawOttoAt(cx, groundY, size, alpha, facing, pop) {
  const h = OTTO_UNITS_TALL * size * field.px * (1 + pop * 0.1);
  const w = h * (OTTO_CROP.w / OTTO_CROP.h);
  const ctx = drawingContext;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, groundY);
  ctx.scale(facing, 1);
  image(
    ottoGif,
    -w / 2,
    -h,
    w,
    h,
    OTTO_CROP.x,
    OTTO_CROP.y,
    OTTO_CROP.w,
    OTTO_CROP.h
  );
  ctx.restore();
}

function drawFood() {
  if (!field.ok) return;
  const store = currentFood();
  if (!store) return;

  const ctx = drawingContext;
  for (const id in store) {
    const f = store[id];
    if (!f || typeof f.x !== 'number') continue;

    const p = fieldToScreen(f.x, f.y);
    const r = Math.max(3, FOOD_RADIUS * field.px);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, FIELD_TILT);
    ctx.fillStyle = 'rgba(255, 196, 92, 0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 238, 196, 0.7)';
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.stroke();
    ctx.restore();
  }
}

function drawFieldDebug() {
  if (!field.ok) return;

  const ctx = drawingContext;
  const lim = fieldLimit();
  const st = otto.stats;

  ctx.save();
  ctx.strokeStyle = 'rgba(126, 255, 190, 0.14)';
  ctx.lineWidth = 1;
  for (let u = -lim; u <= lim; u += 3) {
    const a = fieldToScreen(u, -lim);
    const b = fieldToScreen(u, lim);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    const c = fieldToScreen(-lim, u);
    const d = fieldToScreen(lim, u);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }

  const p = fieldToScreen(otto.pos.x, otto.pos.y);
  const rx = st.sight * field.px;
  const ry = rx * FIELD_TILT;
  ctx.strokeStyle = 'rgba(126, 255, 190, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(126, 255, 190, 0.2)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx * 0.5, ry * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ----------------------------------------------------------------------- hud

function drawHud() {
  const s = constrain(width * 0.031, 10, 16);
  const found = marker.found;
  const st = otto.stats;
  const online = shareConnected
    ? (Array.isArray(guests) ? guests.length : 0) + 1
    : 0;

  push();
  noStroke();

  // Title.
  textAlign(LEFT, TOP);
  fill(240, 252, 255, 235);
  textSize(s * 1.15);
  text('OTTO FIELD', 18, 16);
  fill(120, 220, 255, 150);
  textSize(s * 0.72);
  text('GREEN-MARKER FIELD', 18, 16 + s * 1.55);

  // Room state.
  let roomText = 'PLAYING SOLO';
  let roomTone = [150, 200, 220];
  if (shareConnected) {
    roomText = `ROOM ${SHARE_ROOM} · ${online} ONLINE`;
    roomTone = [126, 255, 190];
  } else if (shareStatus === 'connecting') {
    roomText = 'JOINING SHARED SPACE...';
    roomTone = [255, 205, 120];
  } else if (shareStatus === 'unsupported') {
    roomText = 'SHARED SPACE UNSUPPORTED';
    roomTone = [255, 150, 150];
  } else if (shareStatus === 'error' || shareError) {
    roomText = 'SHARED SPACE ERROR';
    roomTone = [255, 150, 150];
  }
  fill(roomTone[0], roomTone[1], roomTone[2], 190);
  textSize(s * 0.66);
  text(roomText, 18, 16 + s * 2.95);

  // Stats.
  fill(170, 215, 235, 160);
  textSize(s * 0.6);
  text(
    `ATK ${st.attack} · SPD ${st.speed.toFixed(1)} · SIZE ${st.size.toFixed(2)}`,
    18,
    16 + s * 4.05
  );
  text(
    `SIGHT ${st.sight.toFixed(0)} · AGG ${st.aggression} · NEED ${st.energyRequirement.toFixed(0)}`,
    18,
    16 + s * 5.1
  );
  fill(255, 214, 140, 170);
  text(
    otto.has
      ? `ENERGY ${Math.round(otto.energy)}/${st.energyRequirement.toFixed(0)} · ${
          MODE_LABEL[otto.mode] || ''
        }`
      : 'NO OTTO YET · SHOW IT A GREEN OBJECT',
    18,
    16 + s * 6.15
  );

  // Tracking and tuning, kept clear of the desktop QR in the top-right corner.
  const rowH = s * 1.9;
  const rowY = 16 + s * 7.45;
  const label = found ? 'LOCKED' : 'SEEKING';
  const tone = found ? [126, 255, 190] : [255, 200, 110];

  noStroke();
  fill(tone[0], tone[1], tone[2], 230);
  circle(22, rowY + rowH / 2, s * 0.5);

  textAlign(LEFT, CENTER);
  textSize(s * 0.68);
  const labelW = textWidth(label);
  fill(tone[0], tone[1], tone[2], 220);
  text(label, 34, rowY + rowH / 2 + 1);

  const chipW = s * 4.4;
  const chipH = rowH;
  const chipX = 34 + labelW + 16;
  const chipY = rowY;
  tuneHit = { x: chipX, y: chipY, w: chipW, h: chipH };

  noFill();
  stroke(panel.open ? color(126, 255, 190, 170) : color(140, 230, 255, 85));
  strokeWeight(1);
  rect(chipX, chipY, chipW, chipH, chipH / 2);
  noStroke();
  fill(panel.open ? color(126, 255, 190, 230) : color(150, 235, 255, 200));
  textAlign(CENTER, CENTER);
  textSize(s * 0.58);
  text(panel.open ? 'CLOSE' : 'TUNE', chipX + chipW / 2, chipY + chipH / 2 + 1);

  // Join button, drawn only while the room is not connected.
  joinHit = null;
  if (!shareConnected && shareSupported && !panel.open) {
    let joinLabel = 'JOIN SHARED SPACE';
    if (shareStatus === 'connecting') joinLabel = 'JOINING SHARED SPACE...';
    else if (shareStatus === 'error' || shareError) joinLabel = 'RETRY SHARED SPACE';

    textSize(s * 0.72);
    const bw = textWidth(joinLabel) + 34;
    const bh = s * 2.2;
    const bx = width / 2 - bw / 2;
    const by = height - 52 - bh;

    joinHit = { x: bx, y: by, w: bw, h: bh };

    noFill();
    stroke(140, 230, 255, 90);
    strokeWeight(1);
    rect(bx, by, bw, bh, bh / 2);

    noStroke();
    fill(150, 235, 255, 205);
    textAlign(CENTER, CENTER);
    text(joinLabel, width / 2, by + bh / 2 + 1);
  }

  // Hint.
  if (!panel.open) {
    textAlign(CENTER, BOTTOM);
    fill(205, 232, 245, 180);
    textSize(s * 0.8);
    text(
      found ? 'TAP TO MAKE IT HOP' : 'POINT AT A GREEN OBJECT ON THE TABLE',
      width / 2,
      height - 20
    );
  }

  pop();
}

// --------------------------------------------------------------------- panel

function layoutPanel() {
  const w = Math.min(width - 24, 380);
  const rowH = Math.max(30, Math.min(42, height * 0.048));
  const headH = rowH * 1.15;
  const h = headH + STAT_ROWS.length * rowH + 10;
  const x = (width - w) / 2;
  const y = height - h - 12;

  panel.x = x;
  panel.y = y;
  panel.w = w;
  panel.h = h;
  panel.rowH = rowH;
  panel.headH = headH;
  panel.fieldHit = { x: x + w - 78, y: y + 7, w: 66, h: headH - 14 };

  const trackX = x + 98;
  const trackW = w - 98 - 56;
  panel.rows = STAT_ROWS.map((row, i) => ({
    ...row,
    y: y + headH + i * rowH,
    trackX,
    trackW,
  }));
}

function drawPanel() {
  layoutPanel();

  const s = constrain(width * 0.031, 10, 16);
  const st = otto.stats;

  push();
  noStroke();
  fill(4, 10, 16, 234);
  rect(panel.x, panel.y, panel.w, panel.h, 14);

  textAlign(LEFT, CENTER);
  fill(150, 225, 250, 220);
  textSize(s * 0.8);
  text('STATS', panel.x + 14, panel.y + panel.headH / 2);

  const fh = panel.fieldHit;
  noFill();
  stroke(showField ? color(126, 255, 190, 190) : color(90, 120, 140, 150));
  strokeWeight(1);
  rect(fh.x, fh.y, fh.w, fh.h, fh.h / 2);
  noStroke();
  fill(showField ? color(126, 255, 190, 230) : color(140, 175, 195, 190));
  textAlign(CENTER, CENTER);
  textSize(s * 0.58);
  text('FIELD', fh.x + fh.w / 2, fh.y + fh.h / 2 + 1);

  for (const row of panel.rows) {
    const cy = row.y + panel.rowH / 2;
    const t = constrain(
      (st[row.key] - row.min) / (row.max - row.min),
      0,
      1
    );

    fill(175, 210, 230, 190);
    textAlign(LEFT, CENTER);
    textSize(s * 0.6);
    text(row.label, panel.x + 14, cy);

    stroke(52, 74, 92, 220);
    strokeWeight(3);
    line(row.trackX, cy, row.trackX + row.trackW, cy);

    stroke(126, 255, 190, 220);
    line(row.trackX, cy, row.trackX + row.trackW * t, cy);

    noStroke();
    fill(240, 255, 250, 240);
    circle(row.trackX + row.trackW * t, cy, s * 0.9);

    fill(210, 240, 255, 220);
    textAlign(RIGHT, CENTER);
    text(formatStat(row.key, st[row.key]), panel.x + panel.w - 14, cy);
  }

  pop();
}

function formatStat(key, value) {
  if (key === 'speed') return value.toFixed(1);
  if (key === 'size') return value.toFixed(2);
  return String(Math.round(value));
}

function panelContains(x, y) {
  return (
    panel.open &&
    x >= panel.x &&
    x <= panel.x + panel.w &&
    y >= panel.y &&
    y <= panel.y + panel.h
  );
}

function panelRowAt(x, y) {
  if (!panel.open) return null;
  if (x < panel.x || x > panel.x + panel.w) return null;
  for (const row of panel.rows) {
    if (y >= row.y && y <= row.y + panel.rowH) return row;
  }
  return null;
}

function setStatFromX(row, x) {
  const t = constrain((x - row.trackX) / row.trackW, 0, 1);
  let v = row.min + t * (row.max - row.min);
  v = Math.round(v / row.step) * row.step;
  v = Math.round(v * 1000) / 1000;
  otto.stats[row.key] = constrain(v, row.min, row.max);
}

// --------------------------------------------------------------------- input

function hitRect(r, x, y) {
  return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function mousePressed() {
  if (panel.open) {
    const row = panelRowAt(mouseX, mouseY);
    if (row) {
      panel.drag = row;
      setStatFromX(row, mouseX);
      return false;
    }
    if (panelContains(mouseX, mouseY)) {
      if (hitRect(panel.fieldHit, mouseX, mouseY)) showField = !showField;
      return false;
    }
  }

  if (hitRect(tuneHit, mouseX, mouseY)) {
    panel.open = !panel.open;
    panel.drag = null;
    if (panel.open) layoutPanel();
    return false;
  }

  if (hitRect(joinHit, mouseX, mouseY)) {
    if (!shareConnected && shareStatus !== 'connecting') shareConnect();
    return false;
  }

  if (otto.has && otto.lock > 0.3) otto.pop = 1;
  return false;
}

function mouseDragged() {
  if (panel.open && panel.drag) setStatFromX(panel.drag, mouseX);
  return false;
}

function mouseReleased() {
  panel.drag = null;
  return false;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  joinHit = null;
  tuneHit = null;
}
