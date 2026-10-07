/* Chill Valley — a cozy little farming game. No build step, no dependencies. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ constants
  const TILE = 32, COLS = 30, ROWS = 20;
  const W = COLS * TILE, H = ROWS * TILE;
  const RES = 2;                       // backing-store scale for crisp shapes
  const DAY_START = 6 * 60;            // 6:00 AM
  const PASS_OUT = 26 * 60;            // 2:00 AM the next morning
  const MINUTES_PER_SEC = 6;           // a full day is ~3.3 real minutes
  const MAX_ENERGY = 100;
  const CAN_SIZE = 20;
  const SAVE_KEY = 'chill-valley-save-v1';

  const T = { GRASS: 0, WATER: 1, PATH: 2, SOIL: 3, TREE: 4, BUILDING: 5, FENCE: 6, ROCK: 7 };
  const SOLID = new Set([T.WATER, T.TREE, T.BUILDING, T.FENCE, T.ROCK]);
  const DOOR = { x: 4, y: 3 };
  const SHOP = { x0: 23, x1: 26, y: 3 };
  const SPAWN = { x: 4 * TILE + 16, y: 4 * TILE + 16 };

  const TOOLS = ['hoe', 'water', 'seeds', 'basket'];
  const TOOL_NAMES = { hoe: 'Hoe', water: 'Can', seeds: 'Seeds', basket: 'Basket' };
  const COST = { hoe: 2, water: 1, seeds: 0, basket: 0 };

  const CROPS = {
    turnip:     { name: 'Turnip',     seed: 20,  sell: 45,  days: 3, regrow: 0 },
    carrot:     { name: 'Carrot',     seed: 35,  sell: 80,  days: 4, regrow: 0 },
    strawberry: { name: 'Strawberry', seed: 60,  sell: 110, days: 5, regrow: 2 },
    pumpkin:    { name: 'Pumpkin',    seed: 100, sell: 320, days: 7, regrow: 0 },
  };
  const CROP_KEYS = Object.keys(CROPS);
  const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];

  // ------------------------------------------------------------------ canvases
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = W * RES; canvas.height = H * RES;
  ctx.setTransform(RES, 0, 0, RES, 0, 0);

  const bg = document.createElement('canvas');
  bg.width = W * RES; bg.height = H * RES;
  const bgx = bg.getContext('2d');
  bgx.setTransform(RES, 0, 0, RES, 0, 0);

  const light = document.createElement('canvas');
  light.width = W * RES; light.height = H * RES;
  const lx = light.getContext('2d');
  lx.setTransform(RES, 0, 0, RES, 0, 0);

  // ------------------------------------------------------------------ sprites (PixelLab)
  // Each sprite falls back to the procedural drawing below until (or unless) it loads.
  const SPRITE_FILES = {
    tree: 'assets/tree.png', rock: 'assets/rock.png', house: 'assets/house.png', market: 'assets/market.png',
    interior: 'assets/interior.png',
    crop_turnip: 'assets/crops/turnip.png', crop_carrot: 'assets/crops/carrot.png',
    crop_strawberry: 'assets/crops/strawberry.png', crop_pumpkin: 'assets/crops/pumpkin.png',
  };
  // Farm Boy: 8 facing directions, each with a 6-frame walk cycle
  const FACINGS = ['south', 'north', 'east', 'west', 'south-east', 'south-west', 'north-east', 'north-west'];
  const WALK_FRAMES = 6;
  for (const f of FACINGS) {
    SPRITE_FILES[`farmer_${f}`] = `assets/farmer/${f}.png`;
    for (let i = 0; i < WALK_FRAMES; i++) SPRITE_FILES[`walk_${f}_${i}`] = `assets/farmer/walk/${f}/${i}.png`;
  }
  const SPR = {};
  let spritesPending = Object.keys(SPRITE_FILES).length;
  for (const [name, src] of Object.entries(SPRITE_FILES)) {
    const img = new Image();
    img.onload = img.onerror = () => { if (--spritesPending === 0) refreshHotbar(); };
    img.src = src;
    SPR[name] = img;
  }
  const spr = name => { const img = SPR[name]; return img && img.complete && img.naturalWidth ? img : null; };
  const FACING_OF_DIR = { down: 'south', up: 'north', left: 'west', right: 'east' };
  // Sprite placement: the art's base line sits on the building's bottom edge (y = 4 tiles).
  const HOUSE_POS = { x: 2 * TILE, y: 4 * TILE - 110 };
  const MARKET_POS = { x: 23 * TILE, y: 4 * TILE - 102 };
  const WINDOWS = [[36, 69, 18, 13], [106, 69, 18, 13]];   // glass rects inside house.png

  // House interior (assets/interior.png, 400x256), drawn at 2x so furniture matches the farmer's scale.
  // All rects are [x0, y0, x1, y1] in the art's own pixels; the player's feet must stay in `walk`
  // and out of `solids`.
  const ROOM = {
    ox: (W - 800) / 2, oy: (H - 512) / 2, scale: 2,
    walk: [[36, 84, 364, 202], [224, 200, 272, 250]],          // floor + front doorway
    solids: [
      [40, 60, 135, 172],   // bed
      [136, 70, 164, 110],  // nightstand by the bed
      [163, 40, 207, 112],  // wardrobe
      [212, 45, 246, 92],   // potted plant
      [258, 40, 314, 112],  // fireplace
      [324, 35, 364, 96],   // bookshelf
      [208, 100, 248, 175], // sofa
      [270, 120, 304, 172], // coffee table
      [326, 98, 368, 150],  // armchair
      [139, 152, 175, 205], // lamp table
      [338, 170, 368, 205], // corner plant
    ],
    bed: [40, 60, 135, 172],
    exitFeetY: 240,                       // walking past this in the doorway leaves the house
    entry: { x: 248, y: 228 - 9 },        // player.y is 9px above the feet
    wake: { x: 152, y: 132 - 9 },         // beside the bed
    lights: [[286, 92, 70], [150, 76, 40], [157, 160, 40]],   // fireplace, two lamps
  };
  ctx.imageSmoothingEnabled = false;

  // ------------------------------------------------------------------ helpers
  function hash(x, y, s = 0) {
    let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(s + 1, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const key = (x, y) => y * COLS + x;

  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  function ellipse(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }
  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
    c.fill();
  }
  function leaf(c, x, y, rx, ry, rot, col) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.fillStyle = col; ellipse(c, 0, -ry, rx, ry);
    c.restore();
  }

  // ------------------------------------------------------------------ world
  const map = Array.from({ length: ROWS }, () => new Array(COLS).fill(T.GRASS));
  const soil = new Map(); // key -> { watered, crop: { type, age } | null }

  function isProtected(x, y) {
    return inRect(x, y, 1, 1, 7, 7)      // house yard
      || inRect(x, y, 1, 5, 28, 7)       // main path
      || inRect(x, y, 6, 7, 21, 18)      // farm
      || inRect(x, y, 21, 1, 28, 8)      // market
      || inRect(x, y, 20, 9, 28, 18);    // pond
  }

  function buildMap() {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) map[y][x] = T.GRASS;

    // pond
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const dx = (x + 0.5 - 25) / 3.6, dy = (y + 0.5 - 14.5) / 2.8;
      if (dx * dx + dy * dy < 1) map[y][x] = T.WATER;
    }
    // paths
    for (let x = 3; x <= 26; x++) map[6][x] = T.PATH;
    for (let y = 4; y <= 6; y++) { map[y][4] = T.PATH; map[y][24] = T.PATH; map[y][25] = T.PATH; }
    map[7][13] = map[7][14] = T.PATH;
    // buildings
    for (let y = 1; y <= 3; y++) for (let x = 2; x <= 6; x++) map[y][x] = T.BUILDING;
    for (let y = 2; y <= 3; y++) for (let x = 23; x <= 26; x++) map[y][x] = T.BUILDING;
    // farm fence with a gate at the top
    for (let x = 7; x <= 20; x++) { if (x !== 13 && x !== 14) map[8][x] = T.FENCE; map[17][x] = T.FENCE; }
    for (let y = 8; y <= 17; y++) { map[y][7] = T.FENCE; map[y][20] = T.FENCE; }
    // border woods + scattered trees and rocks
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) { map[y][x] = T.TREE; continue; }
      if (map[y][x] !== T.GRASS || isProtected(x, y)) continue;
      const r = hash(x, y, 7);
      if (r < 0.2) map[y][x] = T.TREE;
      else if (r < 0.25) map[y][x] = T.ROCK;
    }
  }

  const tileAt = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS) ? T.TREE : map[y][x];

  // ------------------------------------------------------------------ state
  const S = {
    screen: 'title', day: 1, minutes: DAY_START, gold: 100, energy: MAX_ENERGY, water: CAN_SIZE,
    rain: false, tool: 0, seedSel: 0, seeds: {}, crops: {}, earned: 0, time: 0, scene: 'outside',
  };
  const player = { x: SPAWN.x, y: SPAWN.y, dir: 'down', moving: false, anim: 0, actT: 0 };
  const keys = new Set();
  const particles = [];
  let fade = null;

  function newGame() {
    buildMap();
    soil.clear();
    Object.assign(S, { day: 1, minutes: DAY_START, gold: 100, energy: MAX_ENERGY, water: CAN_SIZE,
      rain: false, tool: 0, seedSel: 0, earned: 0, scene: 'outside' });
    S.seeds = Object.fromEntries(CROP_KEYS.map(k => [k, k === 'turnip' ? 6 : 0]));
    S.crops = Object.fromEntries(CROP_KEYS.map(k => [k, 0]));
    Object.assign(player, { x: SPAWN.x, y: SPAWN.y, dir: 'down', facing: null });
    paintBackground();
  }

  // ------------------------------------------------------------------ save / load
  function hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  }
  function save() {
    const data = {
      v: 1, day: S.day, minutes: S.minutes, gold: S.gold, energy: S.energy, water: S.water, rain: S.rain,
      tool: S.tool, seedSel: S.seedSel, seeds: S.seeds, crops: S.crops, earned: S.earned, scene: S.scene,
      soil: [...soil].map(([k, p]) => [k % COLS, Math.floor(k / COLS), p.watered, p.crop?.type ?? null, p.crop?.age ?? 0]),
      player: { x: player.x, y: player.y, dir: player.dir },
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch { return false; }
  }
  function load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return false; }
    if (!data || data.v !== 1) return false;
    newGame();
    for (const f of ['day', 'minutes', 'gold', 'energy', 'water', 'rain', 'tool', 'seedSel', 'earned', 'scene']) {
      if (data[f] !== undefined) S[f] = data[f];
    }
    for (const k of CROP_KEYS) {
      S.seeds[k] = data.seeds?.[k] ?? 0;
      S.crops[k] = data.crops?.[k] ?? 0;
    }
    for (const [x, y, watered, type, age] of data.soil || []) {
      if (tileAt(x, y) !== T.GRASS) continue;
      map[y][x] = T.SOIL;
      soil.set(key(x, y), { watered, crop: type && CROPS[type] ? { type, age } : null });
    }
    if (data.player) Object.assign(player, data.player);
    return true;
  }

  // ------------------------------------------------------------------ audio
  const audio = { ctx: null, master: null, music: null, musicOn: true, step: 0 };
  const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];
  const CHORDS = [[130.81, 196.0, 329.63], [110.0, 164.81, 261.63], [87.31, 130.81, 220.0], [98.0, 146.83, 246.94]];

  function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
    audio.ctx = new AC();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.5;
    audio.master.connect(audio.ctx.destination);
    audio.music = audio.ctx.createGain();
    audio.music.gain.value = 0.4;
    audio.music.connect(audio.master);
    setInterval(musicTick, 420);
  }
  function tone(freq, start, dur, type = 'triangle', vol = 0.2, dest = audio.master, attack = 0.015) {
    const c = audio.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(dest);
    o.start(start); o.stop(start + dur + 0.05);
  }
  function musicTick() {
    if (!audio.musicOn || !audio.ctx || document.hidden || S.screen !== 'play') return;
    const t = audio.ctx.currentTime + 0.05;
    if (audio.step % 12 === 0) {
      for (const f of CHORDS[(audio.step / 12) % CHORDS.length]) tone(f, t, 5.4, 'sine', 0.045, audio.music, 1.2);
    }
    if (Math.random() < 0.42) {
      const night = S.minutes > 20 * 60;
      const f = SCALE[Math.floor(Math.random() * SCALE.length)] * (night ? 0.5 : 1);
      tone(f, t, 1.8, 'triangle', 0.05, audio.music);
    }
    audio.step++;
  }
  const SFX = {
    till:    [[150, 0, .12, 'square', .05], [90, .04, .14, 'triangle', .12]],
    water:   [[880, 0, .14, 'sine', .08], [1320, .05, .16, 'sine', .05]],
    plant:   [[523, 0, .15, 'triangle', .1], [659, .07, .2, 'triangle', .1]],
    harvest: [[659, 0, .18, 'triangle', .12], [784, .07, .2, 'triangle', .12], [1047, .14, .35, 'triangle', .12]],
    coin:    [[988, 0, .1, 'square', .05], [1319, .08, .3, 'square', .05]],
    refill:  [[392, 0, .25, 'sine', .1], [523, .1, .3, 'sine', .1]],
    nope:    [[196, 0, .15, 'triangle', .12], [165, .08, .18, 'triangle', .1]],
    sleep:   [[523, 0, .5, 'sine', .08], [392, .25, .6, 'sine', .08], [262, .5, 1.2, 'sine', .08]],
  };
  function sfx(name) {
    if (!audio.ctx) return;
    const t = audio.ctx.currentTime + 0.01;
    for (const [f, d, len, type, vol] of SFX[name]) tone(f, t + d, len, type, vol);
  }
  function toggleMusic() {
    audio.musicOn = !audio.musicOn;
    document.getElementById('musicBtn').classList.toggle('off', !audio.musicOn);
    toast(audio.musicOn ? '🎵 Music on' : '🔇 Music off');
  }

  // ------------------------------------------------------------------ drawing: ground
  function drawGrass(c, x, y) {
    const px = x * TILE, py = y * TILE, v = hash(x, y, 1);
    c.fillStyle = v < 0.33 ? '#8fcf5a' : v < 0.66 ? '#88c954' : '#94d35f';
    c.fillRect(px, py, TILE, TILE);
    c.strokeStyle = 'rgba(60,120,40,.35)'; c.lineWidth = 1.2; c.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const bx = px + 4 + hash(x, y, 20 + i) * 24, by = py + 7 + hash(x, y, 30 + i) * 22;
      c.beginPath(); c.moveTo(bx, by); c.lineTo(bx - 1.5, by - 4); c.moveTo(bx + 2, by); c.lineTo(bx + 3, by - 3.5); c.stroke();
    }
    if (hash(x, y, 11) < 0.07) {
      const fx = px + 8 + hash(x, y, 13) * 16, fy = py + 8 + hash(x, y, 14) * 16;
      c.fillStyle = ['#fff6f0', '#ffd1e0', '#ffe680', '#c9b8ff'][Math.floor(hash(x, y, 12) * 4)];
      for (let a = 0; a < 5; a++) circle(c, fx + Math.cos(a * 1.2566) * 2.3, fy + Math.sin(a * 1.2566) * 2.3, 1.7);
      c.fillStyle = '#f2b134'; circle(c, fx, fy, 1.3);
    }
  }
  function drawPath(c, x, y) {
    const px = x * TILE, py = y * TILE;
    c.fillStyle = '#dcc08a'; c.fillRect(px, py, TILE, TILE);
    c.fillStyle = '#c9a96e';
    for (let i = 0; i < 3; i++) circle(c, px + 4 + hash(x, y, 40 + i) * 24, py + 4 + hash(x, y, 50 + i) * 24, 1.2 + hash(x, y, 60 + i) * 1.4);
  }
  function paintBackground() {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (map[y][x] === T.PATH) drawPath(bgx, x, y); else drawGrass(bgx, x, y);
    }
  }
  function drawWater(c, x, y, t) {
    const px = x * TILE, py = y * TILE;
    c.fillStyle = '#5bb4e5'; c.fillRect(px, py, TILE, TILE);
    const o = Math.sin(t * 1.5 + x * 0.9 + y * 1.3) * 4;
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.5; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(px + 6 + o, py + 10); c.lineTo(px + 14 + o, py + 10);
    c.moveTo(px + 16 - o, py + 22); c.lineTo(px + 24 - o, py + 22);
    c.stroke();
    c.fillStyle = '#e9d8a6';
    const up = tileAt(x, y - 1) !== T.WATER, dn = tileAt(x, y + 1) !== T.WATER;
    const lf = tileAt(x - 1, y) !== T.WATER, rt = tileAt(x + 1, y) !== T.WATER;
    if (up) c.fillRect(px, py, TILE, 4);
    if (dn) c.fillRect(px, py + TILE - 4, TILE, 4);
    if (lf) c.fillRect(px, py, 4, TILE);
    if (rt) c.fillRect(px + TILE - 4, py, 4, TILE);
    if (!up && !dn && !lf && !rt && hash(x, y, 5) < 0.25) {
      const lpx = px + 16 + Math.sin(t * 0.6 + x) * 1.5, lpy = py + 16;
      c.fillStyle = '#4e9a4a'; ellipse(c, lpx, lpy, 7, 5);
      c.fillStyle = '#5bb4e5'; c.beginPath(); c.moveTo(lpx, lpy); c.lineTo(lpx + 7, lpy - 2); c.lineTo(lpx + 7, lpy + 2); c.fill();
      if (hash(x, y, 6) < 0.5) { c.fillStyle = '#ffc6dd'; circle(c, lpx - 2, lpy - 1, 2.2); }
    }
  }
  function drawSoil(c, x, y, plot, t) {
    const px = x * TILE, py = y * TILE;
    c.fillStyle = plot.watered ? '#6b4428' : '#9a6a40';
    rrect(c, px + 1, py + 1, TILE - 2, TILE - 2, 4);
    c.fillStyle = plot.watered ? 'rgba(0,0,0,.18)' : 'rgba(80,45,20,.35)';
    for (let i = 0; i < 3; i++) c.fillRect(px + 5, py + 7 + i * 8, TILE - 10, 2);
    if (plot.crop) drawCrop(c, plot.crop, px, py, t);
  }

  // ------------------------------------------------------------------ drawing: crops & icons
  // Produce drawn around (0,0), roughly 24px tall.
  function drawProduce(c, type) {
    const img = spr(`crop_${type}`);
    if (img) { c.imageSmoothingEnabled = false; c.drawImage(img, -16, -16, 32, 32); return; }
    if (type === 'turnip') {
      leaf(c, -3, -5, 2.4, 6, -0.45, '#5fae4a'); leaf(c, 3, -5, 2.4, 6, 0.45, '#5fae4a'); leaf(c, 0, -5, 2.4, 6.5, 0, '#6cbf55');
      c.fillStyle = '#f6eef8'; circle(c, 0, 3, 8);
      c.fillStyle = '#a557b5'; c.beginPath(); c.arc(0, 3, 8, Math.PI, 0); c.closePath(); c.fill();
      c.strokeStyle = '#d9c8de'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, 11); c.lineTo(0, 14); c.stroke();
    } else if (type === 'carrot') {
      leaf(c, -2, -5, 2, 6, -0.4, '#4fa34a'); leaf(c, 2, -5, 2, 6, 0.4, '#4fa34a'); leaf(c, 0, -5, 2, 7, 0, '#5db955');
      c.fillStyle = '#f28c28';
      c.beginPath(); c.moveTo(-6, -5); c.quadraticCurveTo(0, -8, 6, -5); c.lineTo(0, 13); c.closePath(); c.fill();
      c.strokeStyle = '#d9661a'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-3, 0); c.lineTo(0, 0); c.moveTo(1, 4); c.lineTo(3, 4); c.moveTo(-2, 7); c.lineTo(0, 7); c.stroke();
    } else if (type === 'strawberry') {
      c.fillStyle = '#e8394d';
      c.beginPath(); c.moveTo(0, 11);
      c.bezierCurveTo(-11, 3, -9, -7, 0, -5); c.bezierCurveTo(9, -7, 11, 3, 0, 11); c.fill();
      c.fillStyle = '#ffe07a';
      for (const [sx, sy] of [[-4, 0], [0, 2], [4, 0], [-2, 5], [2, 5], [0, -2]]) circle(c, sx, sy, 0.9);
      for (let i = 0; i < 5; i++) leaf(c, 0, -5, 1.8, 4, (i - 2) * 0.55, '#3f8f3f');
    } else if (type === 'pumpkin') {
      c.fillStyle = '#f39a2b'; ellipse(c, 0, 3, 11, 8);
      c.strokeStyle = '#c96f12'; c.lineWidth = 1.3;
      c.beginPath(); c.ellipse(0, 3, 4.5, 8, 0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(0, -5); c.lineTo(0, 11); c.stroke();
      c.fillStyle = '#6b4a2a'; c.fillRect(-1.5, -9, 3, 5);
      leaf(c, 3, -6, 2.5, 3.5, 1.1, '#4b9a3c');
    }
  }
  function drawCrop(c, crop, px, py, t) {
    const def = CROPS[crop.type], p = crop.age / def.days;
    const cx = px + 16, base = py + 25;
    const sway = Math.sin(t * 1.8 + px * 0.05 + py * 0.03) * 0.08;
    if (crop.age === 0) {
      c.fillStyle = '#3e2615';
      circle(c, cx - 5, base - 6, 1.5); circle(c, cx + 2, base - 9, 1.5); circle(c, cx + 5, base - 3, 1.5);
      return;
    }
    if (p < 0.5) {
      c.strokeStyle = '#5fae4a'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(cx, base); c.lineTo(cx, base - 5); c.stroke();
      leaf(c, cx, base - 5, 2.2, 4, -0.9 + sway, '#7ccf5a');
      leaf(c, cx, base - 5, 2.2, 4, 0.9 + sway, '#7ccf5a');
      return;
    }
    if (p < 1) {
      c.strokeStyle = '#4f9f3e'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx, base); c.lineTo(cx, base - 10); c.stroke();
      for (let i = 0; i < 4; i++) leaf(c, cx, base - 3 - i * 2.5, 2.6, 5.5, (i % 2 ? 1 : -1) * (0.7 + i * 0.1) + sway, i % 2 ? '#5fb84a' : '#6cc456');
      return;
    }
    // mature: a little greenery + the produce, gently bobbing
    leaf(c, cx - 2, base, 3, 7, -1.2 + sway, '#4f9f3e');
    leaf(c, cx + 2, base, 3, 7, 1.2 + sway, '#4f9f3e');
    const img = spr(`crop_${crop.type}`);
    if (img) {
      c.drawImage(img, px, py - 3 + Math.round(Math.sin(t * 3 + px) * 0.8));   // 1:1 keeps pixels crisp
    } else {
      c.save();
      c.translate(cx, base - 9 + Math.sin(t * 3 + px) * 0.8);
      c.scale(0.75, 0.75);
      drawProduce(c, crop.type);
      c.restore();
    }
    // sparkle so ripe crops stand out
    const sp = (Math.sin(t * 4 + px * 0.3) + 1) / 2;
    if (sp > 0.7) { c.fillStyle = `rgba(255,255,255,${(sp - 0.7) * 3})`; star(c, px + 26, py + 6, 3); }
  }
  function star(c, x, y, r) {
    c.beginPath();
    c.moveTo(x, y - r); c.lineTo(x + r * 0.3, y - r * 0.3); c.lineTo(x + r, y); c.lineTo(x + r * 0.3, y + r * 0.3);
    c.lineTo(x, y + r); c.lineTo(x - r * 0.3, y + r * 0.3); c.lineTo(x - r, y); c.lineTo(x - r * 0.3, y - r * 0.3);
    c.closePath(); c.fill();
  }

  // Icons drawn in a 32x32 box.
  function drawIcon(c, kind) {
    const [what, arg] = kind.split(':');
    c.lineCap = 'round';
    if (what === 'hoe') {
      c.strokeStyle = '#8b5a2b'; c.lineWidth = 3.5;
      c.beginPath(); c.moveTo(7, 27); c.lineTo(22, 8); c.stroke();
      c.fillStyle = '#9aa4ad';
      c.beginPath(); c.moveTo(17, 5); c.lineTo(29, 7); c.lineTo(27, 14); c.lineTo(21, 11); c.closePath(); c.fill();
    } else if (what === 'water') {
      c.strokeStyle = '#3a78b8'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(14, 12, 6, Math.PI, 0); c.stroke();
      c.beginPath(); c.moveTo(21, 19); c.lineTo(29, 11); c.stroke();
      c.fillStyle = '#4f8fd6'; rrect(c, 6, 12, 16, 15, 3);
      c.fillStyle = '#8fc3f0'; c.fillRect(8, 15, 12, 2.5);
    } else if (what === 'basket') {
      c.strokeStyle = '#8b5a2b'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(16, 15, 9, Math.PI, 0); c.stroke();
      c.fillStyle = '#c98b4a';
      c.beginPath(); c.moveTo(4, 14); c.lineTo(28, 14); c.lineTo(24, 28); c.lineTo(8, 28); c.closePath(); c.fill();
      c.strokeStyle = '#a06a35'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(6, 19); c.lineTo(26, 19); c.moveTo(7, 24); c.lineTo(25, 24); c.stroke();
    } else if (what === 'packet' || what === 'seeds') {
      const type = arg || CROP_KEYS[S.seedSel];
      c.fillStyle = '#b08a5a'; rrect(c, 6, 3, 20, 26, 3);
      c.fillStyle = '#f7e9cc'; rrect(c, 7.5, 4.5, 17, 23, 2);
      c.save(); c.translate(16, 15); c.scale(0.55, 0.55); drawProduce(c, type); c.restore();
      c.fillStyle = '#b08a5a'; c.fillRect(9, 24, 14, 2);
    } else if (what === 'crop') {
      c.save(); c.translate(16, 16); drawProduce(c, arg); c.restore();
    }
  }
  function paintIconCanvas(cv, kind) {
    const c = cv.getContext('2d');
    c.setTransform(cv.width / 32, 0, 0, cv.height / 32, 0, 0);
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, 32, 32);
    drawIcon(c, kind);
  }

  // ------------------------------------------------------------------ drawing: objects
  function drawTree(c, x, y, t) {
    const px = x * TILE, py = y * TILE, v = hash(x, y, 9);
    const sway = Math.sin(t * 0.8 + x * 0.7 + y) * 1.2;
    c.fillStyle = 'rgba(0,0,0,.18)'; ellipse(c, px + 16, py + 28, 13, 4.5);
    const img = spr('tree');
    if (img) {
      // trunk base (art y=58) on the tile's bottom; mirror half the trees for variety
      if (v < 0.5) c.drawImage(img, px - 16, py - 28);
      else { c.save(); c.translate(px + 48, py - 28); c.scale(-1, 1); c.drawImage(img, 0, 0); c.restore(); }
      return;
    }
    c.fillStyle = '#7a5132'; rrect(c, px + 12, py + 12, 8, 17, 2);
    const g = v < 0.5 ? ['#3f8f4a', '#4fa858', '#63bd66'] : ['#3d8a5c', '#4aa36a', '#5fbb78'];
    c.fillStyle = g[0]; circle(c, px + 16 + sway, py + 4, 15);
    c.fillStyle = g[1]; circle(c, px + 12 + sway, py, 11); circle(c, px + 21 + sway, py + 2, 10);
    c.fillStyle = g[2]; circle(c, px + 11 + sway, py - 4, 5.5);
    if (v > 0.78) { c.fillStyle = '#e8524f'; circle(c, px + 9 + sway, py + 7, 2.2); circle(c, px + 22 + sway, py + 3, 2.2); circle(c, px + 17 + sway, py + 12, 2.2); }
  }
  function drawRock(c, x, y) {
    const px = x * TILE, py = y * TILE;
    c.fillStyle = 'rgba(0,0,0,.15)'; ellipse(c, px + 16, py + 26, 12, 4);
    const img = spr('rock');
    if (img) { c.drawImage(img, px, py + 2); return; }
    c.fillStyle = '#8f949a'; ellipse(c, px + 16, py + 20, 12, 9);
    c.fillStyle = '#b5bac0'; ellipse(c, px + 13, py + 17, 6, 4);
  }
  function drawFence(c, x, y) {
    const px = x * TILE, py = y * TILE;
    c.fillStyle = '#b07d4a';
    if (tileAt(x + 1, y) === T.FENCE) { c.fillRect(px + 16, py + 12, TILE, 3); c.fillRect(px + 16, py + 21, TILE, 3); }
    if (tileAt(x, y + 1) === T.FENCE) c.fillRect(px + 14.5, py + 16, 3, TILE);
    c.fillStyle = '#8f5f33'; rrect(c, px + 12, py + 6, 8, 22, 2);
    c.fillStyle = '#c99561'; c.fillRect(px + 12, py + 6, 8, 3);
  }
  function drawHouse(c, night) {
    const hx = 2 * TILE, hy = TILE, w = 5 * TILE, h = 3 * TILE;
    const img = spr('house');
    if (img) {
      c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(HOUSE_POS.x + 18, 4 * TILE - 4, 126, 7);
      c.drawImage(img, HOUSE_POS.x, HOUSE_POS.y);
      if (night) {
        c.fillStyle = 'rgba(255,214,120,.85)';
        for (const [wx, wy, ww, wh] of WINDOWS) c.fillRect(HOUSE_POS.x + wx, HOUSE_POS.y + wy, ww, wh);
      }
      return;
    }
    c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(hx + 4, hy + h - 4, w - 8, 8);
    // chimney + smoke
    c.fillStyle = '#9b4a3a'; c.fillRect(hx + w - 46, hy - 18, 14, 30);
    c.fillStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 3; i++) {
      const k = (S.time * 0.4 + i / 3) % 1;
      circle(c, hx + w - 39 + Math.sin(k * 6 + i) * 4, hy - 22 - k * 30, 3 + k * 4);
    }
    // walls
    c.fillStyle = '#ecd7ad'; c.fillRect(hx + 6, hy + 28, w - 12, h - 28);
    c.fillStyle = 'rgba(150,110,60,.18)';
    for (let i = 0; i < 6; i++) c.fillRect(hx + 6, hy + 36 + i * 10, w - 12, 1.5);
    // roof
    c.fillStyle = '#c0504d';
    c.beginPath(); c.moveTo(hx - 6, hy + 34); c.lineTo(hx + w / 2, hy - 20); c.lineTo(hx + w + 6, hy + 34); c.closePath(); c.fill();
    c.fillStyle = '#a8403d'; c.fillRect(hx - 6, hy + 30, w + 12, 6);
    c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 1.5;
    for (let i = 1; i < 4; i++) {
      const yy = hy - 20 + i * 13, half = (yy - (hy - 20)) / 54 * (w / 2 + 6);
      c.beginPath(); c.moveTo(hx + w / 2 - half, yy); c.lineTo(hx + w / 2 + half, yy); c.stroke();
    }
    // windows
    for (const wx of [hx + 22, hx + w - 44]) {
      c.fillStyle = '#7a4a2a'; c.fillRect(wx - 2, hy + 50, 26, 22);
      c.fillStyle = night ? '#ffd77a' : '#a7d8f0'; c.fillRect(wx, hy + 52, 22, 18);
      c.fillStyle = '#7a4a2a'; c.fillRect(wx + 10, hy + 52, 2, 18); c.fillRect(wx, hy + 60, 22, 2);
      c.fillStyle = '#e88aa0'; c.fillRect(wx - 2, hy + 72, 26, 4);
    }
    // door
    const dx = DOOR.x * TILE + 6;
    c.fillStyle = '#6e4226'; rrect(c, dx - 2, hy + h - 42, 24, 42, 4);
    c.fillStyle = '#8b5a33'; rrect(c, dx, hy + h - 40, 20, 40, 3);
    c.fillStyle = '#f2c14e'; circle(c, dx + 15, hy + h - 20, 1.8);
  }
  function drawShop(c, night) {
    const sx = SHOP.x0 * TILE, sy = 2 * TILE, w = 4 * TILE, h = 2 * TILE;
    const img = spr('market');
    if (img) {
      c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(MARKET_POS.x + 14, 4 * TILE - 4, 98, 7);
      c.drawImage(img, MARKET_POS.x, MARKET_POS.y);
      return;
    }
    c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(sx + 2, sy + h - 4, w - 4, 8);
    c.fillStyle = '#8b5a2b'; c.fillRect(sx + 4, sy - 14, 6, h + 14); c.fillRect(sx + w - 10, sy - 14, 6, h + 14);
    c.fillStyle = '#c8955c'; c.fillRect(sx + 10, sy, w - 20, 30);
    c.fillStyle = 'rgba(0,0,0,.08)'; for (let i = 0; i < 3; i++) c.fillRect(sx + 10, sy + 8 + i * 9, w - 20, 1.5);
    // counter
    c.fillStyle = '#a06a3a'; c.fillRect(sx, sy + 30, w, h - 30);
    c.fillStyle = '#c58a4f'; c.fillRect(sx - 2, sy + 27, w + 4, 6);
    c.fillStyle = 'rgba(0,0,0,.12)'; for (let i = 1; i < 4; i++) c.fillRect(sx + i * 32, sy + 33, 2, h - 33);
    // produce on display
    CROP_KEYS.forEach((k, i) => { c.save(); c.translate(sx + 18 + i * 31, sy + 21); c.scale(0.5, 0.5); drawProduce(c, k); c.restore(); });
    // awning
    const stripes = 8, sw = (w + 8) / stripes;
    for (let i = 0; i < stripes; i++) {
      c.fillStyle = i % 2 ? '#fff4e6' : '#e85d5d';
      c.fillRect(sx - 4 + i * sw, sy - 24, sw, 18);
      c.beginPath(); c.arc(sx - 4 + i * sw + sw / 2, sy - 6, sw / 2, 0, Math.PI); c.fill();
    }
    // sign
    c.fillStyle = '#7a4a2a'; rrect(c, sx + w / 2 - 30, sy - 44, 60, 17, 4);
    c.fillStyle = '#fff4e6'; c.font = '600 10px Fredoka, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('MARKET', sx + w / 2, sy - 35);
    // lanterns
    for (const lxp of [sx + 7, sx + w - 7]) {
      c.fillStyle = '#5a3a22'; c.fillRect(lxp - 0.5, sy - 4, 1, 6);
      c.fillStyle = night ? '#ffd65a' : '#e7b85a'; rrect(c, lxp - 4, sy + 2, 8, 10, 2);
    }
  }
  function drawPlayer(c, t) {
    const { x, y, dir } = player;
    const feet = y + 9;
    const walk = player.moving ? Math.sin(player.anim * 14) : 0;
    const bob = player.moving ? -Math.abs(walk) * 1.5 : Math.sin(t * 2) * 0.4;
    c.fillStyle = 'rgba(0,0,0,.2)'; ellipse(c, x, feet, 9, 3.5);
    if (dir === 'up') drawHeldTool(c);
    const facing = player.facing || FACING_OF_DIR[dir];
    const frame = Math.floor(player.anim * 10) % WALK_FRAMES;
    const img = (player.moving && spr(`walk_${facing}_${frame}`)) || spr(`farmer_${facing}`);
    if (img) {
      // art is 68x68 with feet at y≈57
      c.drawImage(img, Math.round(x) - 34, Math.round(feet) - 57);
      if (dir !== 'up') drawHeldTool(c);
      return;
    }
    // legs + boots
    c.fillStyle = '#4a3b6b';
    c.fillRect(x - 5, feet - 9 + (walk > 0 ? -1.5 : 0), 4, 8);
    c.fillRect(x + 1, feet - 9 + (walk < 0 ? -1.5 : 0), 4, 8);
    c.fillStyle = '#5a3a22';
    c.fillRect(x - 5.5, feet - 2.5 + (walk > 0 ? -1.5 : 0), 5, 3);
    c.fillRect(x + 0.5, feet - 2.5 + (walk < 0 ? -1.5 : 0), 5, 3);
    // body
    const by = feet - 21 + bob;
    c.fillStyle = '#f6efe0'; rrect(c, x - 7, by, 14, 13, 4);
    c.fillStyle = '#4f7cc4'; rrect(c, x - 6, by + 5, 12, 9, 3);
    if (dir !== 'up') { c.fillRect(x - 5, by + 1, 2, 5); c.fillRect(x + 3, by + 1, 2, 5); }
    // arms
    c.fillStyle = '#f2c49b';
    if (dir === 'left' || dir === 'right') circle(c, x + (dir === 'left' ? -1 : 1) * 2 + walk * 2, by + 8, 2.6);
    else { circle(c, x - 8, by + 7 + walk, 2.4); circle(c, x + 8, by + 7 - walk, 2.4); }
    // head
    const hy = by - 6;
    c.fillStyle = '#f2c49b'; circle(c, x, hy, 7);
    c.fillStyle = '#7a4b2a';
    if (dir === 'up') circle(c, x, hy + 1, 6.8);
    else if (dir === 'left') ellipse(c, x + 3, hy, 4, 6);
    else if (dir === 'right') ellipse(c, x - 3, hy, 4, 6);
    c.fillStyle = '#2d2420';
    if (dir === 'down') { circle(c, x - 2.6, hy + 1, 1.1); circle(c, x + 2.6, hy + 1, 1.1); }
    if (dir === 'left') circle(c, x - 3.5, hy + 1, 1.1);
    if (dir === 'right') circle(c, x + 3.5, hy + 1, 1.1);
    if (dir !== 'up') {
      c.fillStyle = 'rgba(240,120,120,.45)';
      if (dir !== 'right') circle(c, x - 4.5, hy + 3, 1.6);
      if (dir !== 'left') circle(c, x + 4.5, hy + 3, 1.6);
    }
    // straw hat
    c.fillStyle = '#e9c46a'; ellipse(c, x, hy - 4, 11, 3.5);
    c.fillStyle = '#f2d27e'; rrect(c, x - 6, hy - 11, 12, 7, 3);
    c.fillStyle = '#d9534f'; c.fillRect(x - 6, hy - 6.5, 12, 2);
    if (dir !== 'up') drawHeldTool(c);
  }
  function drawHeldTool(c) {
    if (player.actT <= 0) return;
    const off = { down: [9, -7], up: [-8, -14], left: [-11, -11], right: [11, -11] }[player.dir];
    const swing = (1 - player.actT / 0.3) * 1.3 - 0.7;
    c.save();
    c.translate(player.x + off[0], player.y + 9 + off[1]);
    if (player.dir === 'left') c.scale(-1, 1);
    c.rotate(swing);
    c.scale(0.55, 0.55);
    c.translate(-16, -16);
    drawIcon(c, TOOLS[S.tool]);
    c.restore();
  }

  // ------------------------------------------------------------------ ambience
  const petals = Array.from({ length: 10 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 6.28, v: 12 + Math.random() * 14 }));
  const flies = Array.from({ length: 22 }, () => ({ x: Math.random() * W, y: Math.random() * H, a: Math.random() * 6.28, ph: Math.random() * 6.28 }));
  const drops = Array.from({ length: 170 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 380 + Math.random() * 200 }));

  function darkness() {
    const h = S.minutes / 60;
    if (h < 7) return 0.35 * (7 - h);
    if (h <= 17) return 0;
    if (h <= 20) return (h - 17) / 3 * 0.6;
    return Math.min(0.7, 0.6 + (h - 20) * 0.025);
  }

  function updateAmbience(dt) {
    const wind = S.rain ? 0 : 1;
    for (const p of petals) {
      p.x += p.v * dt * wind; p.y += (Math.sin(S.time + p.s) * 10 + p.v * 0.35) * dt * wind;
      if (p.x > W + 10) p.x = -10; if (p.y > H + 10) p.y = -10;
    }
    for (const f of flies) {
      f.a += (Math.random() - 0.5) * 3 * dt;
      f.x = (f.x + Math.cos(f.a) * 14 * dt + W) % W;
      f.y = (f.y + Math.sin(f.a) * 14 * dt + H) % H;
    }
    if (S.rain) for (const d of drops) {
      d.y += d.v * dt; d.x -= d.v * 0.15 * dt;
      if (d.y > H) { d.y = -10; d.x = Math.random() * (W + 60); }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life >= p.max) particles.splice(i, 1);
    }
  }
  function burst(x, y, color, n, { g = 180, size = 2.4, kind = 'dot', spread = 60, up = 60 } = {}) {
    for (let i = 0; i < n; i++) {
      particles.push({ x, y, vx: (Math.random() - 0.5) * spread, vy: -Math.random() * up - 15, g, life: 0, max: 0.45 + Math.random() * 0.4, color, size, kind });
    }
  }

  // ------------------------------------------------------------------ gameplay
  function target() {
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[player.dir];
    return { tx: Math.floor(player.x / TILE) + d[0], ty: Math.floor(player.y / TILE) + d[1] };
  }
  const isDoor = (x, y) => x === DOOR.x && y === DOOR.y;
  const isShop = (x, y) => y === SHOP.y && x >= SHOP.x0 && x <= SHOP.x1;
  const isMature = crop => crop.age >= CROPS[crop.type].days;

  const inRoomRect = (x, y, [x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  function roomCollides(nx, ny) {
    const feet = ny + 9;
    const pts = [[nx - 7, feet - 3], [nx + 7, feet - 3], [nx - 7, feet + 2], [nx + 7, feet + 2]];
    return pts.some(([px, py]) => !ROOM.walk.some(r => inRoomRect(px, py, r)) || ROOM.solids.some(r => inRoomRect(px, py, r)));
  }
  function nearBed() {
    const [x0, y0, x1, y1] = ROOM.bed;
    return inRoomRect(player.x, player.y + 9, [x0 - 12, y0 - 12, x1 + 12, y1 + 12]);
  }

  function collides(nx, ny) {
    if (S.scene === 'inside') return roomCollides(nx, ny);
    const pts = [[nx - 9, ny - 6], [nx + 9, ny - 6], [nx - 9, ny + 8], [nx + 9, ny + 8]];
    return pts.some(([px, py]) => SOLID.has(tileAt(Math.floor(px / TILE), Math.floor(py / TILE))));
  }

  function movePlayer(dt) {
    let dx = 0, dy = 0;
    if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
    if (keys.has('arrowright') || keys.has('d')) dx += 1;
    if (keys.has('arrowup') || keys.has('w')) dy -= 1;
    if (keys.has('arrowdown') || keys.has('s')) dy += 1;
    player.moving = !!(dx || dy);
    if (!player.moving) return;
    const horiz = dx < 0 ? 'left' : 'right', vert = dy < 0 ? 'up' : 'down';
    if (!dy) player.dir = horiz;
    else if (!dx) player.dir = vert;
    else if (player.dir !== horiz && player.dir !== vert) player.dir = horiz;
    player.facing = dy && dx ? `${dy < 0 ? 'north' : 'south'}-${dx < 0 ? 'west' : 'east'}` : FACING_OF_DIR[player.dir];
    const len = Math.hypot(dx, dy);
    // indoors is drawn at 2x, so halve the speed in room pixels to keep the same on-screen pace
    const speed = (S.energy > 0 ? 115 : 70) / (S.scene === 'inside' ? ROOM.scale : 1);
    const sx = dx / len * speed * dt, sy = dy / len * speed * dt;
    if (!collides(player.x + sx, player.y)) player.x += sx;
    if (!collides(player.x, player.y + sy)) player.y += sy;
    player.anim += dt;
    if (S.scene === 'inside' && player.y + 9 > ROOM.exitFeetY) exitHouse();
  }

  function sceneFade(onMid) {
    fade = { t: 0, dur: 0.7, midDone: false, text: '', onMid, onEnd() {} };
  }
  function enterHouse() {
    if (!spr('interior')) return openSleep();   // no interior art: just offer the bed
    sfx('refill');
    sceneFade(() => {
      S.scene = 'inside';
      Object.assign(player, { x: ROOM.entry.x, y: ROOM.entry.y, dir: 'up', facing: null, moving: false });
    });
  }
  function exitHouse() {
    keys.clear();
    sceneFade(() => {
      S.scene = 'outside';
      Object.assign(player, { x: SPAWN.x, y: SPAWN.y, dir: 'down', facing: null, moving: false });
    });
  }

  function spend(tool) {
    if (S.energy < COST[tool]) { toast('😮‍💨 Too tired… time for bed'); sfx('nope'); return false; }
    S.energy -= COST[tool];
    return true;
  }

  function act() {
    if (S.scene === 'inside') {
      if (nearBed()) openSleep();
      return;
    }
    const { tx, ty } = target();
    if (isDoor(tx, ty)) return enterHouse();
    if (isShop(tx, ty)) return openShop();

    const tile = tileAt(tx, ty);
    const plot = soil.get(key(tx, ty));
    const cx = tx * TILE + 16, cy = ty * TILE + 16;
    player.actT = 0.3;

    if (plot?.crop && isMature(plot.crop)) return harvest(plot, cx, cy);

    const tool = TOOLS[S.tool];
    if (tool === 'hoe') {
      if (tile !== T.GRASS) return;
      if (!spend('hoe')) return;
      map[ty][tx] = T.SOIL;
      soil.set(key(tx, ty), { watered: S.rain, crop: null });
      burst(cx, cy + 4, '#8a5a35', 8);
      sfx('till');
    } else if (tool === 'water') {
      if (tile === T.WATER) {
        S.water = CAN_SIZE; sfx('refill');
        burst(cx, cy, '#bfe6ff', 10, { g: 220 });
        return toast('💧 Watering can refilled');
      }
      if (!plot || plot.watered) return;
      if (S.water <= 0) { sfx('nope'); return toast('🪣 Can is empty — refill at the pond'); }
      if (!spend('water')) return;
      S.water--; plot.watered = true;
      burst(cx, cy, '#8fd3ff', 9, { g: 260, spread: 40 });
      sfx('water');
    } else if (tool === 'seeds') {
      if (!plot || plot.crop) return;
      const type = CROP_KEYS[S.seedSel];
      if (S.seeds[type] <= 0) { sfx('nope'); return toast(`🌱 No ${CROPS[type].name} seeds — visit the market (Q to switch)`); }
      S.seeds[type]--;
      plot.crop = { type, age: 0 };
      burst(cx, cy + 4, '#6b4428', 5, { up: 30 });
      sfx('plant');
      refreshHotbar();
    } else if (tool === 'basket') {
      if (plot?.crop) toast(`${CROPS[plot.crop.type].name} needs ${CROPS[plot.crop.type].days - plot.crop.age} more day(s)`);
    }
  }

  function harvest(plot, cx, cy) {
    const def = CROPS[plot.crop.type];
    S.crops[plot.crop.type]++;
    if (def.regrow) plot.crop.age = def.days - def.regrow;
    else plot.crop = null;
    burst(cx, cy, '#fff3a6', 12, { kind: 'star', g: 60, up: 70, size: 3 });
    sfx('harvest');
    toast(`🧺 +1 ${def.name}`);
  }

  function startNewDay(passedOut) {
    S.day++;
    for (const p of soil.values()) {
      if (p.crop && p.watered && !isMature(p.crop)) p.crop.age++;
      p.watered = false;
    }
    S.rain = Math.random() < 0.22;
    if (S.rain) for (const p of soil.values()) p.watered = true;
    S.minutes = DAY_START;
    S.energy = passedOut ? 60 : MAX_ENERGY;
    if (spr('interior')) {   // wake up beside the bed
      S.scene = 'inside';
      Object.assign(player, { x: ROOM.wake.x, y: ROOM.wake.y, dir: 'down', facing: null, moving: false });
    } else {
      S.scene = 'outside';
      Object.assign(player, { x: SPAWN.x, y: SPAWN.y, dir: 'down', facing: null, moving: false });
    }
    save();
  }

  function sleep(passedOut = false) {
    closeModal();
    sfx('sleep');
    let lost = 0;
    if (passedOut) { lost = Math.floor(S.gold * 0.1); S.gold -= lost; }
    fade = {
      t: 0, dur: 2.6, midDone: false, text: '',
      onMid() {
        startNewDay(passedOut);
        this.text = `Day ${S.day}`;
      },
      onEnd() {
        if (passedOut) toast(`😵 You passed out… someone carried you home (−${lost}g)`);
        toast(S.rain ? '🌧 Rainy day — every plot is watered' : '☀️ A sunny new day');
        toast('💾 Game saved');
      },
    };
  }

  function update(dt) {
    S.time += dt;
    updateAmbience(dt);
    if (S.screen !== 'play') return;
    if (player.actT > 0) player.actT = Math.max(0, player.actT - dt);
    if (fade) {
      fade.t += dt;
      if (!fade.midDone && fade.t >= fade.dur / 2) { fade.midDone = true; fade.onMid(); }
      if (fade.t >= fade.dur) { const f = fade; fade = null; f.onEnd(); }
      return;
    }
    if (modal.open) return;
    movePlayer(dt);
    S.minutes += dt * MINUTES_PER_SEC;
    if (S.minutes >= PASS_OUT) sleep(true);
  }

  // ------------------------------------------------------------------ render
  function render() {
    const t = S.time;
    if (S.screen === 'play' && S.scene === 'inside') return renderInside(t);
    const night = darkness() > 0.2;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);

    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const tile = map[y][x];
      if (tile === T.WATER) drawWater(ctx, x, y, t);
      else if (tile === T.SOIL) drawSoil(ctx, x, y, soil.get(key(x, y)), t);
    }

    if (S.screen === 'play' && !fade && !modal.open) {
      const { tx, ty } = target();
      if (tx > 0 && ty > 0 && tx < COLS - 1 && ty < ROWS - 1) {
        ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]); ctx.lineDashOffset = -t * 12;
        ctx.strokeRect(tx * TILE + 2, ty * TILE + 2, TILE - 4, TILE - 4);
        ctx.setLineDash([]);
      }
    }

    // y-sorted objects
    const objs = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const tile = map[y][x];
      if (tile === T.TREE) objs.push([y * TILE + TILE - 4, () => drawTree(ctx, x, y, t)]);
      else if (tile === T.ROCK) objs.push([y * TILE + TILE - 6, () => drawRock(ctx, x, y)]);
      else if (tile === T.FENCE) objs.push([y * TILE + TILE - 6, () => drawFence(ctx, x, y)]);
    }
    objs.push([4 * TILE, () => drawHouse(ctx, night)]);
    objs.push([4 * TILE, () => drawShop(ctx, night)]);
    if (S.screen === 'play') objs.push([player.y + 9, () => drawPlayer(ctx, t)]);
    objs.sort((a, b) => a[0] - b[0]);
    for (const [, draw] of objs) draw();

    // particles
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      if (p.kind === 'star') star(ctx, p.x, p.y, p.size); else circle(ctx, p.x, p.y, p.size);
    }
    ctx.globalAlpha = 1;

    // petals by day
    if (!S.rain && darkness() < 0.3) {
      ctx.fillStyle = 'rgba(255,205,225,.85)';
      for (const p of petals) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(S.time * 2 + p.s);
        ellipse(ctx, 0, 0, 2.6, 1.5); ctx.restore();
      }
    }

    // rain
    if (S.rain) {
      ctx.fillStyle = 'rgba(70,90,120,.12)'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(200,225,255,.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const d of drops) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y + 10); }
      ctx.stroke();
    }

    drawLighting();

    // fireflies after dark
    const dk = darkness();
    if (dk > 0.25 && !S.rain) {
      for (const f of flies) {
        const glow = (0.5 + 0.5 * Math.sin(t * 3 + f.ph)) * Math.min(1, (dk - 0.25) * 3);
        ctx.fillStyle = `rgba(255,240,140,${0.25 * glow})`; circle(ctx, f.x, f.y, 6);
        ctx.fillStyle = `rgba(255,250,200,${glow})`; circle(ctx, f.x, f.y, 1.6);
      }
    }

    drawFade();
  }

  function renderInside(t) {
    const img = spr('interior');
    const { ox, oy, scale } = ROOM;
    ctx.fillStyle = '#3b5b16';   // the grass at the art's edges
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    if (img) ctx.drawImage(img, 0, 0);
    // fire flicker
    const flick = 0.12 + 0.06 * Math.sin(t * 9) + 0.04 * Math.sin(t * 23);
    ctx.fillStyle = `rgba(255,170,60,${flick})`; ellipse(ctx, 286, 86, 18, 10);
    drawPlayer(ctx, t);
    ctx.restore();

    // evening: dim the room, keep the fire and lamps glowing
    const dk = darkness() * 0.6;
    if (dk > 0.01) {
      lx.globalCompositeOperation = 'source-over';
      lx.clearRect(0, 0, W, H);
      lx.fillStyle = `rgba(14,18,52,${dk})`; lx.fillRect(0, 0, W, H);
      lx.globalCompositeOperation = 'destination-out';
      const lights = ROOM.lights.map(([x, y, r]) => [ox + x * scale, oy + y * scale, r * scale]);
      for (const [x, y, r] of lights) {
        const g = lx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(0,0,0,.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        lx.fillStyle = g; lx.beginPath(); lx.arc(x, y, r, 0, Math.PI * 2); lx.fill();
      }
      ctx.drawImage(light, 0, 0, W, H);
      for (const [x, y, r] of lights) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,190,100,${0.35 * dk})`); g.addColorStop(1, 'rgba(255,190,100,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    drawFade();
  }

  function drawFade() {
    if (fade) {
      const half = fade.dur / 2;
      const a = clamp(fade.t < half ? fade.t / half * 1.6 : (fade.dur - fade.t) / half * 1.6, 0, 1);
      ctx.fillStyle = `rgba(16,18,36,${a})`; ctx.fillRect(0, 0, W, H);
      if (fade.text) {
        ctx.globalAlpha = a;
        ctx.fillStyle = '#fff4dc'; ctx.font = '700 44px Fredoka, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(fade.text, W / 2, H / 2 - 10);
        ctx.font = '500 18px Fredoka, system-ui, sans-serif';
        ctx.fillText(S.rain ? 'soft rain on the roof…' : 'birds are singing…', W / 2, H / 2 + 28);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawLighting() {
    const h = S.minutes / 60;
    const dusk = Math.max(0, 1 - Math.abs(h - 18.2) / 1.6);
    if (dusk > 0) { ctx.fillStyle = `rgba(255,140,60,${0.13 * dusk})`; ctx.fillRect(0, 0, W, H); }
    const dk = darkness();
    if (dk <= 0.01) return;
    lx.globalCompositeOperation = 'source-over';
    lx.clearRect(0, 0, W, H);
    lx.fillStyle = `rgba(14,18,52,${dk})`; lx.fillRect(0, 0, W, H);
    lx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, s) => {
      const g = lx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${s})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      lx.fillStyle = g; lx.beginPath(); lx.arc(x, y, r, 0, Math.PI * 2); lx.fill();
    };
    const lights = spr('house') && spr('market')
      ? [[HOUSE_POS.x + 45, HOUSE_POS.y + 75, 55], [HOUSE_POS.x + 115, HOUSE_POS.y + 75, 55],
         [MARKET_POS.x + 36, MARKET_POS.y + 56, 60], [MARKET_POS.x + 90, MARKET_POS.y + 56, 60]]
      : [[97, 93, 55], [191, 93, 55], [SHOP.x0 * TILE + 7, 2 * TILE + 8, 60], [SHOP.x1 * TILE + TILE - 7, 2 * TILE + 8, 60]];
    if (S.screen === 'play') hole(player.x, player.y, 95, 0.85);
    for (const [x, y, r] of lights) hole(x, y, r, 0.9);
    ctx.drawImage(light, 0, 0, W, H);
    // warm glow
    for (const [x, y, r] of lights) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,200,110,${0.3 * dk})`); g.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ------------------------------------------------------------------ HUD
  const $ = id => document.getElementById(id);
  const hud = { day: $('day'), time: $('time'), weather: $('weather'), gold: $('gold'), energy: $('energyFill'), water: $('waterFill'), hint: $('hint') };
  const hudCache = {};
  function setHud(name, val, prop = 'textContent') {
    if (hudCache[name] === val) return;
    hudCache[name] = val;
    if (prop === 'width') hud[name].style.width = val; else hud[name].textContent = val;
  }
  function clockText() {
    const m = Math.floor(S.minutes) % (24 * 60);
    const hr = Math.floor(m / 60), mm = Math.floor((m % 60) / 10) * 10;
    return `${(hr + 11) % 12 + 1}:${String(mm).padStart(2, '0')} ${hr < 12 ? 'AM' : 'PM'}`;
  }
  function hintText() {
    if (S.screen !== 'play' || fade || modal.open) return '';
    if (S.scene === 'inside') {
      if (nearBed()) return 'E · Sleep';
      if (player.y + 9 > 205) return '↓ Walk out to leave';
      return '';
    }
    const { tx, ty } = target();
    if (isDoor(tx, ty)) return 'E · Go inside';
    if (isShop(tx, ty)) return 'E · Open market';
    const tile = tileAt(tx, ty), plot = soil.get(key(tx, ty)), tool = TOOLS[S.tool];
    if (plot?.crop && isMature(plot.crop)) return `E · Harvest ${CROPS[plot.crop.type].name}`;
    if (tool === 'water' && tile === T.WATER) return 'E · Refill can';
    if (tool === 'hoe' && tile === T.GRASS) return 'E · Till soil';
    if (tool === 'water' && plot && !plot.watered) return 'E · Water';
    if (tool === 'seeds' && plot && !plot.crop) {
      const k = CROP_KEYS[S.seedSel];
      return `E · Plant ${CROPS[k].name} (${S.seeds[k]} left) · Q to switch`;
    }
    if (plot?.crop) {
      const d = CROPS[plot.crop.type];
      return `${d.name} · ${plot.crop.age}/${d.days} days · ${plot.watered ? 'watered 💧' : 'thirsty'}`;
    }
    return '';
  }
  function updateHud() {
    const h = S.minutes / 60;
    setHud('day', `Day ${S.day} · ${SEASONS[Math.floor((S.day - 1) / 28) % 4]}`);
    setHud('time', clockText());
    setHud('weather', S.rain ? '🌧 Rainy' : (h >= 19 || h < 6) ? '🌙 Clear night' : '☀️ Sunny');
    setHud('gold', `💰 ${S.gold}g`);
    setHud('energy', `${S.energy}%`, 'width');
    setHud('water', `${S.water / CAN_SIZE * 100}%`, 'width');
    setHud('hint', hintText());
  }

  // hotbar
  const hotbar = $('hotbar');
  const slots = TOOLS.map((tool, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.innerHTML = `<canvas width="64" height="64"></canvas><span class="key">${i + 1}</span><span class="label"></span><span class="count"></span>`;
    el.addEventListener('click', () => setTool(i));
    hotbar.appendChild(el);
    return el;
  });
  function refreshHotbar() {
    slots.forEach((el, i) => {
      const tool = TOOLS[i];
      el.classList.toggle('active', i === S.tool);
      const k = CROP_KEYS[S.seedSel];
      el.querySelector('.label').textContent = tool === 'seeds' ? CROPS[k].name : TOOL_NAMES[tool];
      el.querySelector('.count').textContent = tool === 'seeds' ? `×${S.seeds[k] ?? 0}` : '';
      paintIconCanvas(el.querySelector('canvas'), tool === 'seeds' ? `packet:${k}` : tool);
    });
  }
  function setTool(i) { S.tool = i; refreshHotbar(); }
  function cycleSeed() {
    S.seedSel = (S.seedSel + 1) % CROP_KEYS.length;
    S.tool = 2;
    refreshHotbar();
    const k = CROP_KEYS[S.seedSel];
    toast(`🌱 ${CROPS[k].name} seeds (×${S.seeds[k]})`);
  }

  // toasts
  const toasts = $('toasts');
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    toasts.appendChild(el);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 2600);
  }

  // ------------------------------------------------------------------ modals
  const modal = { open: false, kind: null };
  const modalEl = $('modal'), card = $('modalCard');
  function openModal(kind) { modal.open = true; modal.kind = kind; modalEl.classList.remove('hidden'); keys.clear(); player.moving = false; }
  function closeModal() { modal.open = false; modal.kind = null; modalEl.classList.add('hidden'); }

  function openSleep() {
    openModal('sleep');
    const late = S.minutes > 22 * 60;
    card.innerHTML = `
      <h2>🛏 Cozy bed</h2>
      <p>${late ? 'It\'s late. Your pillow is calling.' : 'Head to bed and end the day early?'}</p>
      <p class="sub">Watered crops grow overnight. The game saves when you sleep.</p>
      <div class="actions"><button class="ghost" data-close>Not yet (N)</button><button class="warm" data-sleep>Sleep (Y)</button></div>`;
  }

  function openShop() {
    openModal('shop');
    renderShop();
  }
  function renderShop() {
    const total = CROP_KEYS.reduce((s, k) => s + S.crops[k] * CROPS[k].sell, 0);
    card.innerHTML = `
      <h2>🧺 Valley Market</h2>
      <p class="sub">“Fresh seeds, fair prices!” · You have <b>${S.gold}g</b></p>
      <h3>Seeds</h3>
      <div class="rows">${CROP_KEYS.map(k => {
        const c = CROPS[k];
        return `<div class="row">
          <canvas data-icon="packet:${k}" width="64" height="64"></canvas>
          <div class="info"><b>${c.name}</b><small>${c.days} days${c.regrow ? ` · regrows every ${c.regrow}` : ''} · sells for ${c.sell}g</small></div>
          <span class="own">×${S.seeds[k]}</span>
          <button data-buy="${k}" data-n="1" ${S.gold < c.seed ? 'disabled' : ''}>${c.seed}g</button>
          <button data-buy="${k}" data-n="5" ${S.gold < c.seed * 5 ? 'disabled' : ''}>5 · ${c.seed * 5}g</button>
        </div>`;
      }).join('')}</div>
      <h3>Your produce</h3>
      <div class="rows">${CROP_KEYS.map(k => {
        const c = CROPS[k];
        return `<div class="row">
          <canvas data-icon="crop:${k}" width="64" height="64"></canvas>
          <div class="info"><b>${c.name}</b><small>${c.sell}g each</small></div>
          <span class="own">×${S.crops[k]}</span>
          <button class="warm" data-sell="${k}" ${S.crops[k] ? '' : 'disabled'}>Sell · ${S.crops[k] * c.sell}g</button>
        </div>`;
      }).join('')}</div>
      <div class="actions">
        <button class="ghost" data-close>Close (Esc)</button>
        <button class="warm" data-sellall ${total ? '' : 'disabled'}>Sell everything · ${total}g</button>
      </div>`;
    card.querySelectorAll('canvas[data-icon]').forEach(cv => paintIconCanvas(cv, cv.dataset.icon));
  }
  function buy(k, n) {
    const cost = CROPS[k].seed * n;
    if (S.gold < cost) { sfx('nope'); return; }
    S.gold -= cost; S.seeds[k] += n;
    S.seedSel = CROP_KEYS.indexOf(k);
    sfx('coin'); refreshHotbar(); renderShop();
  }
  function sell(k) {
    const n = S.crops[k];
    if (!n) return 0;
    const g = n * CROPS[k].sell;
    S.gold += g; S.earned += g; S.crops[k] = 0;
    return g;
  }
  card.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.close !== undefined) return closeModal();
    if (b.dataset.sleep !== undefined) return sleep(false);
    if (b.dataset.buy) return buy(b.dataset.buy, +b.dataset.n);
    if (b.dataset.sell) { const g = sell(b.dataset.sell); if (g) { sfx('coin'); toast(`💰 +${g}g`); } return renderShop(); }
    if (b.dataset.sellall !== undefined) {
      const g = CROP_KEYS.reduce((s, k) => s + sell(k), 0);
      if (g) { sfx('coin'); toast(`💰 +${g}g`); }
      renderShop();
    }
  });
  modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });

  // ------------------------------------------------------------------ title & input
  const titleEl = $('title');
  const btnContinue = $('btnContinue');
  btnContinue.style.display = hasSave() ? '' : 'none';
  function startGame(mode) {
    initAudio();
    if (mode === 'continue' && load()) toast(`🌾 Welcome back — Day ${S.day}`);
    else { newGame(); toast('🌾 Welcome to Chill Valley!'); toast('Till soil with the hoe, plant, then water 💧'); }
    S.screen = 'play';
    titleEl.classList.add('hidden');
    refreshHotbar();
  }
  btnContinue.addEventListener('click', () => startGame('continue'));
  $('btnNew').addEventListener('click', () => {
    if (hasSave() && !confirm('Start a new farm? Your current save will be replaced.')) return;
    startGame('new');
  });
  $('musicBtn').addEventListener('click', () => { initAudio(); toggleMusic(); });

  // Read the physical key (e.code) so controls work on any keyboard layout (e.g. Thai) and with
  // Caps Lock on; fall back to e.key for keys without a code.
  const CODE_KEYS = {
    KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyE: 'e', KeyQ: 'q', KeyM: 'm', KeyY: 'y', KeyN: 'n',
    Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Numpad1: '1', Numpad2: '2', Numpad3: '3', Numpad4: '4',
    Space: ' ', Enter: 'enter', NumpadEnter: 'enter', Escape: 'escape',
    ArrowUp: 'arrowup', ArrowDown: 'arrowdown', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright',
  };
  const keyName = e => CODE_KEYS[e.code] || (e.key || '').toLowerCase();

  window.addEventListener('keydown', e => {
    const k = keyName(e);
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (S.screen === 'title') {
      if (k === 'enter') startGame(hasSave() ? 'continue' : 'new');
      return;
    }
    initAudio();
    if (modal.open) {
      if (e.repeat) return;
      if (k === 'escape') closeModal();
      else if (modal.kind === 'shop' && k === 'e') closeModal();
      else if (modal.kind === 'sleep') {
        if (k === 'y' || k === 'enter' || k === 'e' || k === ' ') sleep(false);
        else if (k === 'n') closeModal();
      }
      return;
    }
    keys.add(k);
    if (e.repeat || fade) return;
    if (k === 'e' || k === ' ') act();
    else if ('1234'.includes(k)) setTool(+k - 1);
    else if (k === 'q') cycleSeed();
    else if (k === 'm') toggleMusic();
  });
  window.addEventListener('keyup', e => keys.delete(keyName(e)));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('beforeunload', () => { if (S.screen === 'play' && !fade) save(); });

  // ------------------------------------------------------------------ boot
  newGame();
  refreshHotbar();
  S.minutes = 9 * 60; // pretty morning light behind the title screen
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // handy for debugging in the console
  window.chillValley = { S, player, soil, sleep: () => sleep(false), step: dt => update(dt) };
})();
