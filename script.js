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
  previewVisible: false
};

const SNAP_TOLERANCE_FACTOR = 0.18; // fraction of piece width
const BOARD_MARGIN_FACTOR = 0.2;    // 20% extra board space
const CENTER_BOUNDS_PADDING_UNITS = 1;

// --- Helpers -----------------------------------------------------------

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("visible");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove("visible"), 1400);
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
  const statsEl = document.getElementById("stats");
  const groupCount = Object.keys(state.groups).length;
  let largestGroup = 0;
  for (const g of Object.values(state.groups)) {
    if (g.pieceIds.size > largestGroup) largestGroup = g.pieceIds.size;
  }
  statsEl.innerHTML = `
    <div class="stat-chip">Pieces: ${getActivePieceCount()}</div>
    <div class="stat-chip">Groups: ${groupCount}</div>
    <div class="stat-chip">Largest group: ${largestGroup}</div>
  `;
}

function resetWinState() {
  document.getElementById("winBanner").classList.remove("visible");
}

function checkWin() {
  if (!state.currentPuzzle) return;
  const needed = getActivePieceCount();
  const groups = Object.values(state.groups);
  if (groups.length === 1 && groups[0].pieceIds.size === needed) {
    document.getElementById("winBanner").classList.add("visible");
    showToast("Puzzle completed!");
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
    const clipCenter = getPieceClipPathCenter(g);
    const cx = clipCenter ? clipCenter.x : bbox.x + bbox.width / 2;
    const cy = clipCenter ? clipCenter.y : bbox.y + bbox.height / 2;
    return { g, bbox, cx, cy };
  });

  info.sort((a, b) => (a.cy === b.cy ? a.cx - b.cx : a.cy - b.cy));

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
  for (const pid of group.pieceIds) {
    const piece = state.pieces[pid];
    if (!piece) continue;
    piece.el.setAttribute("transform", `translate(${group.dx},${group.dy})`);
  }
}

function updateAllGroupTransforms() {
  for (const gid of Object.keys(state.groups)) {
    updateGroupTransforms(gid);
  }
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

  updateGroupTransforms(anchorId);
  enforcePieceRenderOrder();
  recomputeStats();
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
    const pointerSvg = clientToSvgUnits(ev.clientX, ev.clientY);
    if (!pointerSvg) return;

    state.activeDrag = {
      groupId: group.id,
      lastGoodDx: group.dx,
      lastGoodDy: group.dy,
      pointerOffsetX: pointerSvg.x - group.dx,
      pointerOffsetY: pointerSvg.y - group.dy
    };

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

    group.dx = nextDx;
    group.dy = nextDy;

    updateGroupTransforms(group.id);
  }

  function pointerUp() {
    const drag = state.activeDrag;
    if (drag) {
      const group = state.groups[drag.groupId];
      if (group && !groupFitsWithinBoard(group.id)) {
        group.dx = drag.lastGoodDx;
        group.dy = drag.lastGoodDy;
        updateGroupTransforms(group.id);
      }
      trySnapGroup(drag.groupId);
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
    document.getElementById("mobilePreviewModal").classList.add("visible");
  } else {
    state.previewVisible = !state.previewVisible;
    const container = document.getElementById("inlinePreview");
    container.classList.toggle("hidden", !state.previewVisible);
    document.body.classList.toggle("preview-open-desktop", state.previewVisible);
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
  state.currentPuzzle = puzzle;

  await buildSvgForPuzzle(puzzle);

  const inlineImg = document.getElementById("previewImage");
  const mobileImg = document.getElementById("mobilePreviewImage");
  if (inlineImg) inlineImg.src = puzzle.imageSrc;
  if (mobileImg) mobileImg.src = puzzle.imageSrc;
}

function initUI() {
  const select = document.getElementById("puzzleSelect");
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
    }
  });

  document
    .getElementById("previewToggleBtn")
    .addEventListener("click", togglePreview);

  initMobilePreviewModal();
}

// --- Boot --------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  initUI();
  loadPuzzleById(PUZZLES[0].id);
});
