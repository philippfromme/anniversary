// ============================================================
// CONFIGURATION
// ============================================================

const TRACK_SECONDS = 90;
const SINCE = "2016-04-01";
const UNTIL = "2026-04-01";
const VISIBLE_WINDOW_MS = 304 * 24 * 60 * 60 * 1000; // ~10 months
const MAX_VISIBLE_REPOS = 20;

// Fire indicator: sliding window for density detection
const FIRE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks

const startMs = new Date(SINCE).getTime();
const endMs = new Date(UNTIL).getTime();
const rangeMs = endMs - startMs;

// ============================================================
// STATE
// ============================================================

let commits = [];
let canvas, ctx;
let isPlaying = false;
let hasStarted = false;
let playStartRealTime = 0;
let currentPlaybackTime = 0;

// Precomputed fire threshold (max density observed)
let fireMaxDensity = 1;

// Smoothed fire level (attack/release envelope)
let smoothedFireLevel = 0;
const FIRE_ATTACK = 0.12;
const FIRE_RELEASE = 0.025;

// Bauhaus palette
const BG = "#ffffff";
const FG = "#1a1a1a";
const FG_SEC = "#6b6b6b";
const FG_TER = "#a0a0a0";
const ACCENT = "#30a14e";
const RULE = "#d0ccc6";

// Layout
const ROW_HEIGHT = 32;
const MARGIN_LEFT = 200;
const MARGIN_RIGHT = 80;
const HEADER_HEIGHT = 52;
const ROW_GAP = 0;

