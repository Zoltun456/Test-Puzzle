// --- Puzzle configuration ---------------------------------------------

const PUZZLES = [
  {
    id: "bear",
    name: "Bear (5 x 6)",
    cols: 5,
    rows: 6,
    pieceCount: 30,
    skipIds: [1, 5], // bottom corners: ignore these pieces
    imageSrc: "Bear/BearPuzzleComplete.png",
    pathsSrc: "Bear/BearPuzzle.svg"
  }
];

// --- State -------------------------------------------------------------

const state = {
  currentPuzzle: null,
  pieces: {},  // id -> {id,col,row,baseX,baseY,el,groupId}
  groups: {},  // groupId -> {id,dx,dy,pieceIds:Set}
  activeDrag: null,
  svg: null,
  piecesLayer: null,
  nativeWidth: 0,
  nativeHeight: 0,
  boardMinX: 0,
  boardMinY: 0,
  boardMaxX: 0,
  boardMaxY: 0,
  boardWidth: 0,
  boardHeight: 0,
  zCounter: 1,
  previewVisible: true,
  physicsRafId: null,
  physicsLastTs: 0,
  hasWon: false,
  timerRunning: false,
  timerStartMs: 0,
  timerElapsedMs: 0,
  timerIntervalId: null,
  hasActiveRound: false,
  soundEnabled: true,
  musicEnabled: true,
  masterVolume: 0.68,
  audioCtx: null,
  audioMasterGain: null,
  lastConnectSfxMs: 0,
  musicIntervalId: null,
  musicStep: 0,
  musicMasterGain: null,
  musicOscillators: new Set()
};

const SNAP_TOLERANCE_FACTOR = 0.18; // fraction of piece width
const BOARD_MARGIN_FACTOR = 0.2;    // 20% extra board space
const CENTER_BOUNDS_PADDING_UNITS = 1;
const MAX_TILT_DEG = 15;
const SNAPBACK_MIN_MS = 180;
const SNAPBACK_MAX_MS = 360;
const ROT_SPRING_STIFFNESS = 18;
const ROT_DAMPING = 4.5;
const ROT_DRAG_ACCEL_X = 0.34;
const ROT_DRAG_ACCEL_Y = 0.13;
const ROT_DRAG_DECEL_X = 0.0025;
const ROT_DRAG_DECEL_Y = 0.001;
const ROT_ACCEL_MAX = 1200;
const ROT_ANG_VEL_MAX = 420;
const ROT_PIVOT_UP_FACTOR = 0.18;
const RELEASE_SETTLE_MS = 150;
const BEST_TIME_KEY_PREFIX = "maddcapp.bestTime.";
const CONFETTI_COLORS = ["#f09d36", "#ca5b2c", "#2f6f3f", "#f4ce79", "#f06d4f"];
const MOVE_SFX_MIN_SPEED_PX = 120;
const MOVE_SFX_INTERVAL_MS = 95;
const CONNECT_SFX_MIN_INTERVAL_MS = 70;
const MUSIC_STEP_INTERVAL_MS = 3200;
const MUSIC_CHORD_DURATION_SEC = 5.6;
const MUSIC_TARGET_GAIN = 0.046;

// --- Helpers -----------------------------------------------------------

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove("visible"), 1400);
}

function formatDuration(totalMs) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function bestTimeKeyForPuzzle(puzzleId) {
  return `${BEST_TIME_KEY_PREFIX}${puzzleId}`;
}

function getBestTimeForPuzzle(puzzleId) {
  try {
    const raw = localStorage.getItem(bestTimeKeyForPuzzle(puzzleId));
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function setBestTimeForPuzzle(puzzleId, ms) {
  try {
    localStorage.setItem(bestTimeKeyForPuzzle(puzzleId), String(ms));
  } catch {
    // Ignore storage failures (private mode/quota).
  }
}

function updateBestTimeDisplay() {
  const el = document.getElementById("bestTimeValue");
  if (!el) return;
  const puzzleId = state.currentPuzzle?.id;
  if (!puzzleId) {
    el.textContent = "--:--";
    return;
  }
  const best = getBestTimeForPuzzle(puzzleId);
  el.textContent = best ? formatDuration(best) : "--:--";
}

function updateTimerDisplay() {
  const el = document.getElementById("timerValue");
  if (!el) return;
  el.textContent = formatDuration(state.timerElapsedMs);
}

function resetTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
  state.timerRunning = false;
  state.timerStartMs = 0;
  state.timerElapsedMs = 0;
  state.hasActiveRound = false;
  updateTimerDisplay();
}

function startTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
  state.timerRunning = true;
  state.hasActiveRound = true;
  state.timerStartMs = performance.now();
  state.timerElapsedMs = 0;
  updateTimerDisplay();

  state.timerIntervalId = setInterval(() => {
    if (!state.timerRunning) return;
    state.timerElapsedMs = performance.now() - state.timerStartMs;
    updateTimerDisplay();
  }, 120);
}

function stopTimer() {
  if (state.timerRunning) {
    state.timerElapsedMs = performance.now() - state.timerStartMs;
  }
  state.timerRunning = false;
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
  updateTimerDisplay();
  return state.timerElapsedMs;
}

function updateDifficultyBadge() {
  const badge = document.getElementById("difficultyBadge");
  if (!badge || !state.currentPuzzle) return;
  const puzzle = state.currentPuzzle;
  const animal = puzzle.name.split("(")[0].trim();
  const pieces = getActivePieceCount();
  badge.textContent = `${animal} - ${puzzle.cols}x${puzzle.rows} - ${pieces} Pieces`;
}

function updatePreviewButtonLabel() {
  const button = document.getElementById("previewToggleBtn");
  if (!button) return;
  if (isMobile()) {
    button.textContent = "Open Preview";
    return;
  }
  button.textContent = state.previewVisible ? "Hide Preview" : "Show Preview";
}

function updateSoundButtonLabel() {
  const button = document.getElementById("soundToggleBtn");
  if (!button) return;
  button.textContent = state.soundEnabled ? "Sound Effects On" : "Sound Effects Off";
  button.setAttribute("aria-pressed", String(state.soundEnabled));
}

