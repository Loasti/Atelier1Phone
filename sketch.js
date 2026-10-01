const RADIUS = 26;
const GRAVITY_SCALE = 0.42;
const FRICTION = 0.992;
const BOUNCE = 0.82;
const MAX_SPEED = 14;
const TRAIL_MAX = 40;

let pos;
let vel;
let trail;

function setup() {
  createCanvas(windowWidth, windowHeight);
  lockGestures();
  enableSensorTap('Tap to enable tilt controls');
  reset();
}

function reset() {
  pos = createVector(width / 2, height / 2);
  vel = createVector(0, 0);
  trail = [];
}

function draw() {
  background(18, 14, 34);

  if (!window.sensorsEnabled) {
    noStroke();
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(20);
    text('Tap the screen to start', width / 2, height / 2);
    return;
  }

  const tiltX = constrain(rotationY || 0, -45, 45);
  const tiltY = constrain(rotationX || 0, -45, 45);

  vel.x += tiltX * GRAVITY_SCALE;
  vel.y += tiltY * GRAVITY_SCALE;
  vel.mult(FRICTION);
  vel.limit(MAX_SPEED);

  pos.add(vel);
  bounce();

  trail.push(pos.copy());
  if (trail.length > TRAIL_MAX) trail.shift();

  drawTrail();
  drawBall(tiltX, tiltY);
}

function bounce() {
  if (pos.x - RADIUS < 0) {
    pos.x = RADIUS;
    vel.x = Math.abs(vel.x) * BOUNCE;
  } else if (pos.x + RADIUS > width) {
    pos.x = width - RADIUS;
    vel.x = -Math.abs(vel.x) * BOUNCE;
  }

  if (pos.y - RADIUS < 0) {
    pos.y = RADIUS;
    vel.y = Math.abs(vel.y) * BOUNCE;
  } else if (pos.y + RADIUS > height) {
    pos.y = height - RADIUS;
    vel.y = -Math.abs(vel.y) * BOUNCE;
  }
}

function drawTrail() {
  noFill();
  for (let i = 0; i < trail.length; i++) {
    const t = (i + 1) / trail.length;
    stroke(150, 90, 255, t * 140);
    strokeWeight(RADIUS * 1.6 * t);
    const p = trail[i];
    point(p.x, p.y);
  }
}

function drawBall(tiltX, tiltY) {
  const speed = vel.mag();
  noStroke();
  fill(255);
  circle(pos.x, pos.y, RADIUS * 2);

  fill(200, 170, 255, 140);
  textAlign(CENTER, CENTER);
  textSize(14);
  text(
    'tiltX ' + tiltX.toFixed(1) + '  tiltY ' + tiltY.toFixed(1),
    width / 2,
    34
  );
  text('speed ' + speed.toFixed(2), width / 2, 56);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  pos.x = constrain(pos.x, RADIUS, width - RADIUS);
  pos.y = constrain(pos.y, RADIUS, height - RADIUS);
}

function mousePressed() {
  return false;
}