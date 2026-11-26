// Otto Box
// An AR window into a floor/tabletop world. Point the rear camera at a square
// made of green tape: its four corners define the play area in perspective.
// Food and other players' Ottos live inside that taped square, and this Otto
// wanders, eats, flees or hunts according to its six stats.

const SCAN_W = 240;
const SCAN_H = 135;
const SCAN_EVERY = 2;
const MIN_BLOB = 0.0025; // smallest green blob, as a fraction of the scan frame

const SHARE_HOST = 'https://p5-phone-share.npuckett.workers.dev';
const SHARE_ROOM = 'a1-orbit';
const SHARE_APP = 'my-project';

// Transparent bounds around the creature inside the 360 × 360 GIF.
const OTTO_CROP = { x: 109, y: 135, w: 135, h: 149 };

// The whole play area is the green tape square. Its four detected corners map
// the unit square onto the floor in perspective, so every phone shares the
// same taped boundary. Sight, speed and food distances use these field units.
// 36 units across keeps roughly the old food/space density. Raise it for a
// larger virtual world (smaller-looking Ottos), lower it for a cozier one.
const FIELD_UNITS_ACROSS = 36;
const FIELD_HALF = FIELD_UNITS_ACROSS / 2;
const OTTO_UNITS_TALL = 3.2;
const OTTO_SPACING = 1.5; // minimum centre distance per unit of combined Size
const OTTO_COLLISION_SPACING = 0.9; // gentler per-frame spacing so food can be shared
const EAT_RADIUS = 1.3;
const CONTACT_RADIUS = 1.9;
const FIGHT_STANDOFF = 0.85; // fraction of combined sprite half-widths
const FLEE_RANGE = 12;
const FLEE_MIN_TIME = 2.5; // seconds of committed fleeing
const FLEE_SAFE_MULT = 1.5; // threat must be this many sight radii away
const FRIEND_SPACE = 0.8; // personal-space radius per combined half-width
const FRIEND_STEER = 0.9; // how strongly friends bend the path

// Food and time.
const FOOD_AMOUNT = 10;
const FOOD_MAX = 30;
const FOOD_PER_DAY = 30;
const FOOD_RADIUS = 0.45;
const HEAL_FRACTION = 0.25; // fraction of max HP restored by eating

const DAY_SECONDS = 60; // one day: food is tallied and reproduction is checked

// An Otto burns ENERGY_PER_SIZE × its Size every day. The requirement is
// derived from Size alone, so no editor or inheritance path can change it.
const ENERGY_PER_SIZE = 50;
const ENERGY_STORE_MULT = 2; // two days of food starts a child at day's end
const MAX_OTTOS = 12;
const MUTATE = 0.2; // child stat spread, ±20%
const MUTATE_SIZE = 0.15; // Size mutates a little more gently

const FIGHT_COOLDOWN = 1.1;
const MAX_HP = 100;
const DEATH_LINGER = 0.8; // dead Ottos stay visible briefly so peers see hp reach 0

// Colony colours. Every phone sees the same assignment because the palette is
// handed out in sorted client-ID order, not by who connected first.
const COLONY_COLORS = [
  [63, 208, 255], // cyan
  [255, 150, 70], // orange
  [255, 92, 180], // magenta
  [255, 224, 90], // yellow
  [170, 130, 255], // violet
  [255, 90, 90], // red
  [80, 235, 170], // mint
  [120, 170, 255], // blue
  [166, 255, 92], // lime
  [255, 190, 60], // amber
];
const OTTO_TINT_ALPHA = 0.2; // ink shifts slightly towards the colony colour
const OTTO_FILL_ALPHA = 0.42; // soft fill inside the line art

const STAT_DEFS = {
  attack: { label: 'ATTACK', min: 1, max: 30, step: 1 },
  speed: { label: 'SPEED', min: 0.5, max: 8, step: 0.1 },
  size: { label: 'SIZE', min: 0.4, max: 2.5, step: 0.05 },
  sight: { label: 'SIGHT', min: 2, max: 20, step: 1 },
  aggression: { label: 'AGGRESSION', min: 0, max: 30, step: 1 },
};
const STAT_KEYS = Object.keys(STAT_DEFS);
const STAT_ROWS = STAT_KEYS.map((key) => ({ key, ...STAT_DEFS[key] }));

let cam;
let scan;
let mask;
let visited;
let stack;

let marker;
let ottos = [];
let nextOttoId = 1;
let ottoAssets = []; // { gif, layer, fills } for each sprite asset
let logoImg = null;
let field;
let remote = new Map();
let localFood = {};
let localFoodDay = 0;

let fieldEntered = false;
let fieldLock = 0;
let markerLost = 0;
let dayClock = 0;
let dayNumber = 1;
let simClock = 0;
let clockSyncTimer = 0;
let lastElapsedAt = 0;
let lastSyncedElapsed = 0;
let wasDayLeader = false;
let lastSeenTimeScale = 1;
let wasPausedForClock = false;

let lastMillis = 0;
let scanTick = 0;
let joinHit = null;
let tuneHit = null;
let fullscreenHit = null;
let pauseHit = null;
let yesHit = null;
let autoHit = null;
let autoSkipDay = false;
let timeHit = null;
let timeScale = 1; // 1×, 10× or 100× for testing
let panel = { open: false, rows: [], drag: null, fieldHit: null };

// Pause state. Solo toggles locally; multiplayer waits for every connected
// phone to tap YES at the start of a new day.
let paused = false;
let pauseDay = 0;
let localReady = false;
let showField = false;

// Click-to-examine: a temporary screen-space copy floats to the centre with a
// stats card. The original Otto is never modified.
let examineRef = null;
let examineSnapshot = null;
let examineClone = null;
let examineT = 0; // 0 = at the Otto, 1 = floating at centre
let examineLeaving = false;
let examineKind = 'local'; // 'local' or 'dev'

// Dev mode: spawn fake enemy Ottos in solo space and edit their stats.
let devMode = false;
let devHit = null;
let spawnHit = null;
let devHits = [];
let nextDevId = 1;

// Lobby: allocation and placement.
let allocationActive = false;
let allocationPoints = {
  attack: 0,
  speed: 0,
  size: 0,
  sight: 0,
  aggression: 0,
  hp: 0,
};
let allocationRemaining = 10;
let allocationHits = [];
let allocationConfirmHit = null;
let colorHits = [];
let teamColorIndex = 0;
let pendingAssetIndex = 0;
let pendingStats = null;
let pendingMaxHp = MAX_HP;
let placementActive = false;
let placementMode = 'new'; // 'new' or 'stored'
let colonySpawned = false;
let colonyLost = false;
let storedOtto = null;
let lobbyChoiceActive = false;
let storedPlaceHit = null;
let scratchHit = null;
let storageHit = null;
let storeHit = null;
const STORAGE_KEY = 'otto-stored-v1';

async function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(min(2, displayDensity()));
  frameRate(60);
  lockGestures();
  enableMobileFullscreen();
  fitCanvasToViewport();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitCanvasToViewport);
  }
  textFont('monospace');

  // Shared room for the class session. `me.ottos` is this phone's colony;
  // the other phones see it in `guests`. Food lives in `shared.food`.
  shareSetup({
    host: SHARE_HOST,
    room: SHARE_ROOM,
    app: SHARE_APP,
    shared: { food: {}, timeScale: 1 },
    me: {
      name: 'Otto',
      ottos: [],
      colorIndex: -1,
    },
  });

  scan = createGraphics(SCAN_W, SCAN_H);
  scan.pixelDensity(1);
  scan.noSmooth();

  mask = new Uint8Array(SCAN_W * SCAN_H);
  visited = new Uint8Array(SCAN_W * SCAN_H);
  stack = new Int32Array(SCAN_W * SCAN_H);

  ottoAssets = [];
  for (const name of ['Otto1.gif', 'Otto2.gif', 'Otto3.gif']) {
    try {
      const gif = await loadImage(name);
      ottoAssets.push(prepareOttoAsset(gif));
    } catch (e) {
      console.warn('Could not load ' + name, e);
    }
  }

  try {
    logoImg = await loadImage('OttoBoxLOGO.png');
  } catch (e) {
    console.warn('Could not load OttoBoxLOGO.png', e);
  }

  resetTracking();
  loadStoredOtto();
  lastMillis = millis() / 1000;

  cam = createPhoneCamera('environment', false, 'cover');
  enableCameraTap('TAP TO ENTER OTTO BOX');
  showDesktopQr({ label: 'Scan to open on your phone' });
  document.addEventListener('fullscreenchange', fullscreenChanged);
  document.addEventListener('webkitfullscreenchange', fullscreenChanged);

  // Solo mode is gone; join the shared room automatically.
  if (typeof shareConnect === 'function' && !shareConnected && shareStatus !== 'connecting') {
    try {
      const p = shareConnect();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {
      // The reconnect screen will pick this up.
    }
  }
}

function shareReady() {
  // Keep the shared schema stable even if another client created the room.
  if (!shared.food || typeof shared.food !== 'object') shared.food = {};
  if (window.me && !Array.isArray(me.ottos)) me.ottos = [];
  if (!shared.pause || typeof shared.pause !== 'object') {
    shared.pause = { active: false, day: 0, votes: {} };
  }
  remote.clear();
  devMode = false;
  if (typeof shared.day !== 'number') shared.day = 1;
  if (typeof shared.dayElapsed !== 'number') shared.dayElapsed = 0;
  if (typeof shared.foodSeedDay !== 'number') shared.foodSeedDay = 0;
  if (typeof shared.timeScale !== 'number') shared.timeScale = 1;
  if (typeof shared.started !== 'boolean') shared.started = false;

  // No colony yet: start the local create/place flow. Late joiners also get
  // this flow while the shared day clock keeps running.
  if (!colonySpawned && ottos.length === 0 && !placementActive) {
    if (storedOtto) {
      allocationActive = false;
      lobbyChoiceActive = true;
    } else {
      if (!allocationActive) {
        pendingAssetIndex = randomAssetIndex();
        teamColorIndex = Math.floor(Math.random() * COLONY_COLORS.length);
      }
      allocationActive = true;
      lobbyChoiceActive = false;
    }
  }

  // Adopt the room's current day and clock instead of starting fresh.
  dayNumber = shared.day;
  dayClock = shared.dayElapsed;
  lastSyncedElapsed = dayClock;
  lastElapsedAt = millis() / 1000;
  clockSyncTimer = 0;
  wasDayLeader = false;
  wasPausedForClock = false;

  // Joining mid-pause means this phone has not voted yet.
  if (shared.pause.active && shared.pause.day === dayNumber) {
    paused = true;
    pauseDay = dayNumber;
    localReady = false;
  } else {
    paused = false;
    pauseDay = 0;
    localReady = false;
  }
}

function playerIds() {
  const ids = [];
  if (window.shareClientId) ids.push(window.shareClientId);
  if (Array.isArray(guests)) {
    for (const g of guests) {
      if (g && g.id && (Array.isArray(g.ottos) || g.otto)) ids.push(g.id);
    }
  }
  return [...new Set(ids)].sort();
}

// The lowest connected client id owns the shared day clock. If that phone
// leaves, the next lowest id takes over automatically.
function isDayLeader() {
  if (!shareConnected || !window.shareClientId) return false;
  const ids = playerIds();
  return ids.length > 0 && ids[0] === window.shareClientId;
}

function updateSharedDayClock(dt) {
  if (!shareConnected) return;

  const scale =
    typeof shared.timeScale === 'number' ? shared.timeScale : 1;
  const leader = isDayLeader();
  const now = millis() / 1000;
  const sharedPaused = !!(shared.pause && shared.pause.active);

  // The room clock waits for the first Otto to be placed.
  if (!shared.started) {
    dayClock = 0;
    lastElapsedAt = now;
    wasPausedForClock = true;
    wasDayLeader = leader;
    return;
  }

  // Adopt a day change from the room, and run this colony's end-of-day work
  // exactly once for that shared day.
  if (typeof shared.day === 'number' && shared.day !== dayNumber) {
    dayNumber = shared.day;
    dayClock = typeof shared.dayElapsed === 'number' ? shared.dayElapsed : 0;
    lastSyncedElapsed = dayClock;
    lastElapsedAt = now;
    processColonyDayEnd();
  }

  if (paused || sharedPaused) {
    dayClock = typeof shared.dayElapsed === 'number' ? shared.dayElapsed : dayClock;
    lastElapsedAt = now;
    wasPausedForClock = true;
    wasDayLeader = leader;
    return;
  }

  if (wasPausedForClock) {
    dayClock = typeof shared.dayElapsed === 'number' ? shared.dayElapsed : 0;
    lastSyncedElapsed = dayClock;
    lastElapsedAt = now;
    clockSyncTimer = 0;
    wasPausedForClock = false;
  }

  if (leader) {
    if (!wasDayLeader && typeof shared.dayElapsed === 'number') {
      dayClock = shared.dayElapsed;
      lastSyncedElapsed = dayClock;
      lastElapsedAt = now;
    }

    if (scale !== lastSeenTimeScale) {
      lastSeenTimeScale = scale;
      shared.dayElapsed = Math.round(dayClock * 100) / 100;
      clockSyncTimer = 0;
    }

    dayClock += dt * scale;
    clockSyncTimer += dt;
    if (clockSyncTimer >= 0.5) {
      clockSyncTimer = 0;
      shared.dayElapsed = Math.round(dayClock * 100) / 100;
    }

    if (dayClock >= DAY_SECONDS) {
      const next = (typeof shared.day === 'number' ? shared.day : dayNumber) + 1;
      shared.day = next;
      shared.dayElapsed = 0;
      shared.food = {};
      shared.pause = { active: true, day: next, votes: {} };
      dayNumber = next;
      dayClock = 0;
      lastSyncedElapsed = 0;
      lastElapsedAt = now;
      paused = true;
      wasPausedForClock = true;
      processColonyDayEnd();
    }
  } else {
    if (
      typeof shared.dayElapsed === 'number' &&
      shared.dayElapsed !== lastSyncedElapsed
    ) {
      lastSyncedElapsed = shared.dayElapsed;
      lastElapsedAt = now;
    }
    dayClock = lastSyncedElapsed + (now - lastElapsedAt) * scale;
    if (dayClock < 0) dayClock = 0;
  }

  wasDayLeader = leader;
}

function resetTracking() {
  marker = {
    found: false,
    corners: null,
    center: { x: 0, y: 0 },
    size: 0,
    lastSeenAt: 0,
  };
  field = { ok: false, corners: null, M: null, invM: null };
  localFood = {};
  localFoodDay = 0;

  nextOttoId = 1;
  ottos = [];
  fieldEntered = false;
  fieldLock = 0;
  markerLost = 0;
  dayClock = 0;
  dayNumber = 1;
  simClock = 0;
  clockSyncTimer = 0;
  lastElapsedAt = 0;
  lastSyncedElapsed = 0;
  wasDayLeader = false;
  lastSeenTimeScale = 1;
  wasPausedForClock = false;
  paused = false;
  pauseDay = 0;
  localReady = false;
  examineRef = null;
  examineSnapshot = null;
  examineClone = null;
  examineT = 0;
  examineLeaving = false;
  examineKind = 'local';
  devMode = false;
  devHit = null;
  spawnHit = null;
  devHits = [];
  nextDevId = 1;
  allocationActive = false;
  allocationPoints = {
    attack: 0,
    speed: 0,
    size: 0,
    sight: 0,
    aggression: 0,
    hp: 0,
  };
  allocationRemaining = 10;
  allocationHits = [];
  allocationConfirmHit = null;
  colorHits = [];
  teamColorIndex = 0;
  pendingAssetIndex = randomAssetIndex();
  pendingStats = null;
  pendingMaxHp = MAX_HP;
  placementActive = false;
  placementMode = 'new';
  colonySpawned = false;
  colonyLost = false;
  storedOtto = null;
  lobbyChoiceActive = false;
  storedPlaceHit = null;
  scratchHit = null;
  storageHit = null;
  storeHit = null;
  reconnectHit = null;
  failRetryHit = null;
}

