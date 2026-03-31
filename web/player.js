// ============================================================
// CONFIGURATION
// ============================================================

const TRACK_SECONDS = 90;
const SINCE = '2016-04-01';
const UNTIL = '2026-04-01';
const VISIBLE_WINDOW_MS = 365.25 * 24 * 60 * 60 * 1000; // 1 year
const MAX_VISIBLE_REPOS = 20;

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

// Layout
const ROW_HEIGHT = 32;
const MARGIN_LEFT = 200;
const MARGIN_RIGHT = 80;
const HEADER_HEIGHT = 60;
const ROW_GAP = 2;

// ============================================================
// UTILITIES
// ============================================================

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function stableHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function repoColor(repoKey) {
  const h = stableHash(repoKey) % 360;
  return `hsl(${h}, 60%, 55%)`;
}

function formatDate(ms) {
  const d = new Date(ms);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ============================================================
// DATA LOADING
// ============================================================

async function loadData() {
  const resp = await fetch('/out/commits.json');
  commits = await resp.json();

  for (const c of commits) {
    c.dateMs = new Date(c.date).getTime();
    c.t = (c.dateMs - startMs) / rangeMs;
    c.repoKey = `${c.owner}/${c.repo}`;
    c.linesChanged = (c.totalAdded || 0) + (c.totalDeleted || 0);
  }

  // Sort by date
  commits.sort((a, b) => a.dateMs - b.dateMs);
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

  for (const c of commits) {
    if (c.dateMs > currentDateMs) break;
    cumulativeCounts[c.repoKey] = (cumulativeCounts[c.repoKey] || 0) + 1;

    if (c.dateMs >= windowStart && c.dateMs <= windowEnd) {
      windowCommits.push(c);
    }
  }

  // Sort repos by cumulative count descending
  const sortedRepos = Object.entries(cumulativeCounts)
    .sort((a, b) => b[1] - a[1]);

  const topRepos = sortedRepos.slice(0, MAX_VISIBLE_REPOS);
  const otherRepos = sortedRepos.slice(MAX_VISIBLE_REPOS);
  const otherCount = otherRepos.reduce((sum, [, count]) => sum + count, 0);
  const otherRepoCount = otherRepos.length;

  const topRepoKeys = new Set(topRepos.map(([key]) => key));

  // Filter window commits to top repos only
  const visibleCommits = windowCommits.filter(c => topRepoKeys.has(c.repoKey));
  const otherCommits = windowCommits.filter(c => !topRepoKeys.has(c.repoKey));

  return {
    windowStart,
    windowEnd,
    topRepos,
    otherRepoCount,
    otherCount,
    visibleCommits,
    otherCommits,
    totalCommits: Object.values(cumulativeCounts).reduce((s, c) => s + c, 0),
  };
}

// ============================================================
// CANVAS SETUP
// ============================================================

function setupCanvas() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ============================================================
// RENDERING
// ============================================================

function drawFrame(frame, progress, currentDateMs) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const timelineWidth = W - MARGIN_LEFT - MARGIN_RIGHT;

  // Clear
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // --- Header ---
  ctx.fillStyle = '#fff';
  ctx.font = '14px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('PHILIPP FROMME — 10 YEARS', 20, 28);

  ctx.fillStyle = '#666';
  ctx.font = '10px "Courier New", monospace';
  ctx.fillText('CAMUNDA / BPMN.IO', 20, 46);

  // Current date
  ctx.fillStyle = '#0ff';
  ctx.font = '14px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(formatDate(currentDateMs), W / 2, 28);

  // Total commits
  ctx.fillStyle = '#fff';
  ctx.font = '14px "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${frame.totalCommits} commits`, W - 20, 28);

  // Elapsed time
  const elapsed = Math.floor(progress * TRACK_SECONDS);
  const timeStr = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  ctx.fillStyle = '#666';
  ctx.font = '10px "Courier New", monospace';
  ctx.fillText(timeStr, W - 20, 46);
  ctx.textAlign = 'left';

  // --- Window date range labels ---
  const y0 = HEADER_HEIGHT;
  ctx.fillStyle = '#444';
  ctx.font = '9px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(formatDate(frame.windowStart), MARGIN_LEFT, y0 + 10);
  ctx.textAlign = 'right';
  ctx.fillText(formatDate(frame.windowEnd), MARGIN_LEFT + timelineWidth, y0 + 10);
  ctx.textAlign = 'left';

  const lanesTop = y0 + 18;

  // --- Repo rows ---
  for (let i = 0; i < frame.topRepos.length; i++) {
    const [repoKey, count] = frame.topRepos[i];
    const rowY = lanesTop + i * (ROW_HEIGHT + ROW_GAP);

    // Row background
    ctx.fillStyle = i % 2 === 0 ? '#0a0a0a' : '#050505';
    ctx.fillRect(MARGIN_LEFT, rowY, timelineWidth, ROW_HEIGHT);

    // Repo label (left)
    const shortName = repoKey.split('/')[1] || repoKey;
    const displayName = shortName.length > 26 ? shortName.slice(0, 25) + '…' : shortName;
    ctx.fillStyle = repoColor(repoKey);
    ctx.font = '11px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(displayName, MARGIN_LEFT - 8, rowY + ROW_HEIGHT / 2 + 4);

    // Commit count (right)
    ctx.fillStyle = '#888';
    ctx.font = '11px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(count), MARGIN_LEFT + timelineWidth + 8, rowY + ROW_HEIGHT / 2 + 4);
    ctx.textAlign = 'left';

    // Draw commits in this row's window
    const repoCommits = frame.visibleCommits.filter(c => c.repoKey === repoKey);
    for (const c of repoCommits) {
      const cx = MARGIN_LEFT + ((c.dateMs - frame.windowStart) / VISIBLE_WINDOW_MS) * timelineWidth;
      const intensity = clamp(0.3 + (Math.log1p(c.linesChanged) / 8) * 0.7, 0.3, 1);

      // Commit tick
      if (c.linesChanged > 500) {
        ctx.fillStyle = `rgba(0,255,255,${intensity})`;
      } else {
        ctx.fillStyle = `rgba(255,255,255,${intensity * 0.7})`;
      }

      const barH = Math.max(ROW_HEIGHT * 0.6, 4);
      ctx.fillRect(cx - 0.6, rowY + (ROW_HEIGHT - barH) / 2, 1.5, barH);
    }
  }

  // --- "+N more repos" row ---
  if (frame.otherRepoCount > 0) {
    const otherRowY = lanesTop + frame.topRepos.length * (ROW_HEIGHT + ROW_GAP);

    ctx.fillStyle = '#080808';
    ctx.fillRect(MARGIN_LEFT, otherRowY, timelineWidth, ROW_HEIGHT);

    ctx.fillStyle = '#555';
    ctx.font = '11px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`+${frame.otherRepoCount} more repos`, MARGIN_LEFT - 8, otherRowY + ROW_HEIGHT / 2 + 4);

    // Count
    ctx.textAlign = 'left';
    ctx.fillText(String(frame.otherCount), MARGIN_LEFT + timelineWidth + 8, otherRowY + ROW_HEIGHT / 2 + 4);

    // Draw other commits faintly
    for (const c of frame.otherCommits) {
      const cx = MARGIN_LEFT + ((c.dateMs - frame.windowStart) / VISIBLE_WINDOW_MS) * timelineWidth;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      const barH = Math.max(ROW_HEIGHT * 0.4, 2);
      ctx.fillRect(cx - 0.4, otherRowY + (ROW_HEIGHT - barH) / 2, 1, barH);
    }
  }

  // --- Progress bar at bottom ---
  const barY = H - 4;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, barY, W, 4);
  ctx.fillStyle = '#0ff';
  ctx.fillRect(0, barY, W * progress, 4);
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
    return;
  }

  requestAnimationFrame(animate);
}

// ============================================================
// INIT
// ============================================================

async function init() {
  const loadingEl = document.getElementById('loading');
  const overlayEl = document.getElementById('start-overlay');

  try {
    await loadData();
    console.log(`Loaded ${commits.length} commits`);
  } catch (err) {
    loadingEl.textContent = 'FAILED TO LOAD DATA';
    console.error(err);
    return;
  }

  setupCanvas();

  // Hide loading, show overlay
  loadingEl.style.display = 'none';
  overlayEl.style.display = 'flex';

  // Start animation loop
  requestAnimationFrame(animate);

  // Wait for click to start
  overlayEl.addEventListener('click', () => {
    overlayEl.classList.add('hidden');
    playStartRealTime = performance.now();
    isPlaying = true;
    hasStarted = true;
    console.log('Playback started');
  }, { once: true });
}

init();