// ============================================================
// UTILITIES
// ============================================================

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function formatDate(ms) {
  const d = new Date(ms);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ============================================================
// DATA LOADING
// ============================================================

async function loadData() {
  const resp = await fetch("/commits.json");
  commits = await resp.json();

  for (const c of commits) {
    c.dateMs = new Date(c.date).getTime();
    c.t = (c.dateMs - startMs) / rangeMs;
    c.repoKey = `${c.owner}/${c.repo}`;
    c.linesChanged = (c.totalAdded || 0) + (c.totalDeleted || 0);
  }

  // Sort by date
  commits.sort((a, b) => a.dateMs - b.dateMs);

  // Precompute fire thresholds: sample 2-week density at weekly intervals
  precomputeFireThresholds();
}

function precomputeFireThresholds() {
  const step = 7 * 24 * 60 * 60 * 1000; // 1 week
  let maxDensity = 0;

  for (let t = startMs + FIRE_WINDOW_MS; t <= endMs; t += step) {
    let count = 0;
    for (const c of commits) {
      if (c.dateMs >= t - FIRE_WINDOW_MS && c.dateMs <= t) count++;
    }
    if (count > maxDensity) maxDensity = count;
  }

  fireMaxDensity = maxDensity || 1;
}

// ============================================================
// COMPUTE FRAME STATE
// ============================================================

function computeFrame(currentDateMs) {
  const windowStart = currentDateMs - VISIBLE_WINDOW_MS;
  const windowEnd = currentDateMs;

  // Count cumulative commits per repo up to currentDateMs
  const cumulativeCounts = {};
  const windowCommits = [];

  // Compute fire density: commits in last 2 weeks
  let fireDensity = 0;

  for (const c of commits) {
    if (c.dateMs > currentDateMs) break;
    cumulativeCounts[c.repoKey] = (cumulativeCounts[c.repoKey] || 0) + 1;

    if (c.dateMs >= windowStart && c.dateMs <= windowEnd) {
      windowCommits.push(c);
    }

    if (
      c.dateMs >= currentDateMs - FIRE_WINDOW_MS &&
      c.dateMs <= currentDateMs
    ) {
      fireDensity++;
    }
  }

  // Fire level: logarithmic scale so it goes higher more often
  let fireLevel =
    fireDensity === 0
      ? 0
      : clamp(
          Math.ceil(
            (Math.log(1 + fireDensity) / Math.log(1 + fireMaxDensity)) * 10,
          ),
          1,
          10,
        );

  // Sort repos by cumulative count descending
  const sortedRepos = Object.entries(cumulativeCounts).sort(
    (a, b) => b[1] - a[1],
  );

  const topRepos = sortedRepos.slice(0, MAX_VISIBLE_REPOS);
  const otherRepos = sortedRepos.slice(MAX_VISIBLE_REPOS);
  const otherCount = otherRepos.reduce((sum, [, count]) => sum + count, 0);
  const otherRepoCount = otherRepos.length;

  const topRepoKeys = new Set(topRepos.map(([key]) => key));

  // Filter window commits to top repos only
  const visibleCommits = windowCommits.filter((c) =>
    topRepoKeys.has(c.repoKey),
  );
  const otherCommits = windowCommits.filter((c) => !topRepoKeys.has(c.repoKey));

  return {
    windowStart,
    windowEnd,
    topRepos,
    otherRepoCount,
    otherCount,
    visibleCommits,
    otherCommits,
    totalCommits: Object.values(cumulativeCounts).reduce((s, c) => s + c, 0),
    rawFireLevel: fireLevel,
    fireDensity,
  };
}

// ============================================================
// CANVAS SETUP
// ============================================================

function setupCanvas() {
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ============================================================
// RENDERING
// ============================================================

function drawFrame(frame, progress, currentDateMs) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const timelineWidth = W - MARGIN_LEFT - MARGIN_RIGHT;

  const fontSans = '"Space Mono", monospace';
  const fontMono = '"Space Mono", monospace';

  // Clear — warm off-white
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // ── HEADER ──

  // Heavy 2px rule at top
  ctx.fillStyle = FG;
  ctx.fillRect(MARGIN_LEFT, 12, timelineWidth, 2);

  const headerCenterY = (14 + (HEADER_HEIGHT - 2)) / 2;

  // ── 10X METER (left) ──
  {
    const target = frame.rawFireLevel;
    if (target > smoothedFireLevel) {
      smoothedFireLevel += (target - smoothedFireLevel) * FIRE_ATTACK;
    } else {
      smoothedFireLevel += (target - smoothedFireLevel) * FIRE_RELEASE;
    }
    if (smoothedFireLevel < 0.05) smoothedFireLevel = 0;
    const level = Math.round(smoothedFireLevel);

    // Label
    const fontSize = 13;
    const blockSize = 10;
    const blockGap = 3;
    ctx.fillStyle = FG;
    ctx.font = `700 ${fontSize}px ${fontSans}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("10X METER", MARGIN_LEFT, headerCenterY);

    // Blocks — color gradient: blue → yellow → orange → red
    const blocksStartX = MARGIN_LEFT + 94 - 14;
    const blockTop = headerCenterY - blockSize / 2 - 2;
    const meterColors = [
      "#9be9a8",
      "#9be9a8", // 1-2: lightest green
      "#40c463",
      "#40c463", // 3-4: medium green
      "#40c463",
      "#30a14e", // 5-6: dark green
      "#30a14e",
      "#216e39", // 7-8: darker green
      "#216e39",
      "#216e39", // 9-10: darkest green
    ];

    for (let i = 0; i < 10; i++) {
      const bx = blocksStartX + i * (blockSize + blockGap);
      const active = i < level;
      const color = meterColors[i];

      if (active) {
        if (level >= 7) {
          const intensity = level >= 9 ? 2.5 : level >= 8 ? 1.5 : 0.8;
          const t = performance.now() / 1000;
          const sx = Math.sin(t * 40 + i * 2.3) * intensity;
          const sy = Math.cos(t * 33 + i * 1.8) * intensity * 0.6;
          ctx.fillStyle = color;
          ctx.fillRect(bx + sx, blockTop + sy, blockSize, blockSize);
        } else {
          ctx.fillStyle = color;
          ctx.fillRect(bx, blockTop, blockSize, blockSize);
        }
      } else {
        ctx.strokeStyle = RULE;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, blockTop + 0.5, blockSize - 1, blockSize - 1);
      }
    }
  }

  // Date (center)
  ctx.fillStyle = FG;
  ctx.font = `700 13px ${fontSans}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    formatDate(currentDateMs),
    MARGIN_LEFT + timelineWidth / 2,
    headerCenterY,
  );

  // Commit count (right)
  ctx.fillStyle = FG;
  ctx.font = `700 13px ${fontMono}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `${frame.totalCommits} commits`,
    MARGIN_LEFT + timelineWidth,
    headerCenterY,
  );

  // ── Thin rule below header ──
  ctx.fillStyle = RULE;
  ctx.fillRect(MARGIN_LEFT, HEADER_HEIGHT - 6, timelineWidth, 1);

  // ── Window date range ──
  const y0 = HEADER_HEIGHT;
  ctx.fillStyle = FG_TER;
  ctx.font = `9px ${fontSans}`;
  ctx.textAlign = "left";
  ctx.fillText(formatDate(frame.windowStart), MARGIN_LEFT, y0 + 10);
  ctx.textAlign = "right";
  ctx.fillText(
    formatDate(frame.windowEnd),
    MARGIN_LEFT + timelineWidth,
    y0 + 10,
  );
  ctx.textAlign = "left";

  const lanesTop = y0 + 18;

  // ── Repo rows ──
  for (let i = 0; i < frame.topRepos.length; i++) {
    const [repoKey, count] = frame.topRepos[i];
    const rowY = lanesTop + i * (ROW_HEIGHT + ROW_GAP);

    // Alternating background
    if (i % 2 === 0) {
      ctx.fillStyle = "rgba(0,0,0,0.02)";
      ctx.fillRect(MARGIN_LEFT, rowY, timelineWidth, ROW_HEIGHT);
    }

    // Bottom border
    ctx.fillStyle = i === 0 ? FG : RULE;
    ctx.fillRect(
      MARGIN_LEFT,
      rowY + ROW_HEIGHT,
      timelineWidth,
      i === 0 ? 1.5 : 0.5,
    );

    // Repo name — ranked by brightness
    const shortName = repoKey.split("/")[1] || repoKey;
    const displayName =
      shortName.length > 26 ? shortName.slice(0, 25) + "…" : shortName;
    const shade = i === 0 ? FG : i < 5 ? FG_SEC : FG_TER;
    ctx.fillStyle = shade;
    ctx.font = i === 0 ? `700 12px ${fontMono}` : `400 11px ${fontMono}`;
    ctx.textAlign = "right";
    ctx.fillText(displayName, MARGIN_LEFT - 10, rowY + ROW_HEIGHT / 2 + 1);

    // Commit count (right)
    ctx.fillStyle = FG_TER;
    ctx.font = `11px ${fontMono}`;
    ctx.textAlign = "left";
    ctx.fillText(
      String(count),
      MARGIN_LEFT + timelineWidth + 8,
      rowY + ROW_HEIGHT / 2 + 1,
    );
    ctx.textAlign = "left";

    // Draw commit ticks — 5-step temperature gradient (cold blue → hot red)
    const TEMP_COLORS = [
      "#9be9a8", // light green
      "#40c463", // medium green
      "#30a14e", // dark green
      "#216e39", // darkest green
    ];
    const repoCommits = frame.visibleCommits.filter(
      (c) => c.repoKey === repoKey,
    );

    // Sort by intensity descending — hottest first, then skip overlaps
    const sorted = repoCommits
      .map((c) => ({
        cx:
          MARGIN_LEFT +
          ((c.dateMs - frame.windowStart) / VISIBLE_WINDOW_MS) * timelineWidth,
        linesChanged: c.linesChanged,
      }))
      .sort((a, b) => b.linesChanged - a.linesChanged);

    const barW = 8;
    const barH = barW;
    const barY = Math.round(rowY + (ROW_HEIGHT - barH) / 2);
    const drawnXs = [];
    for (const s of sorted) {
      // Skip if a hotter commit already occupies this pixel range
      const tooClose = drawnXs.some((dx) => Math.abs(dx - s.cx) < barW);
      if (tooClose) continue;
      drawnXs.push(s.cx);
      const t = clamp(Math.log1p(s.linesChanged) / 7, 0, 1);
      const stepIdx = Math.min(Math.floor(t * 4), 3);
      ctx.fillStyle = TEMP_COLORS[stepIdx];
      ctx.fillRect(s.cx - barW / 2, barY, barW, barH);
    }
  }

  // ── "+N more repos" row ──
  if (frame.otherRepoCount > 0) {
    const otherRowY = lanesTop + frame.topRepos.length * (ROW_HEIGHT + ROW_GAP);

    // Label
    ctx.fillStyle = FG_TER;
    ctx.font = `400 11px ${fontSans}`;
    ctx.textAlign = "right";
    ctx.fillText(
      `+${frame.otherRepoCount} more`,
      MARGIN_LEFT - 10,
      otherRowY + ROW_HEIGHT / 2 + 4,
    );

    // Count
    ctx.fillStyle = FG_TER;
    ctx.font = `11px ${fontMono}`;
    ctx.textAlign = "left";
    ctx.fillText(
      String(frame.otherCount),
      MARGIN_LEFT + timelineWidth + 8,
      otherRowY + ROW_HEIGHT / 2 + 4,
    );

    // Faint commit ticks
    for (const c of frame.otherCommits) {
      const cx =
        MARGIN_LEFT +
        ((c.dateMs - frame.windowStart) / VISIBLE_WINDOW_MS) * timelineWidth;
      ctx.fillStyle = "rgba(26,26,26,0.06)";
      ctx.fillRect(cx - 0.4, otherRowY + ROW_HEIGHT * 0.3, 1, ROW_HEIGHT * 0.4);
    }
  }

  // ── Progress bar at bottom ──
  const barY = H - 3;
  ctx.fillStyle = RULE;
  ctx.fillRect(0, barY, W, 3);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, barY, W * progress, 3);

  // ── Timer bottom right ──
  const elapsed = Math.floor(progress * TRACK_SECONDS);
  const timeStr = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  ctx.fillStyle = FG_TER;
  ctx.font = `10px ${fontMono}`;
  ctx.textAlign = "right";
  ctx.fillText(timeStr, W - 20, H - 12);
  ctx.textAlign = "left";
}

// ============================================================
// ANIMATION LOOP
// ============================================================

function animate() {
  if (!hasStarted) {
    requestAnimationFrame(animate);
    return;
  }

  const now = performance.now();
  const elapsedSec = (now - playStartRealTime) / 1000;
  const progress = clamp(elapsedSec / TRACK_SECONDS, 0, 1);
  currentPlaybackTime = elapsedSec;

  const currentDateMs = startMs + progress * rangeMs;
  const frame = computeFrame(currentDateMs);

  drawFrame(frame, progress, currentDateMs);

  if (progress >= 1) {
    isPlaying = false;
    showEndModal();
    return;
  }

  requestAnimationFrame(animate);
}

// ============================================================
// END MODAL
// ============================================================

function showEndModal() {
  // Compute final top 10 repos
  const cumulativeCounts = {};
  for (const c of commits) {
    cumulativeCounts[c.repoKey] = (cumulativeCounts[c.repoKey] || 0) + 1;
  }
  const sorted = Object.entries(cumulativeCounts).sort((a, b) => b[1] - a[1]);
  const top10 = sorted.slice(0, 10);
  const totalCommits = sorted.reduce((sum, [, count]) => sum + count, 0);

  // Populate DOM
  document.getElementById("end-total").textContent =
    totalCommits.toLocaleString();

  const reposContainer = document.getElementById("end-repos");
  reposContainer.innerHTML = "";
  for (let i = 0; i < top10.length; i++) {
    const [repoKey, count] = top10[i];
    const shortName = repoKey.split("/")[1] || repoKey;
    const row = document.createElement("div");
    row.className = "end-repo-row";
    row.innerHTML = `<span class="end-repo-rank">${i + 1}.</span><span class="end-repo-name">${shortName}</span><span class="end-repo-count">${count}</span>`;
    reposContainer.appendChild(row);
  }

  // Show with slight delay for dramatic effect
  setTimeout(() => {
    document.getElementById("end-overlay").classList.add("visible");
  }, 300);
}

function hideEndModal() {
  document.getElementById("end-overlay").classList.remove("visible");
}

function replay() {
  hideEndModal();
  playStartRealTime = performance.now();
  isPlaying = true;
  currentPlaybackTime = 0;
  smoothedFireLevel = 0;
  requestAnimationFrame(animate);
}

// ============================================================
// START GRID (GitHub-style contribution graph)
// ============================================================

const GRID_GREENS = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];

function buildStartGrid() {
  const grid = document.getElementById("start-grid");
  if (!grid) return;

  // Bucket commits into weeks (7-day bins from SINCE)
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const totalWeeks = Math.ceil(rangeMs / weekMs);
  const weekCounts = new Array(totalWeeks).fill(0);

  for (const c of commits) {
    const week = Math.floor((c.dateMs - startMs) / weekMs);
    if (week >= 0 && week < totalWeeks) weekCounts[week]++;
  }

  // Compute thresholds (quartiles of non-zero weeks)
  const nonZero = weekCounts.filter((c) => c > 0).sort((a, b) => a - b);
  const q1 = nonZero[Math.floor(nonZero.length * 0.25)] || 1;
  const q2 = nonZero[Math.floor(nonZero.length * 0.5)] || 2;
  const q3 = nonZero[Math.floor(nonZero.length * 0.75)] || 4;

  // Build cells twice for seamless marquee loop
  const fragment = document.createDocumentFragment();

  for (let repeat = 0; repeat < 2; repeat++) {
    for (let week = 0; week < totalWeeks; week++) {
      const count = weekCounts[week] || 0;

      let colorIdx;
      if (count === 0) colorIdx = 0;
      else if (count <= q1) colorIdx = 1;
      else if (count <= q2) colorIdx = 2;
      else if (count <= q3) colorIdx = 3;
      else colorIdx = 4;

      const cell = document.createElement("div");
      cell.className = "start-grid-cell";
      cell.style.background = GRID_GREENS[colorIdx];
      fragment.appendChild(cell);
    }
  }

  grid.appendChild(fragment);

  // Count up from 0 to 10 over 5 seconds
  const counter = document.getElementById("start-counter");
  let count = 0;
  const countInterval = setInterval(() => {
    count++;
    if (counter) {
      counter.textContent = count;
      // Increase shake intensity as count rises
      const intensity = (count / 10) * 4;
      counter.style.setProperty("--shake", intensity + "px");
    }
    if (count >= 10) {
      clearInterval(countInterval);
      // Scale up and fade out
      counter.classList.add("explode");
    }
  }, 500);

  // After 5 seconds: scale cells to fill screen height, then show card
  const CELL_SIZE = 14;
  const GAP = 3;

  setTimeout(() => {
    const cellHeight = CELL_SIZE + GAP;
    const targetHeight = window.innerHeight;
    const scale = targetHeight / cellHeight;

    // Scale each cell to fill the viewport height
    const cells = grid.querySelectorAll(".start-grid-cell");
    for (const cell of cells) {
      cell.style.transition = "height 1.5s ease, border-radius 1.5s ease";
      cell.style.height = targetHeight + "px";
      cell.style.borderRadius = "0";
    }

    // Also remove the gap
    grid.style.transition = "gap 1.5s ease";
    grid.style.gap = "2px";

    // Show card after scale animation completes
    setTimeout(() => {
      const card = document.querySelector(".start-card");
      if (card) card.classList.add("visible");
    }, 800);
  }, 5000);
}

// ============================================================
// INIT
// ============================================================

async function init() {
  const loadingEl = document.getElementById("loading");
  const overlayEl = document.getElementById("start-overlay");

  try {
    await loadData();
    console.log(
      `Loaded ${commits.length} commits, fire max density: ${fireMaxDensity}`,
    );
  } catch (err) {
    loadingEl.textContent = "FAILED TO LOAD DATA";
    loadingEl.classList.remove("spinner");
    console.error(err);
    return;
  }

  setupCanvas();
  buildStartGrid();

  // Hide loading, show overlay
  loadingEl.classList.add("hidden");
  overlayEl.style.display = "flex";

  // Start animation loop
  requestAnimationFrame(animate);

  // Wait for button click to start
  const startBtn = document.getElementById("start-action");
  startBtn.addEventListener(
    "click",
    () => {
      overlayEl.classList.add("hidden");
      playStartRealTime = performance.now();
      isPlaying = true;
      hasStarted = true;
      console.log("Playback started");
    },
    { once: true },
  );

  // Replay button
  document.getElementById("replay-action").addEventListener("click", replay);
}

init();