function defaultStats() {
  return {
    attack: 10,
    speed: 1,
    size: 1,
    sight: 8,
    aggression: 9,
  };
}

function statsFromAllocation(points) {
  const base = defaultStats();
  return {
    attack: base.attack + points.attack,
    speed: base.speed + points.speed * 0.1,
    size: base.size + points.size * 0.1,
    sight: base.sight + points.sight,
    aggression: base.aggression + points.aggression,
  };
}

function maxHpFromAllocation(points) {
  return MAX_HP + points.hp * 10;
}

// Daily energy cost is a pure function of Size, so it cannot be edited or
// passed down directly. Every other system asks for it here.
function energyRequirementFor(size) {
  return Math.max(5, Math.round(ENERGY_PER_SIZE * size));
}

function createOtto(stats, x, y, maxHp = MAX_HP, assetIndex = null) {
  const st = stats || defaultStats();
  return {
    id: nextOttoId++,
    pos: { x: x || 0, y: y || 0 },
    maxHp,
    hp: maxHp,
    assetIndex,
    facing: 1,
    moving: false,
    pop: 0,
    spawn: 1,
    mode: 'wander',
    target: null,
    wander: null,
    think: 0,
    fightCd: 0,
    fleeUntil: 0,
    fleeThreat: null,
    threatX: null,
    threatY: null,
    threatAt: 0,
    chaseStartDist: 0,
    chaseElapsed: 0,
    chaseIgnoreId: null,
    chaseIgnoreUntil: 0,
    dead: false,
    death: 0,
    energy: 0, // food eaten so far today; every Otto starts the day empty
    stats: st,
  };
}

// A child copies its parent with a small independent wobble on every stat.
function mutateStats(parent) {
  const out = {};
  for (const key of STAT_KEYS) {
    const def = STAT_DEFS[key];
    const spread = key === 'size' ? MUTATE_SIZE : MUTATE;
    const factor = 1 + (Math.random() * 2 - 1) * spread;
    let v = parent[key] * factor;
    v = def.min + Math.round((v - def.min) / def.step) * def.step;
    v = Math.round(v * 1000) / 1000;
    out[key] = constrain(v, def.min, def.max);
  }
  return out;
}

// --------------------------------------------------------------- examine view

function ottoHit(o, x, y) {
  const p = fieldToScreen(o.pos.x, o.pos.y);
  const h =
    OTTO_UNITS_TALL *
    o.stats.size *
    fieldScreenScale(o.pos.x, o.pos.y).avg;
  const cy = p.y - h * 0.5;
  const r = Math.max(20, h * 0.5);
  return Math.hypot(x - p.x, y - cy) < r;
}

function devOttoHit(r, x, y) {
  const p = fieldToScreen(r.x, r.y);
  const h = OTTO_UNITS_TALL * r.size * fieldScreenScale(r.x, r.y).avg;
  const cy = p.y - h * 0.5;
  const rad = Math.max(20, h * 0.5);
  return Math.hypot(x - p.x, y - cy) < rad;
}

function startExamine(target, kind = 'local') {
  examineKind = kind;
  examineRef = target;
  const isLocal = kind === 'local';
  const color = isLocal
    ? colonyColorFor(window.shareClientId)
    : target.color || COLONY_COLORS[0];

  if (isLocal) {
    examineSnapshot = {
      id: target.id,
      stats: { ...target.stats },
      hp: target.hp,
      maxHp: target.maxHp || MAX_HP,
      energy: target.energy,
      color,
    };
  } else {
    examineSnapshot = {
      id: target.id,
      maxHp: target.maxHp || MAX_HP,
      stats: {
        attack: target.attack,
        speed: target.speed || 1,
        size: target.size,
        sight: target.sight,
        aggression: target.aggression,
      },
      hp: target.hp,
      energy: 0,
      color,
    };
  }

  const px = isLocal ? target.pos.x : target.x;
  const py = isLocal ? target.pos.y : target.y;
  const startSize = isLocal ? target.stats.size : target.size;
  const p = fieldToScreen(px, py);
  const groundScale = fieldScreenScale(px, py).avg;
  const targetHeight = Math.min(height * 0.34, width * 0.55);
  const targetSize = Math.max(
    0.4,
    targetHeight / (OTTO_UNITS_TALL * Math.max(1, groundScale))
  );
  examineClone = {
    x: p.x,
    y: p.y,
    size: startSize,
    startX: p.x,
    startY: p.y,
    startSize,
    targetX: width * 0.58,
    targetY: height * 0.5,
    targetSize,
    scale: groundScale,
    facing: target.facing || 1,
    color,
    asset:
      isLocal && target.assetIndex != null
        ? ottoAssets[target.assetIndex] || ottoAssetFor(target.id)
        : ottoAssetFor(target.id),
  };
  examineT = 0;
  examineLeaving = false;
}

function spawnDevEnemy() {
  if (shareConnected) return;
  const n = nextDevId++;
  const a = Math.random() * Math.PI * 2;
  const reach = Math.max(2, fieldHalf() * 0.55);
  const r = 3 + Math.random() * reach;
  const entry = {
    id: 'dev#' + n,
    client: 'dev-' + n,
    dev: true,
    x: Math.cos(a) * r,
    y: Math.sin(a) * r,
    tx: Math.cos(a) * r,
    ty: Math.sin(a) * r,
    size: 0.7 + Math.random() * 0.9,
    speed: 1.5 + Math.random() * 2,
    attack: 6 + Math.floor(Math.random() * 10),
    aggression: 6 + Math.floor(Math.random() * 10),
    sight: 6 + Math.floor(Math.random() * 8),
    hp: MAX_HP,
    maxHp: MAX_HP,
    credited: false,
    deadTime: 0,
    facing: 1,
    lock: 1,
    color: COLONY_COLORS[1 + (n % Math.max(1, COLONY_COLORS.length - 1))],
  };
  remote.set(entry.id, entry);
}

function adjustDevStat(key, dir) {
  if (!examineRef) return;
  const isLocal = examineKind === 'local';
  const def = STAT_DEFS[key];
  const step = key === 'hp' ? 5 : def ? def.step : 1;

  if (key === 'hp') {
    examineRef.hp = constrain(
      Math.round(examineRef.hp + dir * step),
      1,
      examineRef.maxHp || MAX_HP
    );
  } else if (isLocal) {
    let v = examineRef.stats[key] + dir * step;
    v = def.min + Math.round((v - def.min) / def.step) * def.step;
    v = Math.round(v * 1000) / 1000;
    examineRef.stats[key] = constrain(v, def.min, def.max);
  } else {
    let v = (examineRef[key] == null ? def.min : examineRef[key]) + dir * step;
    v = def.min + Math.round((v - def.min) / def.step) * def.step;
    v = Math.round(v * 1000) / 1000;
    examineRef[key] = constrain(v, def.min, def.max);
  }

  if (examineSnapshot) {
    if (key === 'hp') examineSnapshot.hp = examineRef.hp;
    else {
      examineSnapshot.stats[key] = isLocal
        ? examineRef.stats[key]
        : examineRef[key];
    }
  }
}

function dismissExamine() {
  if (!examineClone) return;
  examineLeaving = true;
}

function updateExamine(dt) {
  if (!examineClone) return;

  const speed = examineLeaving ? 8 : 4;
  examineT = examineT + (examineLeaving ? -1 : 1) * dt * speed;
  examineT = constrain(examineT, 0, 1);

  if (examineLeaving && examineT <= 0.001) {
    examineClone = null;
    examineRef = null;
    examineSnapshot = null;
    examineLeaving = false;
    return;
  }

  const t = examineT * examineT * (3 - 2 * examineT); // smoothstep
  examineClone.x = lerp(examineClone.startX, examineClone.targetX, t);
  examineClone.y = lerp(examineClone.startY, examineClone.targetY, t);
  examineClone.size = lerp(examineClone.startSize, examineClone.targetSize, t);
}

function drawExamineClone() {
  if (!examineClone) return;
  const c = examineClone;
  drawOttoAt(c.x, c.y, c.size, 1, c.facing, 0, 1, c.color, c.asset, c.scale);
}

function drawStatsCard() {
  devHits = [];
  storeHit = null;
  if (!examineClone || examineT < 0.15) return;
  const ref = examineRef;
  const snap = examineSnapshot;
  if (!snap) return;

  const isLocal = examineKind === 'local';
  const refUsable =
    ref && (isLocal ? !ref.dead : true);
  const st = refUsable
    ? isLocal
      ? ref.stats
      : {
          attack: ref.attack,
          speed: ref.speed == null ? 1 : ref.speed,
          size: ref.size,
          sight: ref.sight,
          aggression: ref.aggression,
        }
    : snap.stats;
  const hp = refUsable ? ref.hp : snap.hp;
  const maxHp = (refUsable && ref.maxHp) || snap.maxHp || MAX_HP;
  const energy = refUsable && isLocal ? ref.energy : snap.energy;
  const id = snap.id;
  const need = energyRequirementFor(st.size);
  const editable = devMode && !shareConnected;
  const canStore =
    shareConnected && paused && isLocal && refUsable && !ref.dead && !storedOtto;

  const s = constrain(width * 0.031, 10, 16);
  const cardW = editable ? s * 18 : s * 15.5;
  const cardH = editable ? s * 12.5 : canStore ? s * 14 : s * 11;
  let cardX = examineClone.x - cardW - s * 3;
  let cardY = examineClone.y - cardH * 0.55;
  cardX = constrain(cardX, 12, width - cardW - 12);
  cardY = constrain(cardY, 12, height - cardH - 12);

  push();

  // Leader line from the card to the floating copy.
  stroke(126, 255, 190, 120);
  strokeWeight(1);
  drawingContext.setLineDash([5, 4]);
  line(cardX + cardW, cardY + cardH * 0.5, examineClone.x, examineClone.y);
  drawingContext.setLineDash([]);

  noStroke();
  fill(4, 10, 16, 220);
  rect(cardX, cardY, cardW, cardH, 10);
  stroke(editable ? color(255, 200, 110, 150) : color(126, 255, 190, 120));
  strokeWeight(1);
  noFill();
  rect(cardX, cardY, cardW, cardH, 10);
  noStroke();

  textAlign(LEFT, TOP);
  fill(240, 252, 255, 235);
  textSize(s * 0.8);
  text(`OTTO ${id}${isLocal ? '' : ' · DEV'}`, cardX + 10, cardY + 7);

  if (editable) {
    const keys = ['attack', 'speed', 'size', 'sight', 'aggression', 'hp'];
    const labels = ['ATTACK', 'SPEED', 'SIZE', 'SIGHT', 'AGGRO', 'HP'];
    const rowH = s * 1.22;
    const firstY = cardY + s * 1.7;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const y = firstY + i * rowH;
      const value =
        key === 'hp'
          ? `${Math.round(hp)}`
          : key === 'speed'
          ? Number(st.speed).toFixed(1)
          : key === 'size'
          ? Number(st.size).toFixed(2)
          : String(Math.round(st[key]));

      fill(150, 200, 225, 190);
      textAlign(LEFT, TOP);
      textSize(s * 0.58);
      text(labels[i], cardX + 10, y);

      fill(240, 252, 255, 220);
      textAlign(RIGHT, TOP);
      text(value, cardX + cardW - s * 7.0, y);

      const bw = s * 1.9;
      const bh = s * 1.0;
      const by = y - s * 0.12;
      const minusX = cardX + cardW - s * 5.9;
      const plusX = cardX + cardW - s * 3.3;

      for (const [bx, label, dir] of [
        [minusX, '−', -1],
        [plusX, '+', 1],
      ]) {
        noFill();
        stroke(140, 230, 255, 90);
        strokeWeight(1);
        rect(bx, by, bw, bh, bh / 2);
        noStroke();
        fill(150, 235, 255, 210);
        textAlign(CENTER, CENTER);
        textSize(s * 0.7);
        text(label, bx + bw / 2, by + bh / 2 + 1);
        devHits.push({ x: bx, y: by, w: bw, h: bh, key, dir });
      }
    }
  } else {
    const rows = [
      ['ATTACK', st.attack],
      ['SPEED', st.speed.toFixed(1)],
      ['SIZE', st.size.toFixed(2)],
      ['SIGHT', st.sight.toFixed(0)],
      ['AGGRESSION', st.aggression],
      ['ENERGY/DAY', need],
      ['HP', `${Math.max(0, Math.round(hp))}/${maxHp}`],
      ['ENERGY', Math.round(energy)],
    ];

    textSize(s * 0.62);
    for (let i = 0; i < rows.length; i++) {
      const y = cardY + 7 + s * 1.5 + i * s * 1.0;
      fill(150, 200, 225, 190);
      textAlign(LEFT, TOP);
      text(rows[i][0], cardX + 10, y);
      fill(240, 252, 255, 220);
      textAlign(RIGHT, TOP);
      text(String(rows[i][1]), cardX + cardW - 10, y);
    }
  }

  if (canStore) {
    const bw = cardW - 20;
    const bh = s * 2.0;
    const bx = cardX + 10;
    const by = cardY + cardH - s * 4.6;
    storeHit = { x: bx, y: by, w: bw, h: bh };
    noFill();
    stroke(126, 255, 190, 150);
    strokeWeight(1);
    rect(bx, by, bw, bh, bh / 2);
    noStroke();
    fill(126, 255, 190, 225);
    textAlign(CENTER, CENTER);
    textSize(s * 0.68);
    text('STORE OTTO', bx + bw / 2, by + bh / 2 + 1);
  }

  fill(140, 190, 215, 150);
  textAlign(CENTER, TOP);
  textSize(s * 0.55);
  text(editable ? 'EDIT · CLICK TO CLOSE' : 'CLICK TO CLOSE', cardX + cardW / 2, cardY + cardH - s * 1.4);

  pop();
}