function updateMusicButtonLabel() {
  const button = document.getElementById("musicToggleBtn");
  if (!button) return;
  button.textContent = state.musicEnabled ? "Music On" : "Music Off";
  button.setAttribute("aria-pressed", String(state.musicEnabled));
}

function ensureAudioMasterGain(ctx) {
  if (state.audioMasterGain && state.audioMasterGain.context === ctx) {
    return state.audioMasterGain;
  }
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0.0001, state.masterVolume);
  gain.connect(ctx.destination);
  state.audioMasterGain = gain;
  return gain;
}

function setMasterVolume(nextVolume) {
  state.masterVolume = clamp(nextVolume, 0, 1);
  if (!state.audioCtx || !state.audioMasterGain) return;
  const now = state.audioCtx.currentTime;
  const gainValue = Math.max(0.0001, state.masterVolume);
  state.audioMasterGain.gain.cancelScheduledValues(now);
  state.audioMasterGain.gain.setTargetAtTime(gainValue, now, 0.05);
}

function getAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  try {
    if (!state.audioCtx) {
      state.audioCtx = new AudioCtx();
      ensureAudioMasterGain(state.audioCtx);
    }
    if (state.audioCtx.state === "suspended") {
      state.audioCtx
        .resume()
        .then(() => {
          if (state.musicEnabled) startBackgroundMusic();
        })
        .catch(() => {
          // Browser will keep context suspended until a valid user gesture.
        });
    }
    return state.audioCtx;
  } catch {
    return null;
  }
}

function ensureMusicMasterGain(ctx) {
  if (state.musicMasterGain && state.musicMasterGain.context === ctx) {
    return state.musicMasterGain;
  }
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ensureAudioMasterGain(ctx));
  state.musicMasterGain = master;
  return master;
}

function registerMusicOscillator(osc) {
  state.musicOscillators.add(osc);
  osc.addEventListener(
    "ended",
    () => {
      state.musicOscillators.delete(osc);
    },
    { once: true }
  );
}

