// Get canvas and context
const canvas = document.getElementById('tankGame');
const ctx = canvas.getContext('2d');

// Constants
const TANK_MAX_PIXELS = 800;
const TANK_DESTROY_THRESHOLD = 0.6;
const WINNING_SCORE = 3;
const GRAVITY = 0.5;
const GROUND_HEIGHT = 150;

// Game state
let tank1, tank2;
let projectile = null;
let animationId = null;

let charge = { tank1: 0, tank2: 0 };
let cooldown = { tank1: 0, tank2: 0 };

let currentPlayer;
let gameOver = false;
let waitingForProjectileToEnd = false;

let score = { tank1: 0, tank2: 0 };

let trenchWidth = 80;
let trenchX, trenchLeft, trenchRight;

let groundCanvas = document.createElement('canvas');
groundCanvas.width = canvas.width;
groundCanvas.height = canvas.height;
let groundCtx = groundCanvas.getContext('2d');

const modal = document.getElementById('game-modal');
const openBtn = document.getElementById('launch-game');
const closeBtn = document.getElementById('close-game');
const originalHeroTitle = document.getElementById('hero-title')?.textContent;

// Sounds
const sounds = {};

async function loadSounds() {
  const response = await fetch('sounds.json');
  const soundMap = await response.json();

  for (const [key, path] of Object.entries(soundMap)) {
    const audio = new Audio(path);
    if (key === 'backgroundMusic') {
      audio.loop = true;
      audio.volume = 0.5;
    }
    sounds[key] = audio;
  }
}

function initGround() {
  groundCtx.clearRect(0, 0, groundCanvas.width, groundCanvas.height);
  groundCtx.fillStyle = '#3c3c3c';
  groundCtx.fillRect(0, canvas.height - GROUND_HEIGHT, canvas.width, GROUND_HEIGHT);
}

function drawGround() {
  ctx.drawImage(groundCanvas, 0, 0);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillRect(trenchLeft, 0, trenchWidth, canvas.height);
}

function craterGround(impactX, impactY, radius = 30) {
  const imageData = groundCtx.getImageData(0, 0, groundCanvas.width, groundCanvas.height);
  const data = imageData.data;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = Math.floor(impactX + dx);
      const y = Math.floor(impactY + dy);
      if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;

      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        const index = (y * canvas.width + x) * 4;
        data[index + 3] = 0;
      }
    }
  }

  groundCtx.putImageData(imageData, 0, 0);

  if (sounds.groundHit) sounds.groundHit.play();
}

function isPointOnGround(x, y) {
  const pixel = groundCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
  return pixel[3] > 0;
}

function drawProjectile() {
  if (projectile) {
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'red';
    ctx.fill();
  }
}

function updateTankPosition(tank) {
  if (tank.exploded) return;
  for (let y = tank.y - 20; y < canvas.height; y++) {
    const pixel = groundCtx.getImageData(Math.floor(tank.x), y, 1, 1).data;
    if (pixel[3] > 0) {
      tank.y = y - 1;
      return;
    }
  }
  tank.y += GRAVITY;
}

function updateProjectile() {
  if (!projectile) return;
  projectile.x += projectile.vx;
  projectile.y += projectile.vy;
  projectile.vy += 0.2;

  const px = projectile.x;
  const py = projectile.y;
  const isOut = px < 0 || px > canvas.width || py > canvas.height;

  const hitTank = projectile.from === 'tank1' ? tank2 : tank1;
  const dx = px - hitTank.x;
  const dy = py - hitTank.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const hitTankDirect = dist < 25 && !hitTank.exploded;

  if (hitTankDirect) {
    applyCraterDamage(hitTank, px, py);
  }

  if (isOut || isPointOnGround(px, py) || hitTankDirect) {
    craterGround(px, py);
    projectile = null;
    waitingForProjectileToEnd = false;
    if (!gameOver) {
      currentPlayer = currentPlayer === 'tank1' ? 'tank2' : 'tank1';
      updateTurnIndicator();
    }
  }
}