function draw() {
  const now = millis() / 1000;
  const dt = constrain(now - lastMillis, 0, 0.1);
  lastMillis = now;

  // The shared day clock runs even before the camera is live, so a connected
  // room keeps the same time even if one phone is not viewing the field.
  updateSharedDayClock(dt);

  const live =
    window.cameraEnabled &&
    cam &&
    cam.ready &&
    cam.videoElement &&
    cam.videoElement.readyState >= 2;

  if (!live) {
    drawWaiting(now);
    drawLobbyOverlays();
    drawFullscreenButton();
    return;
  }

  image(cam);

  if (++scanTick >= SCAN_EVERY) {
    scanTick = 0;
    scanForGreen();
  }

  updateField(dt);
  updateRemote(dt);
  updateExamine(dt);

  if (field.ok && !fieldEntered) enterField();

  if (marker.found) {
    markerLost = 0;
    fieldLock += (1 - fieldLock) * (1 - Math.exp(-dt / 0.12));
  } else {
    markerLost += dt;
    if (markerLost > 0.25) fieldLock *= Math.exp(-dt / 0.45);
  }

  if (!paused) {
    // Full-simulation speed boost. Substepping keeps movement and collisions
    // stable when the day clock is running at 10× or 100×.
    const activeTimeScale = shareConnected && typeof shared.timeScale === 'number'
      ? shared.timeScale
      : timeScale;
    const simDt = dt * activeTimeScale;
    const steps = constrain(Math.ceil(simDt / 0.05), 1, 40);
    const stepDt = simDt / steps;
    for (let i = 0; i < steps; i++) {
      if (fieldEntered && field.ok) updateBehaviour(stepDt, false);
      updateFood(stepDt);
      if (paused) break;
    }
    if (fieldEntered && field.ok) syncMe();
  }

  drawFood();
  drawFieldBoundary();
  if (showField) drawFieldDebug();
  drawColonyRings();
  drawRemoteOttos();
  drawLocalOttos();
  drawExamineClone();
  drawStatsCard();
  drawHud();
  if (panel.open) drawPanel();

  if (
    colonySpawned &&
    ottos.length === 0 &&
    !allocationActive &&
    !placementActive &&
    !lobbyChoiceActive
  ) {
    if (storedOtto) {
      lobbyChoiceActive = true;
      colonyLost = false;
    } else {
      colonyLost = true;
    }
  }
  drawLobbyOverlays();
  if (shareConnected) drawPauseOverlay();
  drawFullscreenButton();
}

// ---------------------------------------------------------------- detection

const MIN_QUAD_AREA = 0.015; // quadrilateral area as a fraction of the scan
const MAX_QUAD_SIDE_RATIO = 6; // allow a fairly shallow camera angle
const CORNER_REACQUIRE_MS = 1500;

function cross2(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points) {
  if (points.length < 3) return [];
  const pts = points
    .slice()
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const lower = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Peel the least-important hull vertex until only the four main corners remain.
function simplifyHullToQuad(hull) {
  const pts = hull.slice();
  while (pts.length > 4) {
    let removeAt = 0;
    let smallest = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const area = Math.abs(cross2(a, b, c)) * 0.5;
      if (area < smallest) {
        smallest = area;
        removeAt = i;
      }
    }
    pts.splice(removeAt, 1);
  }
  return pts.length === 4 ? pts : null;
}

function quadArea(points) {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) * 0.5;
}

function orderQuadClockwise(points) {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const sorted = points
    .slice()
    .sort(
      (a, b) =>
        Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
    );

  let start = 0;
  let best = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const score = sorted[i].x + sorted[i].y;
    if (score < best) {
      best = score;
      start = i;
    }
  }
  return sorted.slice(start).concat(sorted.slice(0, start));
}

// Keep the same physical corner labelled as corner 0 while the phone moves.
// A square has no intrinsic orientation, so this preserves continuity only
// after the first lock.
function matchCornerOrder(points) {
  const prev = marker.corners;
  if (
    !prev ||
    prev.length !== 4 ||
    millis() - marker.lastSeenAt > CORNER_REACQUIRE_MS
  ) {
    return points;
  }

  let bestShift = 0;
  let bestCost = Infinity;
  for (let shift = 0; shift < 4; shift++) {
    let cost = 0;
    for (let i = 0; i < 4; i++) {
      const a = points[(i + shift) % 4];
      const b = prev[i];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      cost += dx * dx + dy * dy;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestShift = shift;
    }
  }

  const reacquireDistance = Math.hypot(width, height) * 0.45;
  if (bestCost / 4 > reacquireDistance * reacquireDistance) {
    return points;
  }
  return points
    .slice(bestShift)
    .concat(points.slice(0, bestShift));
}

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

  // Largest connected green blob wins. Keep its boundary so a taped square
  // can be reduced to four corners instead of a screen-aligned bounding box.
  const quad = findTapeQuad();
  if (!quad) {
    marker.found = false;
    return;
  }

  const sideLengths = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    sideLengths.push(Math.hypot(a.x - b.x, a.y - b.y));
  }

  // Map scan-buffer coordinates back into the camera's on-screen rectangle.
  const dims = cam.getDimensions();
  const screenCorners = quad.map((p) => ({
    x: dims.x + ((p.x + 0.5) / SCAN_W) * dims.width,
    y: dims.y + ((p.y + 0.5) / SCAN_H) * dims.height,
  }));
  marker.corners = matchCornerOrder(orderQuadClockwise(screenCorners));
  marker.center = {
    x: marker.corners.reduce((sum, p) => sum + p.x, 0) / 4,
    y: marker.corners.reduce((sum, p) => sum + p.y, 0) / 4,
  };
  marker.size =
    sideLengths.reduce((sum, side) => sum + side, 0) / sideLengths.length;
  marker.lastSeenAt = millis();
  marker.found = true;
}

function findTapeQuad() {
  visited.fill(0);
  let bestArea = 0;
  let bestBoundary = null;
  const compBoundary = [];

  for (let y = 0; y < SCAN_H; y++) {
    for (let x = 0; x < SCAN_W; x++) {
      const start = y * SCAN_W + x;
      if (!mask[start] || visited[start]) continue;

      let head = 0;
      let tail = 0;
      stack[tail++] = start;
      visited[start] = 1;
      compBoundary.length = 0;

      let area = 0;
      while (head < tail) {
        const idx = stack[head++];
        const pxX = idx % SCAN_W;
        const pxY = (idx - pxX) / SCAN_W;

        area++;

        let edge = false;
        if (pxX === 0 || !mask[idx - 1]) edge = true;
        else if (pxX === SCAN_W - 1 || !mask[idx + 1]) edge = true;
        else if (pxY === 0 || !mask[idx - SCAN_W]) edge = true;
        else if (pxY === SCAN_H - 1 || !mask[idx + SCAN_W]) edge = true;
        if (edge) compBoundary.push({ x: pxX, y: pxY });

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
        bestBoundary = compBoundary.slice();
      }
    }
  }

  if (!bestBoundary || bestArea < SCAN_W * SCAN_H * MIN_BLOB) {
    return null;
  }

  const hull = convexHull(bestBoundary);
  if (hull.length < 4) return null;

  const quad = simplifyHullToQuad(hull);
  if (!quad || quadArea(quad) < SCAN_W * SCAN_H * MIN_QUAD_AREA) {
    return null;
  }

  const sideLengths = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    sideLengths.push(Math.hypot(a.x - b.x, a.y - b.y));
  }
  const shortest = Math.min(...sideLengths);
  const longest = Math.max(...sideLengths);
  if (shortest < 4 || longest / shortest > MAX_QUAD_SIDE_RATIO) {
    return null;
  }

  // A real taped square has green along all four sides. This rejects a
  // U-shaped or broken piece of tape whose hull would otherwise invent a side.
  if (!quadSidesVisible(quad)) return null;

  return quad;
}

function quadSidesVisible(quad, tolerance = 3) {
  const samples = 18;
  for (let side = 0; side < 4; side++) {
    const a = quad[side];
    const b = quad[(side + 1) % 4];
    let covered = 0;
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const sx = Math.round(a.x + (b.x - a.x) * t);
      const sy = Math.round(a.y + (b.y - a.y) * t);
      let hit = false;
      for (let dy = -tolerance; dy <= tolerance && !hit; dy++) {
        for (let dx = -tolerance; dx <= tolerance; dx++) {
          const x = sx + dx;
          const y = sy + dy;
          if (
            x >= 0 &&
            x < SCAN_W &&
            y >= 0 &&
            y < SCAN_H &&
            mask[y * SCAN_W + x]
          ) {
            hit = true;
            break;
          }
        }
      }
      if (hit) covered++;
    }
    if (covered < Math.ceil((samples - 1) * 0.75)) return false;
  }
  return true;
}

// -------------------------------------------------------------------- field

// Closed-form homography from the unit square to a screen quadrilateral.
// Corner order is (0,0), (1,0), (1,1), (0,1).
function quadHomography(corners) {
  const p0 = corners[0];
  const p1 = corners[1];
  const p2 = corners[2];
  const p3 = corners[3];

  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let a, b, c, d, e, f, g, h;

  if (Math.abs(dx3) < 1e-6 && Math.abs(dy3) < 1e-6) {
    a = p1.x - p0.x;
    b = p2.x - p1.x;
    c = p0.x;
    d = p1.y - p0.y;
    e = p2.y - p1.y;
    f = p0.y;
    g = 0;
    h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-6) return null;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = p1.x - p0.x + g * p1.x;
    b = p3.x - p0.x + h * p3.x;
    c = p0.x;
    d = p1.y - p0.y + g * p1.y;
    e = p3.y - p0.y + h * p3.y;
    f = p0.y;
  }

  return [a, b, c, d, e, f, g, h, 1];
}

function invert3x3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];

  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) return null;

  const invDet = 1 / det;
  return [
    A * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    B * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    C * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
}

function updateFieldTransform() {
  if (!field.corners || field.corners.length !== 4) {
    field.ok = false;
    return;
  }
  const matrix = quadHomography(field.corners);
  const inverse = matrix ? invert3x3(matrix) : null;
  if (!matrix || !inverse) {
    field.ok = false;
    return;
  }
  field.M = matrix;
  field.invM = inverse;
  field.ok = true;
}

function updateField(dt) {
  if (!marker.found || !marker.corners || marker.corners.length !== 4) {
    return;
  }

  if (!field.ok) {
    // First lock: snap straight to the tape instead of sliding in.
    field.corners = marker.corners.map((p) => ({ x: p.x, y: p.y }));
  } else {
    const k = 1 - Math.exp(-dt / 0.1);
    for (let i = 0; i < 4; i++) {
      field.corners[i].x = lerp(field.corners[i].x, marker.corners[i].x, k);
      field.corners[i].y = lerp(field.corners[i].y, marker.corners[i].y, k);
    }
  }
  updateFieldTransform();
}

function fieldToScreen(fx, fy) {
  if (!field.ok || !field.M) {
    return { x: width / 2, y: height / 2 };
  }
  const u = (fx + FIELD_HALF) / FIELD_UNITS_ACROSS;
  const v = (fy + FIELD_HALF) / FIELD_UNITS_ACROSS;
  const m = field.M;
  const den = m[6] * u + m[7] * v + 1;
  if (Math.abs(den) < 1e-6) return { x: width / 2, y: height / 2 };
  return {
    x: (m[0] * u + m[1] * v + m[2]) / den,
    y: (m[3] * u + m[4] * v + m[5]) / den,
  };
}

function screenToField(sx, sy) {
  if (!field.ok || !field.invM) return null;
  const m = field.invM;
  const den = m[6] * sx + m[7] * sy + m[8];
  if (Math.abs(den) < 1e-6) return null;
  const u = (m[0] * sx + m[1] * sy + m[2]) / den;
  const v = (m[3] * sx + m[4] * sy + m[5]) / den;
  return {
    x: u * FIELD_UNITS_ACROSS - FIELD_HALF,
    y: v * FIELD_UNITS_ACROSS - FIELD_HALF,
  };
}

// Local screen size of one field unit at this point, including perspective.
function fieldScreenScale(fx, fy) {
  const p = fieldToScreen(fx, fy);
  const px = fieldToScreen(fx + 1, fy);
  const py = fieldToScreen(fx, fy + 1);
  const sx = Math.hypot(px.x - p.x, px.y - p.y);
  const sy = Math.hypot(py.x - p.x, py.y - p.y);
  return {
    x: Math.max(0.001, sx),
    y: Math.max(0.001, sy),
    avg: Math.max(0.001, Math.sqrt(sx * sy)),
  };
}

function fieldGroundBasis(fx, fy) {
  const p = fieldToScreen(fx, fy);
  const px = fieldToScreen(fx + 1, fy);
  const py = fieldToScreen(fx, fy + 1);
  return {
    x: p.x,
    y: p.y,
    ax: { x: px.x - p.x, y: px.y - p.y },
    ay: { x: py.x - p.x, y: py.y - p.y },
  };
}

function clampToField(x, y, margin = 0) {
  const half = Math.max(0.1, FIELD_HALF - margin);
  return { x: constrain(x, -half, half), y: constrain(y, -half, half) };
}

function clampOttoToField(o) {
  const margin = Math.max(0.8, 1.5 * (o.stats.size || 1));
  const p = clampToField(o.pos.x, o.pos.y, margin);
  o.pos.x = p.x;
  o.pos.y = p.y;
}

function fieldHalf() {
  return FIELD_HALF;
}

function enterField() {
  fieldEntered = true;
  fieldLock = 0;
  dayClock = 0;
  if (ottos.length) {
    const first = ottos[0];
    first.pos.x = 0;
    first.pos.y = 0;
    first.mode = 'wander';
    first.target = null;
    first.wander = null;
    first.think = 0;
    first.fightCd = 0;
  }
}

// ---------------------------------------------------------------- behaviour

function updateBehaviour(dt, sync = true) {
  simClock += dt;

  for (const o of ottos) {
    if (o.dead) {
      o.death += dt;
      o.pop *= Math.exp(-dt / 0.18);
      continue;
    }

    o.fightCd = Math.max(0, o.fightCd - dt);
    o.spawn = Math.min(1, o.spawn + dt / 0.5);
    o.pop *= Math.exp(-dt / 0.18);

    const store = currentFood();
    if (store) eatNearby(o, store);

    o.think -= dt;
    if (o.think <= 0) {
      o.think = 0.25;
      chooseIntent(o);
    }

    moveOtto(o, dt);

    // Keep the Otto inside the taped square.
    clampOttoToField(o);
  }

  // Keep only this phone's own Ottos from overlapping. Remote colonies are a
  // different team, so they are intentionally left alone. The per-frame radius
  // is smaller than the post-reproduction one so two Ottos can share food.
  separateOttos(1, OTTO_COLLISION_SPACING);

  // Remove Ottos once their death fade has played out.
  for (let i = ottos.length - 1; i >= 0; i--) {
    const o = ottos[i];
    if (o.dead && o.death >= DEATH_LINGER) ottos.splice(i, 1);
  }

  if (sync) syncMe();
}

// Colony-only end-of-day work. In a shared room every phone runs this once
// when the shared day advances; the day counter itself is shared.
function processColonyDayEnd() {
  const parents = [];

  // Any Otto that did not eat its daily requirement starves and is removed.
  // Survivors at two days' food become parents; the rest simply carry on.
  for (let i = ottos.length - 1; i >= 0; i--) {
    const o = ottos[i];
    if (o.dead) continue;
    const need = energyRequirementFor(o.stats.size);
    if (o.energy < need) {
      o.hp = 0;
      o.dead = true;
      ottos.splice(i, 1);
      continue;
    }
    if (o.energy >= need * ENERGY_STORE_MULT) parents.push(o);
  }

  const before = ottos.length;
  for (const parent of parents) reproduce(parent);

  for (const o of ottos) o.energy = 0;
  if (storedOtto) {
    storedOtto.energy = 0;
    saveStoredOtto();
  }

  if (ottos.length > before) {
    separateOttos();
    for (const o of ottos) {
      o.think = 0;
      o.target = null;
      o.wander = null;
    }
  }
}