function scheduleAmbientChord(ctx, rootHz, intervals) {
  const master = ensureMusicMasterGain(ctx);
  const start = ctx.currentTime + 0.03;
  const end = start + MUSIC_CHORD_DURATION_SEC;
  const voiceConfigs = [
    { mult: 0.5, type: "sine", vol: 0.36 },
    { mult: intervals[0], type: "triangle", vol: 0.26 },
    { mult: intervals[1], type: "triangle", vol: 0.22 },
    { mult: intervals[2], type: "sine", vol: 0.16 }
  ];

  for (const voice of voiceConfigs) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = voice.type;
    osc.frequency.setValueAtTime(rootHz * voice.mult, start);
    osc.detune.setValueAtTime((Math.random() - 0.5) * 4, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(voice.vol, start + 1.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(master);
    registerMusicOscillator(osc);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

function scheduleNextAmbientStep() {
  if (!state.musicEnabled || !state.audioCtx || state.audioCtx.state !== "running") return;

  const progression = [
    { root: 196.0, intervals: [1, 1.25, 1.5] },  // G major
    { root: 220.0, intervals: [1, 1.2, 1.5] },   // A minor
    { root: 174.61, intervals: [1, 1.25, 1.5] }, // F major
    { root: 196.0, intervals: [1, 1.2, 1.5] }    // G minor color
  ];
  const chord = progression[state.musicStep % progression.length];
  scheduleAmbientChord(state.audioCtx, chord.root, chord.intervals);
  state.musicStep++;
}

function startBackgroundMusic() {
  if (!state.musicEnabled) return;
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return;
  if (state.musicIntervalId) return;

  state.musicStep = 0;
  const master = ensureMusicMasterGain(ctx);
  const now = ctx.currentTime;
  const safeStart = Math.max(master.gain.value, 0.0001);
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(safeStart, now);
  master.gain.exponentialRampToValueAtTime(MUSIC_TARGET_GAIN, now + 1.8);

  scheduleNextAmbientStep();
  state.musicIntervalId = setInterval(scheduleNextAmbientStep, MUSIC_STEP_INTERVAL_MS);
}

function stopBackgroundMusic() {
  if (state.musicIntervalId) {
    clearInterval(state.musicIntervalId);
    state.musicIntervalId = null;
  }

  const ctx = state.audioCtx;
  const master = state.musicMasterGain;
  if (ctx && master) {
    const now = ctx.currentTime;
    const safeStart = Math.max(master.gain.value, 0.0001);
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(safeStart, now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  }

  if (ctx && state.musicOscillators.size) {
    const stopAt = ctx.currentTime + 0.6;
    for (const osc of Array.from(state.musicOscillators)) {
      try {
        osc.stop(stopAt);
      } catch {
        // Oscillator may already be ended/stopped.
      }
    }
  }
}

function playTransientTone({
  type = "sine",
  frequency = 440,
  toFrequency = frequency,
  duration = 0.08,
  volume = 0.05,
  attack = 0.008
}) {
  if (!state.soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const start = ctx.currentTime + 0.001;
  const end = start + duration;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  osc.frequency.linearRampToValueAtTime(toFrequency, end);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(ensureAudioMasterGain(ctx));
  osc.start(start);
  osc.stop(end + 0.01);
}

// Swap these with file-based audio later if desired (pickup/move/connect/drop/snapback).
function playPickupSound() {
  playTransientTone({
    type: "triangle",
    frequency: 300,
    toFrequency: 420,
    duration: 0.07,
    volume: 0.04
  });
}

function playMoveSound(speedPx) {
  const speedFactor = clamp(speedPx / 900, 0.15, 1);
  playTransientTone({
    type: "sine",
    frequency: 210 + speedFactor * 130,
    toFrequency: 240 + speedFactor * 140,
    duration: 0.05,
    volume: 0.012 + speedFactor * 0.016,
    attack: 0.004
  });
}

function playConnectSound() {
  const now = performance.now();
  if (now - state.lastConnectSfxMs < CONNECT_SFX_MIN_INTERVAL_MS) return;
  state.lastConnectSfxMs = now;
  playTransientTone({
    type: "triangle",
    frequency: 520,
    toFrequency: 620,
    duration: 0.06,
    volume: 0.05
  });
  setTimeout(() => {
    playTransientTone({
      type: "triangle",
      frequency: 680,
      toFrequency: 820,
      duration: 0.07,
      volume: 0.05
    });
  }, 40);
}

function playDropSound() {
  playTransientTone({
    type: "sine",
    frequency: 190,
    toFrequency: 120,
    duration: 0.1,
    volume: 0.04
  });
}

function playSnapbackStartSound() {
  playTransientTone({
    type: "sawtooth",
    frequency: 360,
    toFrequency: 210,
    duration: 0.11,
    volume: 0.03
  });
}

function playSnapbackLandSound() {
  playTransientTone({
    type: "triangle",
    frequency: 150,
    toFrequency: 105,
    duration: 0.08,
    volume: 0.045
  });
}

function playButtonSound() {
  playTransientTone({
    type: "square",
    frequency: 420,
    toFrequency: 320,
    duration: 0.045,
    volume: 0.028,
    attack: 0.003
  });
}

function bindButtonClickSounds() {
  const buttons = document.querySelectorAll("button");
  for (const button of buttons) {
    if (button.id === "soundToggleBtn" || button.id === "musicToggleBtn") continue;
    button.addEventListener("click", () => {
      playButtonSound();
    });
  }
}

function playWinSound() {
  if (!state.soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const notes = [523.25, 659.25, 783.99];
    const start = ctx.currentTime + 0.01;
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.08, start + idx * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + idx * 0.11 + 0.12);
      osc.connect(gain).connect(ensureAudioMasterGain(ctx));
      osc.start(start + idx * 0.11);
      osc.stop(start + idx * 0.11 + 0.13);
    });
  } catch (err) {
    console.warn("Unable to play win sound:", err);
  }
}

function launchConfettiBurst() {
  const layer = document.getElementById("confettiLayer");
  if (!layer) return;
  layer.innerHTML = "";
  const pieces = 70;
  for (let i = 0; i < pieces; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti";
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.backgroundColor = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    bit.style.setProperty("--drift", `${(Math.random() - 0.5) * 220}px`);
    bit.style.setProperty("--spin", `${(Math.random() - 0.5) * 960}deg`);
    bit.style.setProperty("--fall-duration", `${1700 + Math.random() * 1200}ms`);
    bit.style.animationDelay = `${Math.random() * 220}ms`;
    layer.appendChild(bit);
  }

  setTimeout(() => {
    layer.innerHTML = "";
  }, 3200);
}

function triggerWinCelebration() {
  const boardWrapper = document.getElementById("boardWrapper");
  if (boardWrapper) {
    boardWrapper.classList.remove("is-complete");
    // Restart board animation if user wins again after reshuffle.
    void boardWrapper.offsetWidth;
    boardWrapper.classList.add("is-complete");
  }
  launchConfettiBurst();
  playWinSound();
}

function gridFromIndex(idx, cols) {
  return {
    col: idx % cols,
    row: Math.floor(idx / cols)
  };
}

function getNeighborsForPiece(id, cols, rows) {
  const idx = id - 1;
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  const neighbors = [];
  if (col > 0) neighbors.push(id - 1); // left
  if (col < cols - 1) neighbors.push(id + 1); // right
  if (row > 0) neighbors.push(id - cols); // up
  if (row < rows - 1) neighbors.push(id + cols); // down
  return neighbors;
}

function getWorldCenter(piece) {
  const group = state.groups[piece.groupId];
  return {
    x: piece.baseX + group.dx,
    y: piece.baseY + group.dy
  };
}

function clientToSvgUnits(clientX, clientY) {
  const svg = state.svg;
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
}

function getPieceClipPathCenter(pieceEl) {
  const clipRef = pieceEl.getAttribute("clip-path");
  if (!clipRef) return null;

  const match = clipRef.match(/^url\(#([^)]+)\)$/);
  if (!match) return null;

  const clipPathId = match[1];
  const clipPath = state.svg?.querySelector(`#${clipPathId}`);
  if (!clipPath) return null;

  const path = clipPath.querySelector("path");
  if (!path) return null;

  const bbox = path.getBBox();
  return {
    x: bbox.x + bbox.width / 2,
    y: bbox.y + bbox.height / 2
  };
}

function getGroupBaseCenter(group) {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const pid of group.pieceIds) {
    const piece = state.pieces[pid];
    if (!piece) continue;
    sumX += piece.baseX;
    sumY += piece.baseY;
    count++;
  }
  if (!count) return { x: 0, y: 0 };
  const pieceHeight =
    state.currentPuzzle && state.currentPuzzle.rows
      ? state.nativeHeight / state.currentPuzzle.rows
      : 0;
  const pivotYOffset = pieceHeight * ROT_PIVOT_UP_FACTOR;
  return { x: sumX / count, y: sumY / count - pivotYOffset };
}

function ensureGroupPhysicsState(group) {
  if (!group) return;
  if (typeof group.angleDeg !== "number") group.angleDeg = 0;
  if (typeof group.angularVelDeg !== "number") group.angularVelDeg = 0;
  if (typeof group.dragAccelDeg !== "number") group.dragAccelDeg = 0;
  if (typeof group.releaseSettleUntil !== "number") group.releaseSettleUntil = 0;
  if (typeof group.vx !== "number") group.vx = 0;
  if (typeof group.vy !== "number") group.vy = 0;
  if (typeof group.tiltSettling !== "boolean") group.tiltSettling = false;
  if (!group.snapback) group.snapback = null;
}

function groupFitsWithinBoard(groupId) {
  const group = state.groups[groupId];
  if (!group) return false;

  for (const pid of group.pieceIds) {
    const piece = state.pieces[pid];
    if (!piece) continue;

    const centerX = piece.baseX + group.dx;
    const centerY = piece.baseY + group.dy;
    if (
      centerX < state.boardMinX + CENTER_BOUNDS_PADDING_UNITS ||
      centerX > state.boardMaxX - CENTER_BOUNDS_PADDING_UNITS ||
      centerY < state.boardMinY + CENTER_BOUNDS_PADDING_UNITS ||
      centerY > state.boardMaxY - CENTER_BOUNDS_PADDING_UNITS
    ) {
      return false;
    }
  }

  return true;
}

function getActivePieceCount() {
  const puzzle = state.currentPuzzle;
  if (!puzzle) return 0;
  const skip = puzzle.skipIds || [];
  return puzzle.pieceCount - skip.length;
}

function recomputeStats() {
  const groupCount = Object.keys(state.groups).length;
  const pieceCount = getActivePieceCount();
  let largestGroup = 0;
  for (const g of Object.values(state.groups)) {
    if (g.pieceIds.size > largestGroup) largestGroup = g.pieceIds.size;
  }

  const groupsEl = document.getElementById("groupsValue");
  const piecesEl = document.getElementById("piecesValue");
  const largestEl = document.getElementById("largestGroupValue");
  if (groupsEl) groupsEl.textContent = String(groupCount);
  if (piecesEl) piecesEl.textContent = String(pieceCount);
  if (largestEl) largestEl.textContent = String(largestGroup);

  const statsEl = document.getElementById("stats");
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-chip">Pieces: ${pieceCount}</div>
      <div class="stat-chip">Groups: ${groupCount}</div>
      <div class="stat-chip">Largest group: ${largestGroup}</div>
    `;
  }
}

function resetWinState() {
  state.hasWon = false;
  const winBanner = document.getElementById("winBanner");
  const boardWrapper = document.getElementById("boardWrapper");
  const confettiLayer = document.getElementById("confettiLayer");
  if (winBanner) winBanner.classList.remove("visible");
  if (boardWrapper) boardWrapper.classList.remove("is-complete");
  if (confettiLayer) confettiLayer.innerHTML = "";
}

function checkWin() {
  if (!state.currentPuzzle || state.hasWon) return;
  const needed = getActivePieceCount();
  const groups = Object.values(state.groups);
  if (groups.length === 1 && groups[0].pieceIds.size === needed) {
    state.hasWon = true;
    const winBanner = document.getElementById("winBanner");
    if (winBanner) winBanner.classList.add("visible");
    const elapsed = stopTimer();
    triggerWinCelebration();

    if (state.hasActiveRound && state.currentPuzzle) {
      const puzzleId = state.currentPuzzle.id;
      const best = getBestTimeForPuzzle(puzzleId);
      if (!best || elapsed < best) {
        setBestTimeForPuzzle(puzzleId, elapsed);
        showToast(`New best: ${formatDuration(elapsed)}!`);
      } else {
        showToast(`Completed in ${formatDuration(elapsed)}.`);
      }
      state.hasActiveRound = false;
      updateBestTimeDisplay();
    } else {
      showToast("Puzzle completed!");
    }
  }
}

// --- SVG building ------------------------------------------------------

async function buildSvgForPuzzle(puzzle) {
  const board = document.getElementById("puzzleBoard");
  board.innerHTML = "";

  const svgNS = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("id", "puzzleSvg");
  svg.setAttribute("xmlns", svgNS);
  svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  board.appendChild(svg);
  state.svg = svg;

  // Load paths SVG
  let text;
  try {
    const resp = await fetch(puzzle.pathsSrc);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${puzzle.pathsSrc}`);
    text = await resp.text();
  } catch (err) {
    console.error(err);
    showToast("Error: could not load puzzle SVG.");
    return;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  const srcRoot = doc.documentElement;

  const viewBox = srcRoot.getAttribute("viewBox") || "0 0 1000 1000";
  const [minX, minY, width, height] = viewBox
    .split(/[\s,]+/)
    .map((v) => parseFloat(v));

  state.nativeWidth = width;
  state.nativeHeight = height;

  // Add board margin
  const extraX = width * BOARD_MARGIN_FACTOR;
  const extraY = height * BOARD_MARGIN_FACTOR;
  state.boardMinX = minX - extraX;
  state.boardMinY = minY - extraY;
  state.boardWidth = width + 2 * extraX;
  state.boardHeight = height + 2 * extraY;
  state.boardMaxX = state.boardMinX + state.boardWidth;
  state.boardMaxY = state.boardMinY + state.boardHeight;

  svg.setAttribute(
    "viewBox",
    `${state.boardMinX} ${state.boardMinY} ${state.boardWidth} ${state.boardHeight}`
  );
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const defs = document.createElementNS(svgNS, "defs");
  svg.appendChild(defs);

  const piecesLayer = document.createElementNS(svgNS, "g");
  piecesLayer.setAttribute("id", "piecesLayer");
  svg.appendChild(piecesLayer);
  state.piecesLayer = piecesLayer;

  const piecePaths = srcRoot.querySelectorAll("path");
  if (!piecePaths.length) {
    showToast("No paths found in Bear/BearPuzzle.svg");
    return;
  }

  const pathsArray = Array.from(piecePaths);

  // Create clip paths & image pieces
  pathsArray.forEach((pathEl, index) => {
    const d = pathEl.getAttribute("d");
    if (!d) return;
    const pieceIndex = index + 1;

    const clipPath = document.createElementNS(svgNS, "clipPath");
    const clipId = `pieceClip-${pieceIndex}`;
    clipPath.setAttribute("id", clipId);

    const cpPath = document.createElementNS(svgNS, "path");
    cpPath.setAttribute("d", d);
    clipPath.appendChild(cpPath);
    defs.appendChild(clipPath);

    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("class", "piece");
    piecesLayer.appendChild(g);

    const img = document.createElementNS(svgNS, "image");
    img.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", puzzle.imageSrc);
    img.setAttribute("href", puzzle.imageSrc);
    img.setAttribute("x", "0");
    img.setAttribute("y", "0");
    img.setAttribute("width", width);
    img.setAttribute("height", height);

    g.setAttribute("clip-path", `url(#${clipId})`);
    g.appendChild(img);
  });

  await new Promise((resolve) => requestAnimationFrame(resolve));
  initializePiecesFromSvg();
}

// --- Initialize pieces from SVG ---------------------------------------

function initializePiecesFromSvg() {
  const puzzle = state.currentPuzzle;
  const skipSet = new Set(puzzle.skipIds || []);

  const pieces = Array.from(state.piecesLayer.querySelectorAll(".piece"));

  const info = pieces.map((g) => {
    const bbox = g.getBBox();
    const sortCx = bbox.x + bbox.width / 2;
    const sortCy = bbox.y + bbox.height / 2;
    const clipCenter = getPieceClipPathCenter(g);
    const cx = clipCenter ? clipCenter.x : sortCx;
    const cy = clipCenter ? clipCenter.y : sortCy;
    return { g, bbox, sortCx, sortCy, cx, cy };
  });

  // Keep logical piece ordering stable for IDs/neighbors/skipIds.
  // Use bbox center for row/column sort, while base centers can still use clip geometry.
  info.sort((a, b) =>
    a.sortCy === b.sortCy ? a.sortCx - b.sortCx : a.sortCy - b.sortCy
  );

  state.pieces = {};
  state.groups = {};

  info.forEach((item, idx) => {
    const pieceId = idx + 1;
    const { col, row } = gridFromIndex(idx, puzzle.cols);
    const { cx, cy } = item;
    const g = item.g;

    if (skipSet.has(pieceId)) {
      // Hide and skip these pieces (e.g., blank corners)
      g.style.display = "none";
      return;
    }

    g.dataset.pieceId = String(pieceId);

    const pieceState = {
      id: pieceId,
      col,
      row,
      baseX: cx,
      baseY: cy,
      el: g,
      groupId: "g" + pieceId
    };

    state.pieces[pieceId] = pieceState;

    state.groups[pieceState.groupId] = {
      id: pieceState.groupId,
      dx: 0,
      dy: 0,
      pieceIds: new Set([pieceId])
    };

    setupDrag(pieceState);
  });

  shufflePieces(false); // initial scatter
  enforcePieceRenderOrder();
  recomputeStats();
  resetWinState();
}

// --- Group transforms --------------------------------------------------

function updateGroupTransforms(groupId) {
  const group = state.groups[groupId];
  if (!group) return;
  ensureGroupPhysicsState(group);
  const center = getGroupBaseCenter(group);
  for (const pid of group.pieceIds) {
    const piece = state.pieces[pid];
    if (!piece) continue;
    piece.el.setAttribute(
      "transform",
      `translate(${group.dx},${group.dy}) rotate(${group.angleDeg} ${center.x} ${center.y})`
    );
  }
}

function updateAllGroupTransforms() {
  for (const gid of Object.keys(state.groups)) {
    updateGroupTransforms(gid);
  }
}

function requestPhysicsTick() {
  if (state.physicsRafId != null) return;
  state.physicsRafId = requestAnimationFrame(runPhysicsTick);
}

function stepGroupRotationPhysics(group, dtSec, inputAccelDeg, springScale = 1, dampingScale = 1) {
  // Damped rotational spring: input adds torque, spring restores toward 0.
  const springAccel = -ROT_SPRING_STIFFNESS * springScale * group.angleDeg;
  const dampingAccel = -ROT_DAMPING * dampingScale * group.angularVelDeg;
  const totalAccel = inputAccelDeg + springAccel + dampingAccel;

  group.angularVelDeg += totalAccel * dtSec;
  group.angularVelDeg = clamp(group.angularVelDeg, -ROT_ANG_VEL_MAX, ROT_ANG_VEL_MAX);
  group.angleDeg += group.angularVelDeg * dtSec;
  group.angleDeg = clamp(group.angleDeg, -MAX_TILT_DEG, MAX_TILT_DEG);
}

function runPhysicsTick(ts) {
  state.physicsRafId = null;
  if (!state.physicsLastTs) state.physicsLastTs = ts;
  const dtSec = clamp((ts - state.physicsLastTs) / 1000, 1 / 240, 1 / 30);
  state.physicsLastTs = ts;
  let needsAnotherFrame = false;
  const activeDragGroupId = state.activeDrag?.groupId || null;

  for (const group of Object.values(state.groups)) {
    ensureGroupPhysicsState(group);
    let changed = false;
    let inputAccelDeg = 0;

    if (group.snapback) {
      const anim = group.snapback;
      const elapsed = ts - anim.startMs;
      const t = clamp(elapsed / anim.durationMs, 0, 1);
      const easeOut = 1 - Math.pow(1 - t, 3);

      const prevDx = group.dx;
      const prevDy = group.dy;
      group.dx = anim.fromDx + (anim.toDx - anim.fromDx) * easeOut;
      group.dy = anim.fromDy + (anim.toDy - anim.fromDy) * easeOut;

      const dtSec = Math.max((ts - (anim.lastTs || ts)) / 1000, 1 / 240);
      anim.lastTs = ts;
      group.vx = (group.dx - prevDx) / dtSec;
      group.vy = (group.dy - prevDy) / dtSec;
      inputAccelDeg = 0;
      changed = true;

      if (t >= 1) {
        group.dx = anim.toDx;
        group.dy = anim.toDy;
        group.snapback = null;
        group.tiltSettling = true;
        if (typeof anim.onComplete === "function") anim.onComplete();
      } else {
        needsAnotherFrame = true;
      }
    } else if (activeDragGroupId === group.id) {
      inputAccelDeg = group.dragAccelDeg;
      changed = true;
      needsAnotherFrame = true;
    } else if (group.tiltSettling || Math.abs(group.angleDeg) > 0.02 || Math.abs(group.angularVelDeg) > 0.05) {
      inputAccelDeg = 0;
      changed = true;
      needsAnotherFrame = true;
    }

    if (changed) {
      const releaseBoostActive = group.releaseSettleUntil > ts;
      const springScale = releaseBoostActive ? 1.25 : 1;
      const dampingScale = releaseBoostActive ? 1.9 : 1;
      stepGroupRotationPhysics(group, dtSec, inputAccelDeg, springScale, dampingScale);
      if (
        !group.snapback &&
        activeDragGroupId !== group.id &&
        Math.abs(group.angleDeg) < 0.02 &&
        Math.abs(group.angularVelDeg) < 0.05
      ) {
        group.angleDeg = 0;
        group.angularVelDeg = 0;
        group.tiltSettling = false;
        group.releaseSettleUntil = 0;
      }
      updateGroupTransforms(group.id);
    }
  }

  if (needsAnotherFrame) {
    requestPhysicsTick();
  } else {
    state.physicsLastTs = 0;
  }
}

function startGroupSnapback(groupId, toDx, toDy, onComplete) {
  const group = state.groups[groupId];
  if (!group) return;
  ensureGroupPhysicsState(group);
  const distance = Math.hypot(toDx - group.dx, toDy - group.dy);
  const durationMs = clamp(distance * 0.22, SNAPBACK_MIN_MS, SNAPBACK_MAX_MS);
  const completeWithSound = () => {
    playSnapbackLandSound();
    if (typeof onComplete === "function") onComplete();
  };
  group.snapback = {
    fromDx: group.dx,
    fromDy: group.dy,
    toDx,
    toDy,
    startMs: performance.now(),
    durationMs,
    lastTs: 0,
    onComplete: completeWithSound
  };
  group.dragAccelDeg = 0;
  group.tiltSettling = true;
  playSnapbackStartSound();
  requestPhysicsTick();
}

function enforcePieceRenderOrder() {
  const parent = state.piecesLayer;
  if (!parent) return;

  const combined = [];
  const singles = [];

  for (const piece of Object.values(state.pieces)) {
    const group = state.groups[piece.groupId];
    if (!group) continue;
    if (group.pieceIds.size > 1) {
      combined.push(piece.el);
    } else {
      singles.push(piece.el);
    }
  }

  // Combined groups render first; single pieces always render above them.
  for (const el of combined) parent.appendChild(el);
  for (const el of singles) parent.appendChild(el);
}

function bringGroupToFrontInBand(groupId) {
  const parent = state.piecesLayer;
  const group = state.groups[groupId];
  if (!parent || !group) return;

  const groupEls = Array.from(group.pieceIds)
    .map((pid) => state.pieces[pid]?.el)
    .filter(Boolean);

  if (group.pieceIds.size === 1) {
    for (const el of groupEls) parent.appendChild(el);
    return;
  }

  const piecesInDomOrder = Array.from(parent.querySelectorAll(".piece"));
  const firstSingle = piecesInDomOrder.find((el) => {
    const pid = Number(el.dataset.pieceId);
    const piece = state.pieces[pid];
    if (!piece) return false;
    const pieceGroup = state.groups[piece.groupId];
    return !!pieceGroup && pieceGroup.pieceIds.size === 1;
  });

  for (const el of groupEls) {
    parent.insertBefore(el, firstSingle || null);
  }
}

// --- Reset groups to singles (for Shuffle) -----------------------------

function resetGroupsToSingles() {
  const newGroups = {};
  for (const piece of Object.values(state.pieces)) {
    const oldGroup = state.groups[piece.groupId];
    const worldX = piece.baseX + oldGroup.dx;
    const worldY = piece.baseY + oldGroup.dy;
    const groupId = "g" + piece.id;

    piece.groupId = groupId;

    newGroups[groupId] = {
      id: groupId,
      dx: worldX - piece.baseX,
      dy: worldY - piece.baseY,
      pieceIds: new Set([piece.id])
    };
  }
  state.groups = newGroups;
  enforcePieceRenderOrder();
}

// --- Scatter / shuffle -------------------------------------------------

function scatterAllGroups() {
  const puzzleWidth = state.nativeWidth;
  const puzzleHeight = state.nativeHeight;
  const boardMinX = state.boardMinX;
  const boardMaxX = state.boardMaxX;
  const boardMinY = state.boardMinY;
  const boardMaxY = state.boardMaxY;

  const radiusBase = Math.min(puzzleWidth, puzzleHeight);
  const R_MIN = radiusBase * 0.25;
  const R_MAX = radiusBase * 0.6;

  for (const piece of Object.values(state.pieces)) {
    const bbox = piece.el.getBBox();

    let dx = 0;
    let dy = 0;
    let attempts = 0;

    while (attempts < 8) {
      const angle = Math.random() * Math.PI * 2;
      const r = R_MIN + Math.random() * (R_MAX - R_MIN);
      dx = r * Math.cos(angle);
      dy = r * Math.sin(angle);

      const newMinX = bbox.x + dx;
      const newMaxX = bbox.x + bbox.width + dx;
      const newMinY = bbox.y + dy;
      const newMaxY = bbox.y + bbox.height + dy;

      if (
        newMinX >= boardMinX &&
        newMaxX <= boardMaxX &&
        newMinY >= boardMinY &&
        newMaxY <= boardMaxY
      ) {
        break;
      }
      attempts++;
    }

    if (attempts >= 8) {
      const minDx = boardMinX - bbox.x;
      const maxDx = boardMaxX - (bbox.x + bbox.width);
      const minDy = boardMinY - bbox.y;
      const maxDy = boardMaxY - (bbox.y + bbox.height);
      dx = minDx + Math.random() * Math.max(0.001, maxDx - minDx);
      dy = minDy + Math.random() * Math.max(0.001, maxDy - minDy);
    }

    const group = state.groups[piece.groupId];
    group.dx = dx;
    group.dy = dy;
  }

  updateAllGroupTransforms();
  recomputeStats();
  showToast("Pieces shuffled.");
}

function shufflePieces(resetGroups = true) {
  if (resetGroups) resetGroupsToSingles();
  scatterAllGroups();
  resetWinState();
}

// --- Group merging / snapping -----------------------------------------

function mergeGroups(anchorId, movingId) {
  if (anchorId === movingId) return anchorId;
  const anchor = state.groups[anchorId];
  const moving = state.groups[movingId];
  if (!anchor || !moving) return anchorId;

  for (const pid of moving.pieceIds) {
    anchor.pieceIds.add(pid);
    state.pieces[pid].groupId = anchorId;
  }
  delete state.groups[movingId];
  ensureGroupPhysicsState(anchor);
  anchor.snapback = null;
  anchor.dragAccelDeg = 0;
  anchor.angularVelDeg = 0;
  anchor.tiltSettling = true;
  requestPhysicsTick();

  updateGroupTransforms(anchorId);
  enforcePieceRenderOrder();
  recomputeStats();
  playConnectSound();
  return anchorId;
}

function trySnapGroup(movingGroupId) {
  const puzzle = state.currentPuzzle;
  if (!puzzle) return;

  const pieceWidth = state.nativeWidth / puzzle.cols;
  const SNAP_THRESHOLD_UNITS = pieceWidth * SNAP_TOLERANCE_FACTOR;

  let merged = false;
  let movingGroup = state.groups[movingGroupId];
  if (!movingGroup) return;

  const pieceIds = Array.from(movingGroup.pieceIds);

  outer: for (const pid of pieceIds) {
    const piece = state.pieces[pid];
    const neighbors = getNeighborsForPiece(piece.id, puzzle.cols, puzzle.rows);
    const pos = getWorldCenter(piece);

    for (const nid of neighbors) {
      const neighborPiece = state.pieces[nid];
      if (!neighborPiece) continue; // neighbor might be skipped
      const otherGroupId = neighborPiece.groupId;
      if (otherGroupId === movingGroupId) continue;

      const neighborPos = getWorldCenter(neighborPiece);

      const expectedDx = neighborPiece.baseX - piece.baseX;
      const expectedDy = neighborPiece.baseY - piece.baseY;

      const actualDx = neighborPos.x - pos.x;
      const actualDy = neighborPos.y - pos.y;

      const dxDiff = Math.abs(actualDx - expectedDx);
      const dyDiff = Math.abs(actualDy - expectedDy);

      if (dxDiff <= SNAP_THRESHOLD_UNITS && dyDiff <= SNAP_THRESHOLD_UNITS) {
        const anchorGroupId = otherGroupId;
        const anchorGroup = state.groups[anchorGroupId];

        movingGroup.dx = anchorGroup.dx;
        movingGroup.dy = anchorGroup.dy;
        updateGroupTransforms(movingGroupId);

        const mergedId = mergeGroups(anchorGroupId, movingGroupId);
        merged = true;
        movingGroupId = mergedId;
        movingGroup = state.groups[mergedId];
        break outer;
      }
    }
  }

  if (merged) {
    trySnapGroup(movingGroupId); // chain merges
    checkWin();
  }
}

// --- Drag handling -----------------------------------------------------

function setupDrag(piece) {
  const el = piece.el;

  function pointerDown(ev) {
    ev.preventDefault();

    const group = state.groups[piece.groupId];
    if (!group) return;
    ensureGroupPhysicsState(group);
    group.snapback = null;
    group.tiltSettling = false;
    group.dragAccelDeg = 0;
    const pointerSvg = clientToSvgUnits(ev.clientX, ev.clientY);
    if (!pointerSvg) return;

    state.activeDrag = {
      groupId: group.id,
      lastGoodDx: group.dx,
      lastGoodDy: group.dy,
      pointerOffsetX: pointerSvg.x - group.dx,
      pointerOffsetY: pointerSvg.y - group.dy,
      lastClientX: ev.clientX,
      lastClientY: ev.clientY,
      lastMoveTs: performance.now(),
      filteredVxPx: 0,
      filteredVyPx: 0,
      prevFilteredVxPx: 0,
      prevFilteredVyPx: 0,
      lastMoveSfxMs: 0
    };
    playPickupSound();

    bringGroupToFrontInBand(group.id);

    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
  }

  function pointerMove(ev) {
    const drag = state.activeDrag;
    if (!drag) return;

    const group = state.groups[drag.groupId];
    if (!group) return;
    const pointerSvg = clientToSvgUnits(ev.clientX, ev.clientY);
    if (!pointerSvg) return;

    const nextDx = pointerSvg.x - drag.pointerOffsetX;
    const nextDy = pointerSvg.y - drag.pointerOffsetY;

    const now = performance.now();
    const dtSec = Math.max((now - drag.lastMoveTs) / 1000, 1 / 240);
    const vxPx = (ev.clientX - drag.lastClientX) / dtSec;
    const vyPx = (ev.clientY - drag.lastClientY) / dtSec;
    drag.filteredVxPx = drag.filteredVxPx * 0.78 + vxPx * 0.22;
    drag.filteredVyPx = drag.filteredVyPx * 0.78 + vyPx * 0.22;
    const accelVxPx = (drag.filteredVxPx - drag.prevFilteredVxPx) / dtSec;
    const accelVyPx = (drag.filteredVyPx - drag.prevFilteredVyPx) / dtSec;

    ensureGroupPhysicsState(group);
    group.vx = (nextDx - group.dx) / dtSec;
    group.vy = (nextDy - group.dy) / dtSec;
    const speedPx = Math.hypot(drag.filteredVxPx, drag.filteredVyPx);
    if (speedPx >= MOVE_SFX_MIN_SPEED_PX && now - drag.lastMoveSfxMs >= MOVE_SFX_INTERVAL_MS) {
      playMoveSound(speedPx);
      drag.lastMoveSfxMs = now;
    }
    if (speedPx < 8) {
      group.dragAccelDeg = 0;
    } else {
      // User movement provides rotational acceleration (torque-like input).
      group.dragAccelDeg = clamp(
        drag.filteredVxPx * ROT_DRAG_ACCEL_X +
        drag.filteredVyPx * ROT_DRAG_ACCEL_Y +
        accelVxPx * ROT_DRAG_DECEL_X +
        accelVyPx * ROT_DRAG_DECEL_Y,
        -ROT_ACCEL_MAX,
        ROT_ACCEL_MAX
      );
    }

    group.dx = nextDx;
    group.dy = nextDy;

    drag.lastClientX = ev.clientX;
    drag.lastClientY = ev.clientY;
    drag.lastMoveTs = now;
    drag.prevFilteredVxPx = drag.filteredVxPx;
    drag.prevFilteredVyPx = drag.filteredVyPx;

    updateGroupTransforms(group.id);
    requestPhysicsTick();
  }

  function pointerUp() {
    const drag = state.activeDrag;
    if (drag) {
      const group = state.groups[drag.groupId];
      if (group) {
        ensureGroupPhysicsState(group);
        group.dragAccelDeg = 0;
        group.tiltSettling = true;
        group.releaseSettleUntil = performance.now() + RELEASE_SETTLE_MS;
        playDropSound();
      }
      if (group && !groupFitsWithinBoard(group.id)) {
        startGroupSnapback(group.id, drag.lastGoodDx, drag.lastGoodDy, () => {
          const currentGroup = state.groups[drag.groupId];
          if (currentGroup) {
            trySnapGroup(drag.groupId);
          }
        });
      } else if (group) {
        requestPhysicsTick();
        trySnapGroup(drag.groupId);
      }
    }
    state.activeDrag = null;
    window.removeEventListener("pointermove", pointerMove);
    window.removeEventListener("pointerup", pointerUp);
    window.removeEventListener("pointercancel", pointerUp);
  }

  el.addEventListener("pointerdown", pointerDown);
}

// --- Preview handling --------------------------------------------------

function togglePreview() {
  const puzzle = state.currentPuzzle;
  if (!puzzle) return;

  if (isMobile()) {
    const modal = document.getElementById("mobilePreviewModal");
    if (modal) modal.classList.add("visible");
  } else {
    state.previewVisible = !state.previewVisible;
    const container = document.getElementById("inlinePreview");
    if (container) container.classList.toggle("hidden", !state.previewVisible);
    updatePreviewButtonLabel();
  }
}

function initMobilePreviewModal() {
  const modal = document.getElementById("mobilePreviewModal");
  if (!modal) return;
  modal.addEventListener("click", () => {
    modal.classList.remove("visible");
  });
}

// --- Load / UI wiring --------------------------------------------------

async function loadPuzzleById(puzzleId) {
  const puzzle = PUZZLES.find((p) => p.id === puzzleId);
  if (!puzzle) return;
  resetTimer();
  resetWinState();
  state.currentPuzzle = puzzle;
  state.previewVisible = true;

  await buildSvgForPuzzle(puzzle);

  const inlineImg = document.getElementById("previewImage");
  const mobileImg = document.getElementById("mobilePreviewImage");
  const previewContainer = document.getElementById("inlinePreview");
  if (inlineImg) inlineImg.src = puzzle.imageSrc;
  if (mobileImg) mobileImg.src = puzzle.imageSrc;
  if (previewContainer) previewContainer.classList.remove("hidden");

  updateDifficultyBadge();
  updateBestTimeDisplay();
  updatePreviewButtonLabel();
  updateTimerDisplay();
}

function initUI() {
  const select = document.getElementById("puzzleSelect");
  if (!select) return;
  for (const p of PUZZLES) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  }

  select.addEventListener("change", () => {
    loadPuzzleById(select.value);
  });

  document.getElementById("shuffleBtn").addEventListener("click", () => {
    if (state.currentPuzzle) {
      shufflePieces(true); // break groups and scatter
      startTimer();
    }
  });

  document
    .getElementById("previewToggleBtn")
    .addEventListener("click", togglePreview);

  const shareBtn = document.getElementById("shareBtn");
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const title = "Madd Capp Puzzles";
      const text = "Build the Wild with me!";
      const url = window.location.href;
      if (navigator.share) {
        try {
          await navigator.share({ title, text, url });
          return;
        } catch {
          // Fall back to clipboard if share sheet is dismissed or unavailable.
        }
      }
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          showToast("Share link copied.");
          return;
        } catch {
          // Keep fallback below.
        }
      }
      showToast("Share coming soon.");
    });
  }

  const dailyChallengeBtn = document.getElementById("dailyChallengeBtn");
  if (dailyChallengeBtn) {
    dailyChallengeBtn.addEventListener("click", () => {
      showToast("Daily Animal Challenge is coming soon.");
    });
  }

  const soundToggleBtn = document.getElementById("soundToggleBtn");
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener("click", () => {
      const wasEnabled = state.soundEnabled;
      if (wasEnabled) {
        playButtonSound();
      }
      state.soundEnabled = !state.soundEnabled;
      if (!wasEnabled && state.soundEnabled) {
        playButtonSound();
      }
      updateSoundButtonLabel();
      showToast(state.soundEnabled ? "Sound effects on." : "Sound effects off.");
    });
  }

  const musicToggleBtn = document.getElementById("musicToggleBtn");
  if (musicToggleBtn) {
    musicToggleBtn.addEventListener("click", () => {
      if (state.soundEnabled) {
        playButtonSound();
      }
      state.musicEnabled = !state.musicEnabled;
      if (state.musicEnabled) {
        startBackgroundMusic();
      } else {
        stopBackgroundMusic();
      }
      updateMusicButtonLabel();
      showToast(state.musicEnabled ? "Music on." : "Music off.");
    });
  }

  const volumeSlider = document.getElementById("volumeSlider");
  if (volumeSlider) {
    volumeSlider.value = String(Math.round(state.masterVolume * 100));
    volumeSlider.addEventListener("input", () => {
      const sliderValue = Number(volumeSlider.value);
      if (!Number.isFinite(sliderValue)) return;
      setMasterVolume(sliderValue / 100);
    });
  }

  bindButtonClickSounds();
  window.addEventListener("resize", updatePreviewButtonLabel);
  updateSoundButtonLabel();
  updateMusicButtonLabel();
  updateTimerDisplay();
  if (state.musicEnabled) startBackgroundMusic();

  initMobilePreviewModal();
}

// --- Boot --------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  initUI();
  loadPuzzleById(PUZZLES[0].id);
});