function updateTurnIndicator() {
  const turnEl = document.getElementById('turn-indicator');
  turnEl.textContent = currentPlayer === 'tank1' ? "Tank 1's Turn" : "Tank 2's Turn";
}

function updateScoreDisplay() {
  document.getElementById('score-tank1').textContent = `Tank 1: ${score.tank1}`;
  document.getElementById('score-tank2').textContent = `Tank 2: ${score.tank2}`;
}

function createTank(x, y, angle, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 20;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 40, 20);

  return {
    x,
    y,
    angle,
    color,
    canvas,
    ctx,
    pixelLoss: 0,
    exploded: false
  };
}

function applyCraterDamage(tank, impactX, impactY, radius = 12) {
  let localX = impactX - (tank.x - 20);
  let localY = impactY - (tank.y - 20);

  localX = Math.max(0, Math.min(39, localX));
  localY = Math.max(0, Math.min(19, localY));

  const imageData = tank.ctx.getImageData(0, 0, 40, 20);
  const data = imageData.data;
  let pixelsDestroyed = 0;

  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 40; x++) {
      const dx = x - localX;
      const dy = y - localY;
      if (Math.sqrt(dx * dx + dy * dy) <= radius) {
        const index = (y * 40 + x) * 4;
        if (data[index + 3] > 0) {
          data[index + 3] = 0;
          pixelsDestroyed++;
        }
      }
    }
  }

  tank.ctx.putImageData(imageData, 0, 0);
  tank.pixelLoss += pixelsDestroyed;

  const maxLoss = TANK_MAX_PIXELS * TANK_DESTROY_THRESHOLD;
  if (tank.pixelLoss >= maxLoss) explodeTank(tank);
}

function explodeTank(tank) {
  tank.exploded = true;
  tank.ctx.clearRect(0, 0, 40, 20);

  if (sounds.explosion) sounds.explosion.play();

  const winner = tank === tank1 ? 'tank2' : 'tank1';
  score[winner]++;
  updateScoreDisplay();

  if (score[winner] >= WINNING_SCORE) {
    gameOver = true;
    document.getElementById('victory-display').textContent = `${winner === 'tank1' ? 'Tank 1' : 'Tank 2'} WINS THE MATCH!`;
    if (sounds.victory) sounds.victory.play();
  } else {
    setTimeout(() => {
      resetRound();
      waitingForProjectileToEnd = false;
      gameOver = false;
    }, 2000);
  }
}

function fireProjectile(fromTank, charge = 1) {
  const angleRad = (fromTank.angle * Math.PI) / 180;
  const minPower = 6;
  const maxPower = 16;
  const power = minPower + (charge / 100) * (maxPower - minPower);

  projectile = {
    x: fromTank.x,
    y: fromTank.y,
    vx: Math.cos(angleRad) * power,
    vy: -Math.sin(angleRad) * power,
    from: fromTank === tank1 ? 'tank1' : 'tank2'
  };

  if (sounds.fire) sounds.fire.play();

  waitingForProjectileToEnd = true;
}

function decideFirstTurn() {
  currentPlayer = Math.random() < 0.5 ? 'tank1' : 'tank2';
  updateTurnIndicator();
}

function resetRound() {
  initGround();
  tank1 = createTank(100, canvas.height - GROUND_HEIGHT - 10, 45, 'blue');
  tank2 = createTank(700, canvas.height - GROUND_HEIGHT - 10, 135, 'green');
  projectile = null;
  charge = { tank1: 0, tank2: 0 };
  cooldown = { tank1: 0, tank2: 0 };
  decideFirstTurn();
  updateScoreDisplay();
  document.getElementById('victory-display').textContent = '';
  waitingForProjectileToEnd = false;
  gameOver = false;
}