// Solo day end: colony work plus the local day/pause transition.
function endOfDay() {
  processColonyDayEnd();
  dayNumber += 1;
  localFood = {};
  paused = true;
  pauseDay = dayNumber;
  localReady = false;
  if (autoSkipDay) paused = false;
}

// The child inherits a mutated genome but starts the new day with no food.
function reproduce(parent) {
  if (ottos.length >= MAX_OTTOS) return;
  const need = energyRequirementFor(parent.stats.size);
  if (parent.energy < need * ENERGY_STORE_MULT) return;

  const stats = mutateStats(parent.stats);
  const a = Math.random() * Math.PI * 2;
  const d = 1.1 + Math.random() * 0.7;
  const child = createOtto(
    stats,
    parent.pos.x + Math.cos(a) * d,
    parent.pos.y + Math.sin(a) * d
  );
  child.spawn = 0;
  child.facing = parent.facing;
  child.pop = 1;
  parent.pop = 1;
  ottos.push(child);
}

// Sprites are nearly three field units wide, so a newborn at the parent's
// feet would be hidden behind it. Push overlapping pairs apart after births.
function separateOttos(rounds = 6, spacing = OTTO_SPACING) {
  for (let r = 0; r < rounds; r++) {
    let moved = false;

    for (let i = 0; i < ottos.length; i++) {
      for (let j = i + 1; j < ottos.length; j++) {
        const a = ottos[i];
        const b = ottos[j];
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const min = spacing * (a.stats.size + b.stats.size);
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;

        let nx;
        let ny;
        if (d < 0.001) {
          const angle = Math.random() * Math.PI * 2;
          nx = Math.cos(angle);
          ny = Math.sin(angle);
        } else {
          nx = dx / d;
          ny = dy / d;
        }

        const push = (min - d) / 2 + 0.02;
        a.pos.x -= nx * push;
        a.pos.y -= ny * push;
        b.pos.x += nx * push;
        b.pos.y += ny * push;
        moved = true;
      }
    }

    for (const o of ottos) clampOttoToField(o);

    if (!moved) break;
  }
}

function chooseIntent(o) {
  const st = o.stats;
  const need = energyRequirementFor(st.size);

  // Nearest other Otto inside the sight radius.
  let enemy = null;
  let enemyD = Infinity;
  for (const r of remote.values()) {
    if (r.hp <= 0) continue;
    if (
      o.chaseIgnoreId === r.id &&
      simClock < o.chaseIgnoreUntil
    ) {
      continue;
    }
    const d = Math.hypot(r.x - o.pos.x, r.y - o.pos.y);
    if (d <= st.sight + r.size * 0.6 && d < enemyD) {
      enemy = r;
      enemyD = d;
    }
  }

  // Commit to fleeing for a minimum time, and keep going while the threat is
  // still inside 1.5× sight. This prevents flee/return thrashing at the edge.
  if (o.mode === 'flee' && o.fleeThreat) {
    const threatAlive = remote.has(o.fleeThreat.id) && o.fleeThreat.hp > 0;
    if (threatAlive) {
      o.threatX = o.fleeThreat.x;
      o.threatY = o.fleeThreat.y;
      o.threatAt = simClock;
    }

    const dThreat =
      o.threatX == null || o.threatY == null
        ? Infinity
        : Math.hypot(o.threatX - o.pos.x, o.threatY - o.pos.y);
    const stillClose = dThreat < st.sight * FLEE_SAFE_MULT;

    if (simClock < o.fleeUntil || stillClose) {
      o.mode = 'flee';
      o.target = {
        x: o.threatX == null ? o.pos.x : o.threatX,
        y: o.threatY == null ? o.pos.y : o.threatY,
      };
      return;
    }

    o.fleeThreat = null;
    o.fleeUntil = 0;
  }

  // Food: prefer pieces away from the last known threat position.
  let food = null;
  let foodD = Infinity;
  let safeFood = null;
  let safeFoodD = Infinity;
  const threatRecent = o.threatX != null && simClock < o.threatAt + 6;
  const store = currentFood();
  if (store) {
    for (const id in store) {
      const f = store[id];
      if (!f || typeof f.x !== 'number') continue;
      const d = Math.hypot(f.x - o.pos.x, f.y - o.pos.y);
      if (d > st.sight) continue;

      if (d < foodD) {
        food = f;
        foodD = d;
      }
      if (threatRecent) {
        const td = Math.hypot(f.x - o.threatX, f.y - o.threatY);
        if (td > st.sight * 0.9 && d < safeFoodD) {
          safeFood = f;
          safeFoodD = d;
        }
      }
    }
  }
  if (threatRecent && safeFood) {
    food = safeFood;
    foodD = safeFoodD;
  }

  // Aggression against the other Otto's Size decides fight or flight.
  const scared = enemy && st.aggression < enemy.size * 10;
  const hungry = o.energy < need;
  const needsHeal = o.hp < (o.maxHp || MAX_HP);
  const wantsSurplus = o.energy < need * ENERGY_STORE_MULT;

  if (scared) {
    o.mode = 'flee';
    o.fleeThreat = enemy;
    o.fleeUntil = simClock + FLEE_MIN_TIME;
    o.threatX = enemy.x;
    o.threatY = enemy.y;
    o.threatAt = simClock;
    o.target = { x: enemy.x, y: enemy.y };
    return;
  }

  if (food && (hungry || needsHeal)) {
    o.mode = 'eat';
    o.target = { x: food.x, y: food.y };
    return;
  }

  if (enemy) {
    if (!o.target || !o.target.foe || o.target.foe.id !== enemy.id) {
      o.chaseStartDist = Math.hypot(enemy.x - o.pos.x, enemy.y - o.pos.y);
      o.chaseElapsed = 0;
    }
    o.mode = 'hunt';
    o.target = { x: enemy.x, y: enemy.y, foe: enemy };
    return;
  }

  // Fed for the day but not yet ready to reproduce: keep grazing if it can.
  if (food && wantsSurplus) {
    o.mode = 'eat';
    o.target = { x: food.x, y: food.y };
    return;
  }

  o.mode = 'wander';
  if (
    !o.wander ||
    Math.hypot(o.wander.x - o.pos.x, o.wander.y - o.pos.y) < 1.5
  ) {
    if (threatRecent) {
      const away = Math.atan2(o.pos.y - o.threatY, o.pos.x - o.threatX);
      const a = away + (Math.random() * 2 - 1) * Math.PI * 0.45;
      const r = 2 + Math.random() * Math.min(6, fieldHalf() * 0.5);
      o.wander = {
        x: o.pos.x + Math.cos(a) * r,
        y: o.pos.y + Math.sin(a) * r,
      };
    } else {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * Math.min(8, fieldHalf() * 0.6);
      o.wander = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    }
  }
  o.target = o.wander;
}

// Bend the desired direction around friendly Ottos. The separation pass is
// still kept as a last-resort overlap fix.
function applyFriendlySteering(o, ux, uy) {
  let rx = 0;
  let ry = 0;

  for (const b of ottos) {
    if (b === o || b.dead) continue;

    const dx = o.pos.x - b.pos.x;
    const dy = o.pos.y - b.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.001) continue;

    const personal =
      FRIEND_SPACE * (ottoHalfWidth(o.stats.size) + ottoHalfWidth(b.stats.size));

    // Soft repulsion inside the personal space.
    if (d < personal) {
      const w = (personal - d) / personal;
      rx += (dx / d) * w;
      ry += (dy / d) * w;
    }

    // If the friend is directly ahead, add a sideways component to walk around.
    const relX = b.pos.x - o.pos.x;
    const relY = b.pos.y - o.pos.y;
    const along = relX * ux + relY * uy;
    const leftX = -uy;
    const leftY = ux;
    const perp = relX * leftX + relY * leftY;
    const sep = Math.hypot(relX, relY);
    const front = personal * 1.8;
    if (along > 0 && sep < front && Math.abs(perp) < personal * 0.9) {
      let side = perp > 0 ? -1 : 1;
      if (Math.abs(perp) < 0.001) side = o.id % 2 ? -1 : 1;
      const w =
        (1 - Math.abs(perp) / (personal * 0.9)) * (1 - sep / front);
      rx += leftX * side * w * 1.1;
      ry += leftY * side * w * 1.1;
    }
  }

  let sx = ux + rx * FRIEND_STEER;
  let sy = uy + ry * FRIEND_STEER;
  const len = Math.hypot(sx, sy);
  if (len > 0.001) {
    sx /= len;
    sy /= len;
  }
  return { x: sx, y: sy };
}

function updateChase(o, dt) {
  const foe = o.target && o.target.foe;
  if (!foe || !remote.has(foe.id) || foe.hp <= 0) return;

  o.chaseElapsed += dt;
  if (o.chaseElapsed < 1.0) return;

  const d = Math.hypot(foe.x - o.pos.x, foe.y - o.pos.y);
  const foeSpeed = numberOr(foe.speed, 1);
  const faster = foeSpeed > o.stats.speed * 1.05;
  const grown = d - o.chaseStartDist;

  // A faster target that keeps pulling away is not worth chasing. A target
  // that has gained a lot of ground is abandoned even if it is slower.
  if ((faster && grown > 0.25) || grown > 0.8) {
    o.chaseIgnoreId = foe.id;
    o.chaseIgnoreUntil = simClock + 5;
    o.mode = 'wander';
    o.target = null;
    o.wander = null;
    o.think = 0;
    o.chaseElapsed = 0;
  }
}

function moveOtto(o, dt) {
  const st = o.stats;
  const t = o.target;
  o.moving = false;
  if (!t) return;

  let tx = t.x;
  let ty = t.y;
  let speed = st.speed;

  if (o.mode === 'flee') {
    const dx = o.pos.x - t.x;
    const dy = o.pos.y - t.y;
    const d = Math.hypot(dx, dy) || 1;
    tx = o.pos.x + (dx / d) * FLEE_RANGE;
    ty = o.pos.y + (dy / d) * FLEE_RANGE;
    speed *= 1.2;
  } else if (o.mode === 'wander') {
    speed *= 0.45;
  }

  const dx = tx - o.pos.x;
  const dy = ty - o.pos.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.06) {
    const ux = dx / d;
    const uy = dy / d;
    const steer = applyFriendlySteering(o, ux, uy);
    const step = Math.min(d, speed * dt);
    o.pos.x += steer.x * step;
    o.pos.y += steer.y * step;
    o.facing = steer.x >= 0 ? 1 : -1;
    o.moving = true;
  }

  if (o.mode === 'hunt') {
    fightIfTouching(o);
    keepBesideFoe(o);
    updateChase(o, dt);
  }
}

function ottoHalfWidth(size) {
  return 0.5 * OTTO_UNITS_TALL * size * (OTTO_CROP.w / OTTO_CROP.h);
}

function fightStandoff(aSize, bSize) {
  return Math.max(1.4, FIGHT_STANDOFF * (ottoHalfWidth(aSize) + ottoHalfWidth(bSize)));
}

// While hunting, hold the local Otto at the standoff edge so it fights beside
// the foe rather than sliding inside it. Only this phone moves its own Otto;
// the other phone applies the same rule to its own.
function keepBesideFoe(o) {
  const foe = o.target && o.target.foe;
  if (!foe || !remote.has(foe.id) || foe.hp <= 0) return;

  const standoff = fightStandoff(o.stats.size, foe.size);
  let dx = o.pos.x - foe.x;
  let dy = o.pos.y - foe.y;
  let d = Math.hypot(dx, dy);
  if (d >= standoff) return;

  if (d < 0.001) {
    const a = Math.random() * Math.PI * 2;
    dx = Math.cos(a);
    dy = Math.sin(a);
    d = 1;
  }

  const push = (standoff - d) * 0.35;
  o.pos.x += (dx / d) * push;
  o.pos.y += (dy / d) * push;
}

function fightIfTouching(o) {
  if (o.dead || o.fightCd > 0) return;
  const foe = o.target && o.target.foe;
  if (!foe || !remote.has(foe.id) || foe.hp <= 0) return;

  const standoff = fightStandoff(o.stats.size, foe.size);
  const d = Math.hypot(foe.x - o.pos.x, foe.y - o.pos.y);
  if (d > standoff + 0.05) return;

  o.fightCd = FIGHT_COOLDOWN;

  // Direct damage: the attacker's Attack stat is subtracted from HP.
  o.hp = Math.max(0, o.hp - Math.max(1, foe.attack));

  // Dev enemies have no phone to apply damage to them, so take it here.
  if (foe.dev) {
    foe.hp = Math.max(0, foe.hp - Math.max(1, o.stats.attack));
    if (foe.hp <= 0) foe.deadTime = 0;
  }

  // Resolve to the standoff edge plus a small knockback. Both phones run the
  // same comparison from the broadcast stats, so both back out to their side.
  let nx = o.pos.x - foe.x;
  let ny = o.pos.y - foe.y;
  let n = Math.hypot(nx, ny);
  if (n < 0.001) {
    const a = Math.random() * Math.PI * 2;
    nx = Math.cos(a);
    ny = Math.sin(a);
    n = 1;
  }
  const out = standoff + 0.3;
  o.pos.x = foe.x + (nx / n) * out;
  o.pos.y = foe.y + (ny / n) * out;
  o.pop = 1;
  o.wander = null;
  o.chaseStartDist = Math.hypot(foe.x - o.pos.x, foe.y - o.pos.y);
  o.chaseElapsed = 0;

  if (o.hp <= 0) {
    o.hp = 0;
    o.dead = true;
    o.death = 0;
    o.mode = 'dead';
    o.moving = false;
    o.target = null;
  }
}

function healOtto(o, fraction = HEAL_FRACTION) {
  const maxHp = o.maxHp || MAX_HP;
  o.hp = Math.min(maxHp, o.hp + maxHp * fraction);
}

function eatNearby(o, store) {
  const maxEnergy = energyRequirementFor(o.stats.size) * ENERGY_STORE_MULT;
  const maxHp = o.maxHp || MAX_HP;
  // A full Otto still eats if it is damaged and the food can heal it.
  if (o.energy >= maxEnergy && o.hp >= maxHp) return;

  for (const id in store) {
    const f = store[id];
    if (!f || typeof f.x !== 'number') continue;
    if (Math.hypot(f.x - o.pos.x, f.y - o.pos.y) > EAT_RADIUS) continue;

    o.energy = Math.min(
      maxEnergy,
      o.energy + (Number(f.amount) || FOOD_AMOUNT)
    );
    healOtto(o);
    delete store[id];
    o.pop = 1;
    return;
  }
}

// --------------------------------------------------------------------- food

function currentFood() {
  if (shareConnected) return shared.food || null;
  return localFood;
}

// Food is reset once per day: 30 fresh pieces in random positions. There is no
// continuous timer-based topping up anymore.
function updateFood(dt) {
  if (paused || !shareConnected || !shared.started) return;

  // Only the day leader seeds, so multiple phones cannot overwrite the
  // room's food layout.
  if (!isDayLeader()) return;
  if (shared.foodSeedDay === shared.day) return;
  const fresh = {};
  seedFood(fresh, FOOD_PER_DAY);
  shared.food = fresh;
  shared.foodSeedDay = shared.day;
}

function seedFood(store, howMany) {
  let count = Object.keys(store).length;
  const half = Math.max(1, FIELD_HALF - FOOD_RADIUS - 0.8);
  for (let i = 0; i < howMany && count < FOOD_MAX; i++, count++) {
    store['f' + Math.floor(Math.random() * 1e9)] = {
      x: Math.round((Math.random() * 2 - 1) * half * 100) / 100,
      y: Math.round((Math.random() * 2 - 1) * half * 100) / 100,
      amount: FOOD_AMOUNT,
    };
  }
}

// --------------------------------------------------------------------- share

function syncMe() {
  if (!window.me) return;

  // p5-phone clones object values when they are assigned, so build the whole
  // colony as plain data and hand it over in one patch. Nested mutation of a
  // newly assigned object would be lost.
  const list = [];
  for (const o of ottos) {
    list.push({
      id: o.id,
      x: Math.round(o.pos.x * 100) / 100,
      y: Math.round(o.pos.y * 100) / 100,
      size: Math.round(o.stats.size * 100) / 100,
      attack: o.stats.attack,
      speed: o.stats.speed,
      aggression: o.stats.aggression,
      sight: o.stats.sight,
      hp: Math.max(0, Math.round(o.hp)),
      maxHp: Math.max(1, Math.round(o.maxHp || MAX_HP)),
      assetIndex: o.assetIndex == null ? -1 : o.assetIndex,
    });
  }
  me.ottos = list;
}

function updateRemote(dt) {
  const seen = new Set();

  if (shareConnected && Array.isArray(guests)) {
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i];
      if (!g) continue;

      // Every phone broadcasts a colony. Older clients sent a single `otto`,
      // so accept that shape too and render it as a one-member group.
      const list = Array.isArray(g.ottos) ? g.ottos : g.otto ? [g.otto] : [];
      const base = g.id || 'guest-' + i;

      for (let j = 0; j < list.length; j++) {
        const data = list[j];
        if (!data || typeof data.x !== 'number') continue;

        const id = base + '#' + (data.id !== undefined ? data.id : j);
        seen.add(id);

        let r = remote.get(id);
        if (!r) {
          r = {
            id,
            client: base,
            x: data.x,
            y: data.y,
            tx: data.x,
            ty: data.y,
            size: 1,
            attack: 10,
            speed: 1,
            aggression: 10,
            sight: 8,
            hp: MAX_HP,
            maxHp: MAX_HP,
            assetIndex: null,
            credited: false,
            deadTime: 0,
            facing: 1,
            lock: 0,
          };
          remote.set(id, r);
        }

        r.tx = data.x;
        r.ty = data.y;
        r.size = numberOr(data.size, 1);
        r.attack = numberOr(data.attack, 10);
        r.speed = numberOr(data.speed, 1);
        r.aggression = numberOr(data.aggression, 10);
        r.sight = numberOr(data.sight, 8);
        r.hp = numberOr(data.hp, MAX_HP);
        r.maxHp = numberOr(data.maxHp, MAX_HP);
        r.assetIndex =
          typeof data.assetIndex === 'number' && data.assetIndex >= 0
            ? data.assetIndex
            : null;

        // The loser's phone broadcasts hp 0 for a short death linger. The
        // nearby living Otto on this phone is the victor and claims the food.
        if (r.hp <= 0) {
          r.deadTime += dt;
          if (!r.credited) {
            r.credited = true;
            awardKill(r);
          }
        } else {
          r.deadTime = 0;
          r.credited = false;
        }

        if (Math.abs(r.tx - r.x) > 0.02) r.facing = r.tx >= r.x ? 1 : -1;
      }
    }
  }

  // Sync the shared pause state. A simple majority starts a 10-second resume
  // countdown; the day only resumes when that timer expires.
  if (shareConnected && shared.pause && typeof shared.pause === 'object') {
    let p = shared.pause;
    if (p.active && p.day === dayNumber) {
      if (!paused) {
        paused = true;
        pauseDay = dayNumber;
        localReady = false;
      }
      const playerGuests = Array.isArray(guests)
        ? guests.filter((g) => g && (Array.isArray(g.ottos) || g.otto))
        : [];
      const needed = playerGuests.length + 1;

      // Auto-skip means this player's YES is cast automatically each day.
      if (autoSkipDay && shareClientId && !(p.votes && p.votes[shareClientId])) {
        castLocalYes();
      }

      p = shared.pause || p;
      const votes = p.votes || {};
      const have = Object.keys(votes).length;
      const majority = have > needed / 2;

      if (have >= needed) {
        // Unanimous vote: resume immediately, no countdown.
        paused = false;
        localReady = false;
        shared.pause = { active: false, day: dayNumber, votes: {} };
      } else if (majority) {
        if (!p.resumeAt) {
          shared.pause = {
            active: true,
            day: dayNumber,
            votes: Object.assign({}, votes),
            resumeAt: Date.now() + 10000,
          };
          p = shared.pause;
        }
        if (p.resumeAt && Date.now() >= p.resumeAt) {
          paused = false;
          localReady = false;
          shared.pause = { active: false, day: dayNumber, votes: {} };
        }
      } else if (p.resumeAt) {
        // A new participant lowered the majority; cancel the countdown.
        shared.pause = {
          active: true,
          day: dayNumber,
          votes: Object.assign({}, votes),
        };
      }
    } else if (!p.active || p.day !== dayNumber) {
      paused = false;
    }
  }

  for (const [id, r] of remote) {
    if (r.dev) {
      r.lock = 1;
      if (r.hp <= 0) {
        r.deadTime += dt;
        if (!r.credited) {
          r.credited = true;
          awardKill(r);
        }
        if (r.deadTime >= DEATH_LINGER) remote.delete(id);
      } else {
        r.deadTime = 0;
        r.credited = false;
      }
      continue;
    }

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

function awardKill(foe) {
  let victor = null;
  let best = Infinity;

  for (const o of ottos) {
    if (o.dead || o.hp <= 0) continue;

    const hunting = o.target && o.target.foe && o.target.foe.id === foe.id;
    const d = Math.hypot(o.pos.x - foe.x, o.pos.y - foe.y);
    if (!hunting && d > CONTACT_RADIUS * 2.5) continue;

    const score = hunting ? d - 1000 : d;
    if (score < best) {
      best = score;
      victor = o;
    }
  }

  if (!victor) return;
  victor.energy += Math.max(0, numberOr(foe.size, 1)) * 100;
  healOtto(victor);
  victor.pop = 1;
}

function numberOr(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

// ------------------------------------------------------------------ drawing

function drawPauseOverlay() {
  // The creation screen already has a full layout; its stats column must not
  // be covered by the pause card.
  if (allocationActive) {
    yesHit = null;
    return;
  }

  if (!paused) {
    yesHit = null;
    return;
  }

  const s = constrain(width * 0.031, 10, 16);

  // Keep the game visible and interactive: a small card in the top-right
  // corner instead of a full-screen dimming overlay.
  const cardW = s * 15;
  const cardH = shareConnected ? s * 6.2 : s * 3.4;
  const cardX = width - cardW - 14;
  const cardY = 16 + s * 1.2;

  push();
  noStroke();
  fill(4, 10, 16, 190);
  rect(cardX, cardY, cardW, cardH, 10);
  stroke(140, 230, 255, 90);
  strokeWeight(1);
  noFill();
  rect(cardX, cardY, cardW, cardH, 10);
  noStroke();

  textAlign(LEFT, TOP);
  fill(240, 252, 255, 235);
  textSize(s * 0.85);
  text(`DAY ${dayNumber} · PAUSED`, cardX + 10, cardY + 6);

  if (shareConnected) {
    const playerGuests = Array.isArray(guests)
      ? guests.filter((g) => g && (Array.isArray(g.ottos) || g.otto))
      : [];
    const needed = playerGuests.length + 1;
    const p = shared.pause || {};
    const votes = p.votes || {};
    const have = Object.keys(votes).length;
    const majority = have > needed / 2;
    const resumeAt = p.resumeAt || 0;
    const remaining = resumeAt ? Math.max(0, resumeAt - Date.now()) : 0;
    const secs = Math.ceil(remaining / 1000);

    fill(180, 220, 240, 190);
    textSize(s * 0.62);
    text(
      majority ? `RESUMING IN ${secs}s · ${have}/${needed}` : `Waiting: ${have}/${needed}`,
      cardX + 10,
      cardY + 6 + s * 1.15
    );

    if (majority) {
      yesHit = null;
      const bw = cardW - 20;
      const bh = s * 0.75;
      const bx = cardX + 10;
      const by = cardY + cardH - bh - 8;
      const frac = constrain(remaining / 10000, 0, 1);
      noStroke();
      fill(255, 255, 255, 34);
      rect(bx, by, bw, bh, bh / 2);
      fill(126, 255, 190, 210);
      rect(bx, by, bw * frac, bh, bh / 2);
    } else {
      const bw = cardW - 20;
      const bh = s * 2.2;
      const bx = cardX + 10;
      const by = cardY + cardH - bh - 6;
      yesHit = { x: bx, y: by, w: bw, h: bh };

      noFill();
      stroke(localReady ? color(126, 255, 190, 170) : color(140, 230, 255, 90));
      strokeWeight(1);
      rect(bx, by, bw, bh, bh / 2);
      noStroke();
      fill(localReady ? color(126, 255, 190, 230) : color(150, 235, 255, 200));
      textAlign(CENTER, CENTER);
      textSize(s * 0.72);
      text(localReady ? 'YES ✓' : 'YES', bx + bw / 2, by + bh / 2 + 1);
    }
  } else {
    fill(180, 220, 240, 190);
    textSize(s * 0.62);
    text('Tap RESUME', cardX + 10, cardY + 6 + s * 1.15);
    yesHit = null;
  }

  pop();
}

function resetAllocation() {
  allocationPoints = {
    attack: 0,
    speed: 0,
    size: 0,
    sight: 0,
    aggression: 0,
    hp: 0,
  };
  allocationRemaining = 10;
  allocationActive = true;
  allocationHits = [];
  allocationConfirmHit = null;
  colorHits = [];
  teamColorIndex = Math.floor(Math.random() * COLONY_COLORS.length);
  pendingAssetIndex = randomAssetIndex();
  lobbyChoiceActive = false;
  storedPlaceHit = null;
  scratchHit = null;
  pendingStats = null;
  pendingMaxHp = MAX_HP;
  placementActive = false;
  placementMode = 'new';
  colonySpawned = false;
  colonyLost = false;
  examineClone = null;
  examineRef = null;
  examineSnapshot = null;
  examineT = 0;
  examineLeaving = false;
}

function saveStoredOtto() {
  try {
    if (!storedOtto) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const o = storedOtto;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        id: o.id,
        stats: o.stats,
        hp: o.hp,
        maxHp: o.maxHp,
        energy: o.energy,
        assetIndex: o.assetIndex,
        colorIndex: teamColorIndex,
      })
    );
  } catch (e) {
    // Storage is optional; ignore unavailable/blocked localStorage.
  }
}

function loadStoredOtto() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s || !s.stats) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const o = createOtto(
      s.stats,
      0,
      0,
      s.maxHp || MAX_HP,
      s.assetIndex == null ? null : s.assetIndex
    );
    o.id = numberOr(s.id, o.id);
    o.hp = constrain(numberOr(s.hp, o.maxHp), 1, o.maxHp);
    o.energy = Math.max(0, numberOr(s.energy, 0));
    if (typeof s.colorIndex === 'number' && COLONY_COLORS[s.colorIndex]) {
      teamColorIndex = s.colorIndex;
    }
    nextOttoId = Math.max(nextOttoId, o.id + 1);
    storedOtto = o;
  } catch (e) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e2) {}
  }
}