function drawTank(tank) {
  if (tank.exploded) return;
  ctx.drawImage(tank.canvas, tank.x - 20, tank.y - 20);
  const barrelLength = 30;
  const angleRad = (tank.angle * Math.PI) / 180;
  const bx = tank.x + Math.cos(angleRad) * barrelLength;
  const by = tank.y - Math.sin(angleRad) * barrelLength;
  ctx.strokeStyle = tank.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(tank.x, tank.y);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGround();

  if (charge.tank1 > 0) charge.tank1 = Math.min(charge.tank1 + 1, 100);
  if (charge.tank2 > 0) charge.tank2 = Math.min(charge.tank2 + 1, 100);
  if (cooldown.tank1 > 0) cooldown.tank1--;
  if (cooldown.tank2 > 0) cooldown.tank2--;

  updateTankPosition(tank1);
  updateTankPosition(tank2);

  if (!gameOver && !waitingForProjectileToEnd) {
    if (currentPlayer === 'tank1' && !tank1.exploded) {
      if (keys['a']) tank1.x -= 3;
      if (keys['d']) tank1.x += 3;
      if (keys['w']) tank1.angle = Math.min(tank1.angle + 1, 90);
      if (keys['s']) tank1.angle = Math.max(tank1.angle - 1, 0);
    }

    if (currentPlayer === 'tank2' && !tank2.exploded) {
      if (keys['arrowleft']) tank2.x -= 3;
      if (keys['arrowright']) tank2.x += 3;
      if (keys['arrowup']) tank2.angle = Math.max(tank2.angle - 1, 90);
      if (keys['arrowdown']) tank2.angle = Math.min(tank2.angle + 1, 180);
    }
  }

  drawTank(tank1);
  drawTank(tank2);
  drawProjectile();
  updateProjectile();

  animationId = requestAnimationFrame(gameLoop);
}

const keys = {};

document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  keys[key] = true;

  if ([" ", "enter", "arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s"].includes(key)) {
    e.preventDefault();
  }

  if (gameOver) return;

  if (currentPlayer === 'tank1' && key === ' ' && charge.tank1 === 0 && cooldown.tank1 === 0) {
    charge.tank1 = 1;
  }

  if (currentPlayer === 'tank2' && key === 'enter' && charge.tank2 === 0 && cooldown.tank2 === 0) {
    charge.tank2 = 1;
  }
});

document.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  keys[key] = false;

  if (gameOver) return;

  if (currentPlayer === 'tank1' && key === ' ' && charge.tank1 > 0) {
    if (cooldown.tank1 === 0 && !waitingForProjectileToEnd) {
      fireProjectile(tank1, charge.tank1);
      cooldown.tank1 = 60;
    }
    charge.tank1 = 0;
  }

  if (currentPlayer === 'tank2' && key === 'enter' && charge.tank2 > 0) {
    if (cooldown.tank2 === 0 && !waitingForProjectileToEnd) {
      fireProjectile(tank2, charge.tank2);
      cooldown.tank2 = 60;
    }
    charge.tank2 = 0;
  }
});

openBtn.addEventListener('click', async () => {
  await loadSounds();
  if (sounds.backgroundMusic) sounds.backgroundMusic.play();

  modal.classList.remove('game-hidden');
  modal.classList.add('show');
  trenchX = canvas.width / 2;
  trenchLeft = trenchX - trenchWidth / 2;
  trenchRight = trenchX + trenchWidth / 2;
  score = { tank1: 0, tank2: 0 };
  gameOver = false;
  resetRound();
  updateScoreDisplay();
  gameLoop();

  openBtn.style.display = 'none';
  const heroTitle = document.getElementById('hero-title');
  if (heroTitle) heroTitle.textContent = 'May the best Tank go unexploded';
});

closeBtn.addEventListener('click', () => {
  modal.classList.remove('show');
  modal.classList.add('game-hidden');
  cancelAnimationFrame(animationId);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  projectile = null;

  if (sounds.backgroundMusic) sounds.backgroundMusic.pause();

  const heroTitle = document.getElementById('hero-title');
  if (heroTitle && originalHeroTitle) heroTitle.textContent = originalHeroTitle;
  openBtn.style.display = 'inline-block';
});