function clearStoredOtto() {
  storedOtto = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

function storeOtto(o) {
  if (!shareConnected || !paused || storedOtto || !o || o.dead) return;
  const index = ottos.indexOf(o);
  if (index < 0) return;

  ottos.splice(index, 1);
  o.pos.x = 0;
  o.pos.y = 0;
  o.mode = 'stored';
  o.moving = false;
  o.target = null;
  o.wander = null;
  o.think = 0;
  o.fightCd = 0;
  o.fleeThreat = null;
  o.fleeUntil = 0;
  o.chaseIgnoreId = null;
  o.chaseIgnoreUntil = 0;
  o.chaseStartDist = 0;
  o.chaseElapsed = 0;
  storedOtto = o;
  saveStoredOtto();
  dismissExamine();
  syncMe();
  if (ottos.length === 0) {
    lobbyChoiceActive = true;
    colonyLost = false;
  }
}

function placeStoredOtto(fx, fy) {
  if (!storedOtto) return;
  const o = storedOtto;
  const p = clampToField(
    fx,
    fy,
    Math.max(0.8, 1.5 * (o.stats.size || 1))
  );

  o.pos.x = p.x;
  o.pos.y = p.y;
  o.mode = 'wander';
  o.moving = false;
  o.target = null;
  o.wander = null;
  o.think = 0;
  o.fightCd = 0;
  o.fleeThreat = null;
  o.fleeUntil = 0;
  o.chaseIgnoreId = null;
  o.chaseIgnoreUntil = 0;
  o.chaseStartDist = 0;
  o.chaseElapsed = 0;
  o.spawn = 0;
  o.dead = false;
  o.death = 0;
  ottos.push(o);
  fieldEntered = true;

  clearStoredOtto();
  colonySpawned = true;
  placementActive = false;
  placementMode = 'new';
  lobbyChoiceActive = false;
  allocationActive = false;
  colonyLost = false;
  shared.started = true;
  if (window.me) me.colorIndex = teamColorIndex;
  syncMe();
}

function startFromScratch() {
  clearStoredOtto();
  lobbyChoiceActive = false;
  colonySpawned = false;
  colonyLost = false;
  placementActive = false;
  resetAllocation();
}

function adjustAllocation(key, dir) {
  if (dir < 0) {
    if (allocationPoints[key] <= 0) return;
    allocationPoints[key] -= 1;
    allocationRemaining += 1;
  } else {
    if (allocationRemaining <= 0) return;
    allocationPoints[key] += 1;
    allocationRemaining -= 1;
  }
}

function drawConnectionScreen() {
  if (shareConnected) return;

  push();
  noStroke();
  fill(4, 10, 16, 235);
  rect(0, 0, width, height);
  textAlign(CENTER, CENTER);
  fill(240, 252, 255, 235);
  textSize(constrain(width * 0.07, 20, 38));
  const connecting = shareStatus === 'connecting';
  text(connecting ? 'JOINING SHARED SPACE…' : 'SHARED SPACE DISCONNECTED', width / 2, height * 0.42);
  fill(180, 220, 240, 190);
  textSize(constrain(width * 0.035, 11, 16));
  text(
    connecting ? 'Keep the app open.' : 'Solo play is no longer available.',
    width / 2,
    height * 0.5
  );

  reconnectHit = null;
  if (!connecting) {
    const bw = Math.min(width - 60, 280);
    const bh = 54;
    const bx = width / 2 - bw / 2;
    const by = height * 0.58;
    reconnectHit = { x: bx, y: by, w: bw, h: bh };
    noFill();
    stroke(140, 230, 255, 120);
    strokeWeight(1);
    rect(bx, by, bw, bh, bh / 2);
    noStroke();
    fill(150, 235, 255, 220);
    textSize(15);
    text('RECONNECT', width / 2, by + bh / 2 + 1);
  } else {
    reconnectHit = null;
  }
  pop();
}

function drawAllocationScreen() {
  const s = constrain(width * 0.031, 10, 16);
  const panelW = Math.min(width - 16, 680);
  const panelH = Math.min(height - 20, 600);
  const panelX = (width - panelW) / 2;
  const panelY = (height - panelH) / 2;
  allocationHits = [];
  colorHits = [];
  allocationConfirmHit = null;

  push();
  noStroke();
  fill(4, 10, 16, 240);
  rect(0, 0, width, height);
  fill(7, 14, 22, 245);
  rect(panelX, panelY, panelW, panelH, 16);
  stroke(140, 230, 255, 60);
  strokeWeight(1);
  noFill();
  rect(panelX, panelY, panelW, panelH, 16);
  noStroke();

  const pad = Math.max(12, s * 0.9);
  const headerH = Math.max(58, s * 3.6);
  const footerH = Math.max(58, s * 3.2);
  const contentY = panelY + headerH;
  const contentH = panelH - headerH - footerH;
  const leftW = Math.min(panelW * 0.42, 230);
  const rightX = panelX + leftW + pad;
  const rightW = panelW - leftW - pad * 2;

  fill(240, 252, 255, 240);
  textAlign(LEFT, TOP);
  textSize(Math.max(15, s * 1.1));
  text('CREATE YOUR OTTO', panelX + pad, panelY + 12);
  fill(126, 255, 190, 220);
  textSize(Math.max(11, s * 0.78));
  text(`${allocationRemaining} POINTS LEFT`, panelX + pad, panelY + 12 + s * 1.5);

  // Left column: preview + colour picker, centred vertically beside the stats.
  const cols = 5;
  const swGap = leftW / cols;
  const swR = Math.min(9, swGap * 0.3);
  const swatchRows = Math.ceil(COLONY_COLORS.length / cols);
  const swatchH =
    Math.max(14, swR + 6) + (swatchRows - 1) * (swR * 2 + 8) + swR + 4;
  // Keep the preview inside the left column: width follows the sprite's aspect.
  const previewCap = Math.max(58, (leftW - 12) / 1.1);
  const previewH = Math.max(
    58,
    Math.min(
      150 + allocationPoints.size * 8,
      previewCap,
      Math.min(contentH * 0.58, 240) - 18
    )
  );
  const previewAreaH = previewH + 18;
  const leftGroupH = previewAreaH + 8 + swatchH;
  const leftOffset = Math.max(0, (contentH - leftGroupH) / 2);
  const previewBottom = contentY + leftOffset + previewAreaH;
  const previewCx = panelX + leftW / 2;

  fill(255, 255, 255, 16);
  ellipse(previewCx, previewBottom, previewH * 1.1, previewH * 0.3);
  drawOttoPreview(
    previewCx,
    previewBottom,
    previewH,
    COLONY_COLORS[teamColorIndex] || COLONY_COLORS[0],
    ottoAssets[pendingAssetIndex] || ottoAssetFor(nextOttoId)
  );

  const colorY = previewBottom + 8;
  fill(150, 200, 225, 180);
  textAlign(LEFT, CENTER);
  textSize(Math.max(9, s * 0.55));
  text('TEAM COLOUR', panelX + 6, colorY);

  const swCy0 = colorY + Math.max(14, swR + 6);
  for (let i = 0; i < COLONY_COLORS.length; i++) {
    const cx = panelX + swGap * ((i % cols) + 0.5);
    const cy = swCy0 + Math.floor(i / cols) * (swR * 2 + 8);
    noStroke();
    fill(COLONY_COLORS[i][0], COLONY_COLORS[i][1], COLONY_COLORS[i][2], 230);
    circle(cx, cy, swR * 2);
    if (i === teamColorIndex) {
      noFill();
      stroke(255, 255, 255, 220);
      strokeWeight(2);
      circle(cx, cy, swR * 2 + 7);
      noStroke();
    }
    colorHits.push({
      x: cx - swR - 5,
      y: cy - swR - 5,
      w: swR * 2 + 10,
      h: swR * 2 + 10,
      index: i,
    });
  }

  // Right column: stat rows.
  const keys = ['attack', 'speed', 'size', 'sight', 'aggression', 'hp'];
  const labels = ['ATTACK', 'SPEED', 'SIZE', 'SIGHT', 'AGGRESSION', 'HP'];
  const base = defaultStats();
  const rowH = Math.min(s * 4.6, (contentH - 20) / 6);
  const rowsY = contentY + (contentH - rowH * 6) / 2;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const points = allocationPoints[key];
    const y = rowsY + i * rowH;
    const cy = y + rowH / 2;
    let value;
    if (key === 'hp') value = `${MAX_HP + points * 10}`;
    else if (key === 'speed') value = (base.speed + points * 0.1).toFixed(1);
    else if (key === 'size') value = (base.size + points * 0.1).toFixed(2);
    else value = String(base[key] + points);

    fill(170, 215, 235, 190);
    textAlign(LEFT, CENTER);
    textSize(Math.max(9, s * 0.6));
    text(points > 0 ? `${labels[i]} +${points}` : labels[i], rightX, cy);

    fill(240, 252, 255, 230);
    textAlign(RIGHT, CENTER);
    textSize(Math.max(10, s * 0.66));
    text(value, rightX + rightW - s * 6.4, cy);

    const bw = s * 2.2;
    const bh = Math.min(s * 1.6, rowH * 0.7);
    const by = cy - bh / 2;
    const minusX = rightX + rightW - s * 5.6;
    const plusX = rightX + rightW - s * 3.1;

    for (const [bx, label, dir] of [
      [minusX, '−', -1],
      [plusX, '+', 1],
    ]) {
      const active = dir < 0 ? points > 0 : allocationRemaining > 0;
      noFill();
      stroke(active ? color(140, 230, 255, 120) : color(80, 100, 115, 80));
      strokeWeight(1);
      rect(bx, by, bw, bh, bh / 2);
      noStroke();
      fill(active ? color(150, 235, 255, 220) : color(100, 120, 135, 120));
      textAlign(CENTER, CENTER);
      textSize(s * 0.78);
      text(label, bx + bw / 2, by + bh / 2 + 1);
      if (active) allocationHits.push({ x: bx, y: by, w: bw, h: bh, key, dir });
    }
  }

  // Bottom confirm button.
  const confirmH = Math.max(50, s * 2.6);
  const bx = panelX + pad;
  const by = panelY + panelH - confirmH - 14;
  const bw = panelW - pad * 2;
  const ready = allocationRemaining === 0;
  allocationConfirmHit = { x: bx, y: by, w: bw, h: confirmH, enabled: ready };

  noFill();
  stroke(ready ? color(126, 255, 190, 180) : color(80, 100, 115, 90));
  strokeWeight(1);
  rect(bx, by, bw, confirmH, confirmH / 2);
  noStroke();
  fill(ready ? color(126, 255, 190, 230) : color(100, 120, 135, 150));
  textAlign(CENTER, CENTER);
  textSize(Math.max(11, s * 0.82));
  text(
    ready ? 'CONFIRM & PLACE' : 'SPEND ALL 10 POINTS',
    bx + bw / 2,
    by + confirmH / 2 + 1
  );

  pop();
}

function drawPlacementPrompt() {
  push();
  noStroke();
  const s = constrain(width * 0.031, 10, 16);
  const msg = !window.cameraEnabled
    ? 'TAP TO START THE CAMERA'
    : field.ok && fieldLock > 0.05
    ? 'TAP INSIDE THE TAPE TO PLACE YOUR OTTO'
    : 'SHOW THE GREEN TAPE SQUARE TO PLACE YOUR OTTO';
  textAlign(CENTER, CENTER);
  textSize(s * 0.8);
  const w = textWidth(msg) + 36;
  const h = s * 2.6;
  const x = width / 2 - w / 2;
  const y = height - h - 28;
  fill(4, 10, 16, 205);
  rect(x, y, w, h, h / 2);
  fill(240, 252, 255, 230);
  text(msg, width / 2, y + h / 2 + 1);
  pop();
}

function drawColonyLostScreen() {
  push();
  noStroke();
  fill(4, 10, 16, 225);
  rect(0, 0, width, height);
  textAlign(CENTER, CENTER);
  fill(255, 150, 150, 235);
  textSize(constrain(width * 0.075, 24, 42));
  text('COLONY LOST', width / 2, height * 0.4);
  fill(180, 220, 240, 190);
  textSize(constrain(width * 0.035, 11, 16));
  text('All of your Ottos are gone.', width / 2, height * 0.48);

  const bw = Math.min(width - 60, 280);
  const bh = 54;
  const bx = width / 2 - bw / 2;
  const by = height * 0.56;
  failRetryHit = { x: bx, y: by, w: bw, h: bh };
  noFill();
  stroke(255, 200, 110, 160);
  strokeWeight(1);
  rect(bx, by, bw, bh, bh / 2);
  noStroke();
  fill(255, 220, 150, 230);
  textSize(15);
  text('RETRY WITH A NEW OTTO', width / 2, by + bh / 2 + 1);
  pop();
}

function drawStoredChoiceScreen() {
  if (!storedOtto) return;

  push();
  noStroke();
  fill(4, 10, 16, 228);
  rect(0, 0, width, height);
  textAlign(CENTER, CENTER);
  fill(240, 252, 255, 235);
  textSize(constrain(width * 0.075, 24, 42));
  text(
    colonySpawned ? 'OTTO IN STORAGE' : 'WELCOME BACK',
    width / 2,
    height * 0.28
  );

  const previewY = height * 0.47;
  drawOttoPreview(
    width / 2,
    previewY,
    Math.min(120, height * 0.16),
    COLONY_COLORS[teamColorIndex] || COLONY_COLORS[0],
    storedOtto.assetIndex == null
      ? ottoAssetFor(storedOtto.id)
      : ottoAssets[storedOtto.assetIndex] || ottoAssetFor(storedOtto.id)
  );

  fill(180, 220, 240, 190);
  textSize(constrain(width * 0.035, 11, 16));
  text('You have a stored Otto ready to place.', width / 2, height * 0.56);

  const bw = Math.min(width - 60, 320);
  const bh = 54;
  const bx = width / 2 - bw / 2;

  const placeY = height * 0.63;
  storedPlaceHit = { x: bx, y: placeY, w: bw, h: bh };
  noFill();
  stroke(126, 255, 190, 170);
  strokeWeight(1);
  rect(bx, placeY, bw, bh, bh / 2);
  noStroke();
  fill(126, 255, 190, 230);
  textSize(15);
  text('PLACE STORED OTTO', width / 2, placeY + bh / 2 + 1);

  const scratchY = height * 0.72;
  scratchHit = { x: bx, y: scratchY, w: bw, h: bh };
  noFill();
  stroke(255, 200, 110, 150);
  strokeWeight(1);
  rect(bx, scratchY, bw, bh, bh / 2);
  noStroke();
  fill(255, 220, 150, 230);
  text('START FROM SCRATCH', width / 2, scratchY + bh / 2 + 1);
  pop();
}

function drawLobbyOverlays() {
  storedPlaceHit = null;
  scratchHit = null;
  if (!shareConnected) {
    drawConnectionScreen();
    return;
  }
  if (lobbyChoiceActive && storedOtto) drawStoredChoiceScreen();
  else if (allocationActive) drawAllocationScreen();
  else if (placementActive) drawPlacementPrompt();
  else if (colonyLost) drawColonyLostScreen();
}

function drawWaiting(now) {
  background(5, 8, 12);

  const titleY = height * 0.52;
  const logoSize = constrain(min(width, height) * 0.22, 80, 160);
  if (logoImg) {
    imageMode(CENTER);
    image(logoImg, width / 2, titleY - logoSize * 0.72, logoSize, logoSize);
    imageMode(CORNER);
  }

  noStroke();
  fill(235, 250, 255, 230);
  textAlign(CENTER, CENTER);
  textSize(constrain(width * 0.075, 22, 44));
  text('OTTO BOX', width / 2, titleY);

  fill(130, 200, 225, 200);
  textSize(constrain(width * 0.034, 11, 16));
  text(
    window.cameraEnabled ? 'STARTING CAMERA...' : 'TAP TO START',
    width / 2,
    titleY + min(width, height) * 0.1
  );
}

// ------------------------------------------------------------- colony colours

function rgbColor(c) {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function colonyColorMap() {
  const ids = new Set();

  if (window.shareClientId) ids.add(window.shareClientId);
  if (typeof guests !== 'undefined' && Array.isArray(guests)) {
    for (const g of guests) if (g && g.id) ids.add(g.id);
  }
  for (const r of remote.values()) {
    if (r.client && !r.dev) ids.add(r.client);
  }

  const sorted = [...ids].sort();
  const map = new Map();
  for (let i = 0; i < sorted.length; i++) {
    map.set(sorted[i], COLONY_COLORS[i % COLONY_COLORS.length]);
  }
  return map;
}

function colonyColorFor(clientId) {
  if (!clientId) return COLONY_COLORS[teamColorIndex] || COLONY_COLORS[0];

  if (window.shareClientId && clientId === window.shareClientId) {
    return COLONY_COLORS[teamColorIndex] || COLONY_COLORS[0];
  }

  if (Array.isArray(guests)) {
    const g = guests.find((entry) => entry && entry.id === clientId);
    if (
      g &&
      typeof g.colorIndex === 'number' &&
      g.colorIndex >= 0 &&
      COLONY_COLORS[g.colorIndex]
    ) {
      return COLONY_COLORS[g.colorIndex];
    }
  }

  return colonyColorMap().get(clientId) || COLONY_COLORS[0];
}

// The Otto sprites are line art: the body is transparent. Tinting with
// source-atop would only recolour the ink, so the enclosed area is filled
// separately with a soft colour and drawn behind the line work.
function prepareOttoAsset(gif) {
  const layer = createGraphics(OTTO_CROP.w, OTTO_CROP.h);
  layer.pixelDensity(1);
  const fills = [];

  const props = gif.gifProperties;
  if (props && Array.isArray(props.frames)) {
    for (const frame of props.frames) {
      fills.push(buildOttoFills(frame.image));
    }
  } else if (gif.canvas) {
    const c = document.createElement('canvas');
    c.width = gif.canvas.width;
    c.height = gif.canvas.height;
    const cx = c.getContext('2d');
    cx.drawImage(gif.canvas, 0, 0);
    fills.push(buildOttoFills(cx.getImageData(0, 0, c.width, c.height)));
  }

  return { gif, layer, fills };
}

function idHash(id) {
  const text = String(id);
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Each Otto keeps one sprite asset for its whole life, chosen from its id.
// New Ottos are distributed across the available assets.
function ottoAssetIndexFor(id) {
  if (!ottoAssets.length) return 0;
  return idHash(id) % ottoAssets.length;
}

function ottoAssetFor(id) {
  return ottoAssets[ottoAssetIndexFor(id)] || ottoAssets[0];
}

function randomAssetIndex() {
  if (!ottoAssets.length) return 0;
  return Math.floor(Math.random() * ottoAssets.length);
}

// Build one coloured fill canvas per palette entry for a single GIF frame.
function buildOttoFills(src) {
  const W = OTTO_CROP.w;
  const H = OTTO_CROP.h;
  const solid = new Uint8Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x + OTTO_CROP.x;
      const sy = y + OTTO_CROP.y;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const a = src.data[(sy * src.width + sx) * 4 + 3];
      if (a > 24) solid[y * W + x] = 1;
    }
  }

  // Flood fill from the border to find the transparent area outside the
  // creature. Anything transparent and unreachable is body interior.
  const outside = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    const k = y * W + x;
    if (!solid[k] && !outside[k]) {
      outside[k] = 1;
      stack.push(k);
    }
  };

  for (let x = 0; x < W; x++) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y);
    push(W - 1, y);
  }

  while (stack.length) {
    const k = stack.pop();
    const x = k % W;
    const y = (k - x) / W;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }

  const inside = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!solid[i] && !outside[i]) inside[i] = 1;
  }

  // Let the fill slip one pixel under the inked edge to avoid a pale seam.
  const expanded = inside.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (!inside[k]) continue;
      if (x > 0 && solid[k - 1]) expanded[k - 1] = 1;
      if (x < W - 1 && solid[k + 1]) expanded[k + 1] = 1;
      if (y > 0 && solid[k - W]) expanded[k - W] = 1;
      if (y < H - 1 && solid[k + W]) expanded[k + W] = 1;
    }
  }

  const mask = document.createElement('canvas');
  mask.width = W;
  mask.height = H;
  const mctx = mask.getContext('2d');
  const img = mctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    if (!expanded[i]) continue;
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  mctx.putImageData(img, 0, 0);

  const fills = [];
  for (const col of COLONY_COLORS) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const cx = c.getContext('2d');
    cx.drawImage(mask, 0, 0);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = rgbColor(col);
    cx.fillRect(0, 0, W, H);
    fills.push(c);
  }
  return fills;
}

function ottoFillFor(asset, frame, color) {
  const fills = asset && asset.fills;
  if (!fills || !fills.length) return null;
  const set = fills[frame % fills.length] || fills[0];
  const index = COLONY_COLORS.indexOf(color);
  return set[index] || set[0] || null;
}

function drawColonyRing(ctx, cx, groundY, w, h, alpha, color, aspect = 1) {
  const rx = Math.max(8, w * 0.36);
  const ry = rx * aspect;

  ctx.save();
  ctx.fillStyle = rgbColor(color);
  ctx.strokeStyle = rgbColor(color);

  ctx.globalAlpha = alpha * 0.16;
  ctx.beginPath();
  ctx.ellipse(cx, groundY, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = alpha * 0.95;
  ctx.lineWidth = Math.max(1.5, h * 0.028);
  ctx.beginPath();
  ctx.ellipse(cx, groundY, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Rings are drawn in their own pass so every ring sits underneath every Otto,
// rather than a nearer Otto's ring crossing an overlapping neighbour.
function drawColonyRings() {
  if (!field.ok || !ottoAssets.length || fieldLock < 0.01) return;
  if (examineT > 0.15) return;

  const ctx = drawingContext;
  const localColor = colonyColorFor(window.shareClientId);

  for (const o of ottos) {
    const fade = o.dead ? Math.max(0, 1 - o.death / DEATH_LINGER) : 1;
    const alpha = fieldLock * o.spawn * fade;
    if (alpha < 0.01) continue;
    const p = fieldToScreen(o.pos.x, o.pos.y);
    const scale = fieldScreenScale(o.pos.x, o.pos.y);
    const h =
      OTTO_UNITS_TALL * o.stats.size * scale.avg * (1 + o.pop * 0.1);
    const w = h * (OTTO_CROP.w / OTTO_CROP.h);
    drawColonyRing(
      ctx,
      p.x,
      p.y,
      w,
      h,
      alpha,
      localColor,
      scale.y / scale.x
    );
  }

  for (const r of remote.values()) {
    if (r.lock <= 0.01) continue;
    const fade =
      r.hp <= 0 ? Math.max(0, 1 - (r.deadTime || 0) / DEATH_LINGER) : 1;
    const alpha = r.lock * fade;
    if (alpha < 0.01) continue;
    const p = fieldToScreen(r.x, r.y);
    const scale = fieldScreenScale(r.x, r.y);
    const h = OTTO_UNITS_TALL * r.size * scale.avg;
    const w = h * (OTTO_CROP.w / OTTO_CROP.h);
    drawColonyRing(
      ctx,
      p.x,
      p.y,
      w,
      h,
      alpha,
      r.dev ? r.color : colonyColorFor(r.client),
      scale.y / scale.x
    );
  }
}

function drawLocalOttos() {
  if (!ottoAssets.length || !field.ok || fieldLock < 0.01) return;
  const color = colonyColorFor(window.shareClientId);
  const sceneAlpha = 1 - examineT * 0.75;
  for (const o of ottos) {
    if (o === examineRef) continue;
    const fade = o.dead ? Math.max(0, 1 - o.death / DEATH_LINGER) : 1;
    const alpha = fieldLock * o.spawn * fade * sceneAlpha;
    if (alpha < 0.01) continue;
    const p = fieldToScreen(o.pos.x, o.pos.y);
    drawOttoAt(
      p.x,
      p.y,
      o.stats.size,
      alpha,
      o.facing,
      o.pop,
      o.hp / (o.maxHp || MAX_HP),
      color,
      o.assetIndex == null ? ottoAssetFor(o.id) : ottoAssets[o.assetIndex] || ottoAssetFor(o.id),
      fieldScreenScale(o.pos.x, o.pos.y).avg
    );
  }
}

function drawRemoteOttos() {
  if (!field.ok || !ottoAssets.length) return;
  const sceneAlpha = 1 - examineT * 0.75;
  for (const r of remote.values()) {
    if (r.lock <= 0.01) continue;
    if (r === examineRef) continue;
    const fade =
      r.hp <= 0 ? Math.max(0, 1 - (r.deadTime || 0) / DEATH_LINGER) : 1;
    const alpha = r.lock * fade * sceneAlpha;
    if (alpha < 0.01) continue;
    const p = fieldToScreen(r.x, r.y);
    drawOttoAt(
      p.x,
      p.y,
      r.size,
      alpha,
      r.facing,
      0,
      r.hp / (r.maxHp || MAX_HP),
      r.dev ? r.color : colonyColorFor(r.client),
      r.assetIndex == null ? ottoAssetFor(r.id) : ottoAssets[r.assetIndex] || ottoAssetFor(r.id),
      fieldScreenScale(r.x, r.y).avg
    );
  }
}

function drawOttoPreview(cx, groundY, h, color, asset) {
  const art = asset || ottoAssets[0];
  if (!art) return;
  const w = h * (OTTO_CROP.w / OTTO_CROP.h);
  const ctx = drawingContext;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, groundY, w * 0.4, w * 0.4 * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  art.layer.clear();
  art.layer.image(
    art.gif,
    0,
    0,
    OTTO_CROP.w,
    OTTO_CROP.h,
    OTTO_CROP.x,
    OTTO_CROP.y,
    OTTO_CROP.w,
    OTTO_CROP.h
  );

  const lc = art.layer.drawingContext;
  const frame = art.gif.gifProperties
    ? art.gif.gifProperties.displayIndex
    : 0;
  const fill = ottoFillFor(art, frame, color);

  lc.save();
  lc.globalCompositeOperation = 'source-atop';
  lc.globalAlpha = OTTO_TINT_ALPHA;
  lc.fillStyle = rgbColor(color);
  lc.fillRect(0, 0, OTTO_CROP.w, OTTO_CROP.h);
  lc.restore();

  if (fill) {
    lc.save();
    lc.globalCompositeOperation = 'destination-over';
    lc.globalAlpha = OTTO_FILL_ALPHA;
    lc.drawImage(fill, 0, 0);
    lc.restore();
  }

  ctx.drawImage(art.layer.canvas, cx - w / 2, groundY - h, w, h);
}

function drawOttoAt(
  cx,
  groundY,
  size,
  alpha,
  facing,
  pop,
  hpFrac = 1,
  color = COLONY_COLORS[0],
  asset = null,
  groundScale = 1
) {
  const art = asset || ottoAssets[0];
  if (!art) return;
  const h =
    OTTO_UNITS_TALL * size * Math.max(0.001, groundScale) * (1 + pop * 0.1);
  const w = h * (OTTO_CROP.w / OTTO_CROP.h);
  const ctx = drawingContext;

  // Draw the Otto into a small buffer so the body fill can sit behind the ink
  // while the ink itself is tinted towards the colony colour.
  art.layer.clear();
  art.layer.image(
    art.gif,
    0,
    0,
    OTTO_CROP.w,
    OTTO_CROP.h,
    OTTO_CROP.x,
    OTTO_CROP.y,
    OTTO_CROP.w,
    OTTO_CROP.h
  );

  const lc = art.layer.drawingContext;
  const frame = art.gif.gifProperties
    ? art.gif.gifProperties.displayIndex
    : 0;
  const fill = ottoFillFor(art, frame, color);

  lc.save();
  lc.globalCompositeOperation = 'source-atop';
  lc.globalAlpha = OTTO_TINT_ALPHA;
  lc.fillStyle = rgbColor(color);
  lc.fillRect(0, 0, OTTO_CROP.w, OTTO_CROP.h);
  lc.restore();

  if (fill) {
    lc.save();
    lc.globalCompositeOperation = 'destination-over';
    lc.globalAlpha = OTTO_FILL_ALPHA;
    lc.drawImage(fill, 0, 0);
    lc.restore();
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, groundY);
  ctx.scale(facing, 1);
  ctx.drawImage(art.layer.canvas, -w / 2, -h, w, h);

  // Small health bar above a damaged Otto.
  if (hpFrac < 0.999 && alpha > 0.03) {
    const hp = constrain(hpFrac, 0, 1);
    const bw = w * 0.7;
    const bh = Math.max(2, h * 0.03);
    const bx = -bw / 2;
    const by = -h - bh * 2.5;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle =
      hp > 0.5 ? '#7effbe' : hp > 0.25 ? '#ffd166' : '#ff6b6b';
    ctx.fillRect(bx, by, bw * hp, bh);
  }

  ctx.restore();
}

function drawFieldBoundary() {
  if (!field.ok || fieldLock < 0.01) return;
  const h = FIELD_HALF;
  const corners = [
    fieldToScreen(-h, -h),
    fieldToScreen(h, -h),
    fieldToScreen(h, h),
    fieldToScreen(-h, h),
  ];
  const ctx = drawingContext;

  ctx.save();
  ctx.globalAlpha = fieldLock * 0.24;
  ctx.strokeStyle = 'rgba(126, 255, 190, 0.9)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.fillStyle = 'rgba(240, 255, 250, 0.9)';
  for (const p of corners) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFood() {
  if (!field.ok) return;
  const store = currentFood();
  if (!store) return;

  const ctx = drawingContext;
  const sceneAlpha = 1 - examineT * 0.75;
  ctx.save();
  ctx.globalAlpha = sceneAlpha;
  for (const id in store) {
    const f = store[id];
    if (!f || typeof f.x !== 'number') continue;

    const g = fieldGroundBasis(f.x, f.y);
    const det = g.ax.x * g.ay.y - g.ax.y * g.ay.x;
    if (Math.abs(det) < 1e-3) continue;

    ctx.save();
    ctx.transform(g.ax.x, g.ax.y, g.ay.x, g.ay.y, g.x, g.y);
    ctx.fillStyle = 'rgba(255, 196, 92, 0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, FOOD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 238, 196, 0.7)';
    ctx.lineWidth = Math.max(0.12, FOOD_RADIUS * 0.22);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawFieldDebug() {
  if (!field.ok) return;

  const ctx = drawingContext;
  const lim = FIELD_HALF;

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

  for (const o of ottos) {
    const p = fieldToScreen(o.pos.x, o.pos.y);
    const scale = fieldScreenScale(o.pos.x, o.pos.y);
    const rx = o.stats.sight * scale.x;
    const ry = o.stats.sight * scale.y;
    ctx.strokeStyle = 'rgba(126, 255, 190, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(126, 255, 190, 0.2)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx * 0.5, ry * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ----------------------------------------------------------------------- hud

function drawHud() {
  const s = constrain(width * 0.031, 10, 16);
  const found = marker.found;
  const online = shareConnected
    ? (Array.isArray(guests) ? guests.length : 0) + 1
    : 0;

  push();
  noStroke();

  // Title.
  textAlign(LEFT, TOP);
  fill(240, 252, 255, 235);
  textSize(s * 1.15);
  text('OTTO BOX', 18, 16);
  if (logoImg) {
    const logoW = textWidth('OTTO BOX');
    image(logoImg, 18 + logoW + 8, 15, s * 1.15, s * 1.15);
  }
  fill(120, 220, 255, 150);
  textSize(s * 0.72);
  text('GREEN TAPE FIELD', 18, 16 + s * 1.55);

  // Room state.
  let roomText = 'CONNECTING TO SHARED SPACE...';
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

  // The colour of this phone's colony, so "YOU" is easy to find on the table.
  const myColor = colonyColorFor(window.shareClientId);
  const roomW = textWidth(roomText);
  const swX = 18 + roomW + s * 0.9;
  const swY = 16 + s * 2.95 + s * 0.33;
  fill(myColor[0], myColor[1], myColor[2], 235);
  circle(swX, swY, s * 0.6);
  fill(myColor[0], myColor[1], myColor[2], 210);
  textSize(s * 0.55);
  text('YOU', swX + s * 0.55, 16 + s * 2.95 + 1);

  // Day progress timer.
  const dayProgress = paused ? 1 : constrain(dayClock / DAY_SECONDS, 0, 1);
  const barW = Math.min(width * 0.42, s * 18);
  const barH = s * 0.42;
  const barX = 18;
  const barY = 16 + s * 3.95;
  noStroke();
  fill(255, 255, 255, 34);
  rect(barX, barY, barW, barH, barH / 2);
  fill(paused ? color(255, 200, 110, 200) : color(126, 255, 190, 200));
  rect(barX, barY, barW * dayProgress, barH, barH / 2);
  fill(180, 220, 240, 170);
  textSize(s * 0.55);
  textAlign(LEFT, CENTER);
  text(
    paused ? 'PAUSED' : `${Math.max(0, Math.ceil(DAY_SECONDS - dayClock))}s`,
    barX + barW + 8,
    barY + barH / 2 + 1
  );

  // HUD controls, kept clear of the desktop QR in the top-right corner.
  pauseHit = null;
  autoHit = null;
  timeHit = null;
  devHit = null;
  spawnHit = null;
  storageHit = null;
  const rowH = s * 1.9;
  const rowY = 16 + s * 4.85;

  const chipW = s * 4.4;
  const chipH = rowH;
  const chipX = 18;
  const chipY = rowY;
  tuneHit = { x: chipX, y: chipY, w: chipW, h: chipH };

  noFill();
  stroke(showField ? color(126, 255, 190, 170) : color(140, 230, 255, 85));
  strokeWeight(1);
  rect(chipX, chipY, chipW, chipH, chipH / 2);
  noStroke();
  fill(showField ? color(126, 255, 190, 230) : color(150, 235, 255, 200));
  textAlign(CENTER, CENTER);
  textSize(s * 0.58);
  text('FIELD', chipX + chipW / 2, chipY + chipH / 2 + 1);

  // Auto-skip the day-end confirmation for this player.
  if (!panel.open) {
    const autoLabel = autoSkipDay ? 'AUTO ON' : 'AUTO OFF';
    textSize(s * 0.58);
    const aw = textWidth(autoLabel) + 22;
    const ax = (pauseHit ? pauseHit.x + pauseHit.w : chipX + chipW) + 12;
    const ay = chipY;
    autoHit = { x: ax, y: ay, w: aw, h: chipH };

    noFill();
    stroke(autoSkipDay ? color(126, 255, 190, 170) : color(140, 230, 255, 85));
    strokeWeight(1);
    rect(ax, ay, aw, chipH, chipH / 2);
    noStroke();
    fill(autoSkipDay ? color(126, 255, 190, 230) : color(150, 235, 255, 200));
    textAlign(CENTER, CENTER);
    text(autoLabel, ax + aw / 2, ay + chipH / 2 + 1);
  }

  // Simulation-speed toggle for testing. In a shared room it is global.
  if (!panel.open) {
    const shownScale =
      shareConnected && typeof shared.timeScale === 'number'
        ? shared.timeScale
        : timeScale;
    const timeLabel = `${shownScale}×`;
    textSize(s * 0.58);
    const tw = textWidth(timeLabel) + 22;
    const tx = (autoHit ? autoHit.x + autoHit.w : chipX + chipW) + 12;
    const ty = chipY;
    timeHit = { x: tx, y: ty, w: tw, h: chipH };

    noFill();
    stroke(shownScale > 1 ? color(255, 200, 110, 170) : color(140, 230, 255, 85));
    strokeWeight(1);
    rect(tx, ty, tw, chipH, chipH / 2);
    noStroke();
    fill(shownScale > 1 ? color(255, 200, 110, 230) : color(150, 235, 255, 200));
    textAlign(CENTER, CENTER);
    text(timeLabel, tx + tw / 2, ty + chipH / 2 + 1);
  }

  // Dev mode (solo only): spawn and edit enemy Ottos.
  if (!shareConnected && !panel.open) {
    const dy = chipY + chipH + 8;
    const devLabel = devMode ? 'DEV ON' : 'DEV OFF';
    textSize(s * 0.58);
    const dw = textWidth(devLabel) + 22;
    devHit = { x: 18, y: dy, w: dw, h: chipH };

    noFill();
    stroke(devMode ? color(255, 200, 110, 170) : color(140, 230, 255, 85));
    strokeWeight(1);
    rect(18, dy, dw, chipH, chipH / 2);
    noStroke();
    fill(devMode ? color(255, 200, 110, 230) : color(150, 235, 255, 200));
    textAlign(CENTER, CENTER);
    text(devLabel, 18 + dw / 2, dy + chipH / 2 + 1);

    if (devMode) {
      const spawnLabel = '+ SPAWN ENEMY';
      textSize(s * 0.58);
      const sw = textWidth(spawnLabel) + 24;
      spawnHit = { x: 18 + dw + 10, y: dy, w: sw, h: chipH };

      noFill();
      stroke(126, 255, 190, 140);
      strokeWeight(1);
      rect(spawnHit.x, dy, sw, chipH, chipH / 2);
      noStroke();
      fill(126, 255, 190, 220);
      textAlign(CENTER, CENTER);
      text(spawnLabel, spawnHit.x + sw / 2, dy + chipH / 2 + 1);
    }
  }

  // Stored Otto indicator. Placement is allowed while paused.
  if (storedOtto && !panel.open) {
    const dy = chipY + chipH + 8;
    const storageLabel = paused ? 'PLACE STORED' : 'STORED · PAUSE';
    textSize(s * 0.58);
    const sw = textWidth(storageLabel) + 22;
    storageHit = { x: 18, y: dy, w: sw, h: chipH };

    noFill();
    stroke(paused ? color(126, 255, 190, 170) : color(255, 200, 110, 120));
    strokeWeight(1);
    rect(18, dy, sw, chipH, chipH / 2);
    noStroke();
    fill(paused ? color(126, 255, 190, 230) : color(255, 220, 150, 200));
    textAlign(CENTER, CENTER);
    text(storageLabel, 18 + sw / 2, dy + chipH / 2 + 1);
  }

  // Hint while searching for the marker.
  if (!found) {
    textAlign(CENTER, BOTTOM);
    fill(205, 232, 245, 180);
    textSize(s * 0.8);
    text('POINT AT THE FULL GREEN TAPE SQUARE', width / 2, height - 20);
  }

  pop();
}

// --------------------------------------------------------------------- panel

function layoutPanel() {
  const w = Math.min(width - 24, 380);
  const rowH = Math.max(30, Math.min(42, height * 0.048));
  const headH = rowH * 1.15;
  const footH = rowH * 1.7;
  const h = headH + STAT_ROWS.length * rowH + footH + 10;
  const x = (width - w) / 2;
  const y = height - h - 12;

  panel.x = x;
  panel.y = y;
  panel.w = w;
  panel.h = h;
  panel.rowH = rowH;
  panel.headH = headH;
  panel.footH = footH;
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
  const lead = ottos[0];
  if (!lead) return;
  const st = lead.stats;
  const need = energyRequirementFor(st.size);
  const secsLeft = Math.max(0, Math.ceil(DAY_SECONDS - dayClock));

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

  // The daily cost is not a slider: it comes from Size alone.
  fill(140, 190, 215, 170);
  textAlign(LEFT, CENTER);
  textSize(s * 0.55);
  const footY = panel.y + panel.h - panel.footH;
  text(
    `ENERGY/DAY ${need} = SIZE × ${ENERGY_PER_SIZE}`,
    panel.x + 14,
    footY + panel.footH * 0.32
  );
  text(
    `DAY ${dayNumber} · ${secsLeft}s LEFT · ${ENERGY_STORE_MULT}× NEED = REPRODUCE`,
    panel.x + 14,
    footY + panel.footH * 0.72
  );

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
  const lead = ottos[0];
  if (!lead) return;
  const t = constrain((x - row.trackX) / row.trackW, 0, 1);
  let v = row.min + t * (row.max - row.min);
  v = Math.round(v / row.step) * row.step;
  v = Math.round(v * 1000) / 1000;
  lead.stats[row.key] = constrain(v, row.min, row.max);
}

// --------------------------------------------------------------------- input

function hitRect(r, x, y) {
  return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function castLocalYes() {
  if (!shareConnected || !paused) return;
  localReady = true;
  const p = shared.pause || { active: true, day: dayNumber, votes: {} };
  const votes = Object.assign({}, p.votes || {});
  if (shareClientId) votes[shareClientId] = true;
  const next = { active: true, day: dayNumber, votes };
  if (p.resumeAt) next.resumeAt = p.resumeAt;
  shared.pause = next;
}

function mousePressed() {
  if (hitRect(fullscreenHit, mouseX, mouseY)) {
    togglePageFullscreen();
    return false;
  }

  if (!shareConnected) {
    if (hitRect(reconnectHit, mouseX, mouseY) && shareStatus !== 'connecting') {
      shareConnect();
    }
    return false;
  }

  // The pause vote stays available even over the lobby/fail screens.
  if (paused && hitRect(yesHit, mouseX, mouseY)) {
    castLocalYes();
    return false;
  }

  if (lobbyChoiceActive && storedOtto) {
    if (hitRect(storedPlaceHit, mouseX, mouseY)) {
      lobbyChoiceActive = false;
      allocationActive = false;
      placementActive = true;
      placementMode = 'stored';
    } else if (hitRect(scratchHit, mouseX, mouseY)) {
      startFromScratch();
    }
    return false;
  }

  if (allocationActive) {
    for (const h of colorHits) {
      if (hitRect(h, mouseX, mouseY)) {
        teamColorIndex = h.index;
        return false;
      }
    }
    for (const h of allocationHits) {
      if (hitRect(h, mouseX, mouseY)) {
        adjustAllocation(h.key, h.dir);
        return false;
      }
    }
    if (
      allocationConfirmHit &&
      allocationConfirmHit.enabled &&
      hitRect(allocationConfirmHit, mouseX, mouseY)
    ) {
      pendingStats = statsFromAllocation(allocationPoints);
      pendingMaxHp = maxHpFromAllocation(allocationPoints);
      allocationActive = false;
      placementActive = true;
      placementMode = 'new';
    }
    return false;
  }

  if (placementActive) {
    if (field.ok && fieldLock > 0.05) {
      const tap = screenToField(mouseX, mouseY);
      if (!tap) return false;
      const spot = clampToField(
        tap.x,
        tap.y,
        Math.max(0.8, 1.5 * (pendingStats ? pendingStats.size : 1))
      );

      if (placementMode === 'stored') {
        placeStoredOtto(spot.x, spot.y);
      } else {
        const placed = createOtto(
          pendingStats,
          spot.x,
          spot.y,
          pendingMaxHp,
          pendingAssetIndex
        );
        placed.spawn = 0;
        ottos.push(placed);
        colonySpawned = true;
        placementActive = false;
        placementMode = 'new';
        allocationActive = false;
        fieldEntered = true;
        shared.started = true;
        if (window.me) me.colorIndex = teamColorIndex;
        syncMe();
      }
    }
    return false;
  }

  if (colonyLost) {
    if (hitRect(failRetryHit, mouseX, mouseY)) resetAllocation();
    return false;
  }

  if (storedOtto && hitRect(storageHit, mouseX, mouseY)) {
    if (paused) {
      lobbyChoiceActive = false;
      allocationActive = false;
      placementActive = true;
      placementMode = 'stored';
    }
    return false;
  }

  // While examining, the store button benches the Otto; any other click closes.
  if (examineClone) {
    if (storeHit && hitRect(storeHit, mouseX, mouseY)) {
      if (examineKind === 'local') storeOtto(examineRef);
      return false;
    }
    if (devMode && !shareConnected) {
      for (const h of devHits) {
        if (hitRect(h, mouseX, mouseY)) {
          adjustDevStat(h.key, h.dir);
          return false;
        }
      }
    }
    dismissExamine();
    return false;
  }

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
    showField = !showField;
    return false;
  }

  if (hitRect(timeHit, mouseX, mouseY)) {
    const current =
      shareConnected && typeof shared.timeScale === 'number'
        ? shared.timeScale
        : timeScale;
    const next = current === 1 ? 10 : current === 10 ? 100 : 1;
    timeScale = next;
    if (shareConnected) shared.timeScale = next;
    return false;
  }

  if (hitRect(autoHit, mouseX, mouseY)) {
    autoSkipDay = !autoSkipDay;
    if (autoSkipDay && paused) castLocalYes();
    return false;
  }

  if (hitRect(yesHit, mouseX, mouseY)) {
    castLocalYes();
    return false;
  }

  // Clicking an Otto opens the examine copy and stats card.
  if (field.ok && fieldLock > 0.05) {
    for (const o of ottos) {
      if (o.dead) continue;
      if (ottoHit(o, mouseX, mouseY)) {
        startExamine(o);
        return false;
      }
    }

    if (devMode && !shareConnected) {
      for (const r of remote.values()) {
        if (!r.dev || r.hp <= 0) continue;
        if (devOttoHit(r, mouseX, mouseY)) {
          startExamine(r, 'dev');
          return false;
        }
      }
    }
  }

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

function viewportSize() {
  const vv = window.visualViewport;
  return {
    w: Math.round(vv && vv.width ? vv.width : windowWidth),
    h: Math.round(vv && vv.height ? vv.height : windowHeight),
  };
}

function fitCanvasToViewport() {
  const v = viewportSize();
  if (v.w !== width || v.h !== height) resizeCanvas(v.w, v.h);
}

function resetUiHits() {
  joinHit = null;
  tuneHit = null;
  fullscreenHit = null;
  pauseHit = null;
  yesHit = null;
  autoHit = null;
  timeHit = null;
}

function windowResized() {
  fitCanvasToViewport();
  resetUiHits();
}

function fullscreenRequest() {
  const root = document.documentElement;
  return (
    root.requestFullscreen ||
    root.webkitRequestFullscreen ||
    root.mozRequestFullScreen ||
    root.msRequestFullscreen
  );
}

function isPageFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

function fullscreenAvailable() {
  const enabled =
    document.fullscreenEnabled !== undefined
      ? document.fullscreenEnabled
      : document.webkitFullscreenEnabled;
  return !!fullscreenRequest() && enabled !== false;
}

function fullscreenChanged() {
  resetUiHits();
  fitCanvasToViewport();
}

function togglePageFullscreen() {
  const exit =
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.mozCancelFullScreen ||
    document.msExitFullscreen;

  if (isPageFullscreen()) {
    if (!exit) return;
    try {
      const result = exit.call(document);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (e) {}
    return;
  }

  const request = fullscreenRequest();
  if (!request) return;
  try {
    const result = request.call(document.documentElement, {
      navigationUI: 'hide',
    });
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (e) {}
}

function drawFullscreenButton() {
  fullscreenHit = null;
  if (
    lobbyChoiceActive ||
    placementActive ||
    panel.open ||
    !fullscreenAvailable()
  ) {
    return;
  }

  const s = constrain(width * 0.031, 10, 16);
  const size = Math.max(44, s * 2.6);
  const x = width - size - 16;
  const y = height - size - 16;

  // During creation, only show the button when it fits below the panel.
  if (allocationActive) {
    const panelBottom = (height + Math.min(height - 20, 600)) / 2;
    if (height - panelBottom < size + 24) return;
  }
  fullscreenHit = { x, y, w: size, h: size };
  const cx = x + size / 2;
  const cy = y + size / 2;

  push();
  noStroke();
  fill(4, 10, 16, 190);
  circle(cx, cy, size);
  noFill();
  stroke(140, 230, 255, 85);
  strokeWeight(1);
  circle(cx, cy, size);

  const inset = size * 0.3;
  const arm = size * 0.16;
  stroke(180, 240, 255, 235);
  strokeWeight(1.7);
  const corner = (px, py, sx, sy) => {
    line(px, py, px + sx * arm, py);
    line(px, py, px, py + sy * arm);
  };

  if (!isPageFullscreen()) {
    corner(x + inset, y + inset, 1, 1);
    corner(x + size - inset, y + inset, -1, 1);
    corner(x + size - inset, y + size - inset, -1, -1);
    corner(x + inset, y + size - inset, 1, -1);
  } else {
    corner(x + inset + arm, y + inset + arm, -1, -1);
    corner(x + size - inset - arm, y + inset + arm, 1, -1);
    corner(x + size - inset - arm, y + size - inset - arm, 1, 1);
    corner(x + inset + arm, y + size - inset - arm, -1, 1);
  }
  pop();
}

// Phones keep browser chrome (address bar, tab strip) unless the page is opened
// as an installed app. Ask for real fullscreen on the first tap where the
// browser supports it; iOS home-screen mode uses the manifest instead.
function enableMobileFullscreen() {
  if (!window.isMobile) return;

  const standalone =
    (window.matchMedia &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches)) ||
    window.navigator.standalone === true;
  if (standalone) return;

  const root = document.documentElement;
  const request =
    root.requestFullscreen ||
    root.webkitRequestFullscreen ||
    root.mozRequestFullScreen ||
    root.msRequestFullscreen;
  const supported =
    document.fullscreenEnabled !== undefined
      ? document.fullscreenEnabled
      : document.webkitFullscreenEnabled;
  if (!request || !supported) return;

  let asked = false;
  const enter = () => {
    if (asked || document.fullscreenElement || document.webkitFullscreenElement) {
      return;
    }
    asked = true;
    try {
      const result = request.call(root, { navigationUI: 'hide' });
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          asked = false;
        });
      }
    } catch (e) {
      asked = false;
    }
  };

  const opts = { once: true, passive: true, capture: true };
  window.addEventListener('pointerup', enter, opts);
  window.addEventListener('touchend', enter, opts);
}
