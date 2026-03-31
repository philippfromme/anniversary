/**
 * svg.js — printable timeline poster
 *
 * Aesthetic: Ryoji Ikeda "datamatics" / "test pattern"
 *   - pure black background
 *   - white monochrome data bars (commits as thin vertical lines)
 *   - barcode / spectrogram density per repo lane
 *   - minimal monospace typography
 *   - summary "pulse" row at top showing all commits overlaid
 *   - subtle cyan (#0ff) accent for extreme commits
 *
 * Layout:
 *   X axis = time (2016 → 2026)
 *   Y axis = repo lane (sorted by commit count)
 *   Each commit = a thin vertical bar within its repo lane
 *     brightness (opacity) → lines changed
 *     width     → 1px (creates natural density from overlap)
 *     accent    → cyan tint for commits > 500 lines
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import { COMMITS_JSON, OUT_DIR, SINCE, UNTIL } from "./config.js";

// --- Layout ---
const MARGIN = { top: 120, right: 40, bottom: 60, left: 200 };
const LANE_HEIGHT = 16;
const PULSE_HEIGHT = 40; // summary row at top
const GAP = 12; // gap between pulse row and repo lanes
const BAR_WIDTH = 1.2;
const MIN_OPACITY = 0.15;
const MAX_OPACITY = 0.95;

function stableHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

async function main() {
  const raw = await readFile(COMMITS_JSON, "utf-8");
  const commits = JSON.parse(raw);

  if (!commits.length) {
    console.error("No commits found in commits.json");
    process.exit(1);
  }

  console.log(`Generating SVG poster from ${commits.length} commits...\n`);

  const startMs = new Date(SINCE).getTime();
  const endMs = new Date(UNTIL).getTime();
  const rangeMs = endMs - startMs;

  // Count commits per repo, sort descending
  const repoCounts = {};
  for (const c of commits) {
    const key = `${c.owner}/${c.repo}`;
    repoCounts[key] = (repoCounts[key] || 0) + 1;
  }
  const sortedRepos = Object.entries(repoCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const repoIndex = {};
  sortedRepos.forEach((name, i) => (repoIndex[name] = i));

  // Dimensions
  const plotWidth = 1200;
  const lanesHeight = sortedRepos.length * LANE_HEIGHT;
  const plotHeight = PULSE_HEIGHT + GAP + lanesHeight;
  const totalWidth = MARGIN.left + plotWidth + MARGIN.right;
  const totalHeight = MARGIN.top + plotHeight + MARGIN.bottom;

  const lanesTop = MARGIN.top + PULSE_HEIGHT + GAP;

  const elements = [];

  // Background — pure black
  elements.push(
    `<rect width="${totalWidth}" height="${totalHeight}" fill="#000" />`,
  );

  // Title
  elements.push(
    `<text x="${totalWidth / 2}" y="36" text-anchor="middle" fill="#fff" font-family="'Courier New', monospace" font-size="20" font-weight="bold" letter-spacing="4">PHILIPP FROMME</text>`,
  );
  elements.push(
    `<text x="${totalWidth / 2}" y="58" text-anchor="middle" fill="#666" font-family="'Courier New', monospace" font-size="11" letter-spacing="2">10 YEARS — CAMUNDA / BPMN.IO</text>`,
  );
  elements.push(
    `<text x="${totalWidth / 2}" y="76" text-anchor="middle" fill="#444" font-family="'Courier New', monospace" font-size="9" letter-spacing="1">2016-04-01 → 2026-04-01 · ${commits.length} COMMITS · ${sortedRepos.length} REPOS</text>`,
  );

  // Year grid lines
  for (let year = 2016; year <= 2026; year++) {
    const yearMs = new Date(`${year}-04-01`).getTime();
    const t = (yearMs - startMs) / rangeMs;
    const x = MARGIN.left + t * plotWidth;

    // Full height grid line
    elements.push(
      `<line x1="${x}" y1="${MARGIN.top}" x2="${x}" y2="${MARGIN.top + plotHeight}" stroke="#1a1a1a" stroke-width="0.5" />`,
    );

    // Year label
    elements.push(
      `<text x="${x}" y="${MARGIN.top + plotHeight + 16}" text-anchor="middle" fill="#444" font-family="'Courier New', monospace" font-size="9">${year}</text>`,
    );
  }

  // --- Summary pulse row (top) ---
  // All commits overlaid — shows overall activity density
  elements.push(
    `<text x="${MARGIN.left - 8}" y="${MARGIN.top + PULSE_HEIGHT / 2 + 3}" text-anchor="end" fill="#666" font-family="'Courier New', monospace" font-size="8">ALL</text>`,
  );

  // Thin border for pulse row
  elements.push(
    `<rect x="${MARGIN.left}" y="${MARGIN.top}" width="${plotWidth}" height="${PULSE_HEIGHT}" fill="none" stroke="#111" stroke-width="0.5" />`,
  );

  for (const commit of commits) {
    const commitMs = new Date(commit.date).getTime();
    const t = (commitMs - startMs) / rangeMs;
    if (t < 0 || t > 1) continue;

    const x = MARGIN.left + t * plotWidth;
    const linesChanged = commit.totalAdded + commit.totalDeleted;
    const intensity = clamp(
      MIN_OPACITY +
        (Math.log1p(linesChanged) / 8) * (MAX_OPACITY - MIN_OPACITY),
      MIN_OPACITY,
      MAX_OPACITY,
    );

    // Height proportional to intensity within pulse row
    const barH = clamp(4 + Math.log1p(linesChanged) * 3, 4, PULSE_HEIGHT);
    const barY = MARGIN.top + (PULSE_HEIGHT - barH) / 2;

    // Cyan accent for extreme commits (>500 lines)
    const color =
      linesChanged > 500
        ? `rgba(0,255,255,${intensity})`
        : `rgba(255,255,255,${intensity * 0.7})`;

    elements.push(
      `<rect x="${x.toFixed(1)}" y="${barY.toFixed(1)}" width="${BAR_WIDTH}" height="${barH.toFixed(1)}" fill="${color}" />`,
    );
  }

  // --- Per-repo lanes ---
  for (let i = 0; i < sortedRepos.length; i++) {
    const name = sortedRepos[i];
    const laneY = lanesTop + i * LANE_HEIGHT;

    // Thin horizontal separator
    elements.push(
      `<line x1="${MARGIN.left}" y1="${laneY}" x2="${MARGIN.left + plotWidth}" y2="${laneY}" stroke="#0a0a0a" stroke-width="0.5" />`,
    );

    // Repo label (truncated)
    const shortName = name.split("/")[1] || name;
    const displayName =
      shortName.length > 24 ? shortName.slice(0, 23) + "…" : shortName;
    elements.push(
      `<text x="${MARGIN.left - 8}" y="${laneY + LANE_HEIGHT / 2 + 3}" text-anchor="end" fill="#333" font-family="'Courier New', monospace" font-size="7">${escapeXml(displayName)}</text>`,
    );
  }

  // Commit bars per repo lane
  for (const commit of commits) {
    const commitMs = new Date(commit.date).getTime();
    const t = (commitMs - startMs) / rangeMs;
    if (t < 0 || t > 1) continue;

    const repoName = `${commit.owner}/${commit.repo}`;
    const lane = repoIndex[repoName];
    if (lane === undefined) continue;

    const x = MARGIN.left + t * plotWidth;
    const laneY = lanesTop + lane * LANE_HEIGHT;
    const linesChanged = commit.totalAdded + commit.totalDeleted;

    const intensity = clamp(
      MIN_OPACITY +
        (Math.log1p(linesChanged) / 8) * (MAX_OPACITY - MIN_OPACITY),
      MIN_OPACITY,
      MAX_OPACITY,
    );

    // Bar fills lane height
    const barH = LANE_HEIGHT - 2;
    const barY = laneY + 1;

    // White bars; cyan accent for large commits
    const color =
      linesChanged > 500
        ? `rgba(0,255,255,${intensity})`
        : `rgba(255,255,255,${intensity * 0.6})`;

    elements.push(
      `<rect x="${x.toFixed(1)}" y="${barY.toFixed(1)}" width="${BAR_WIDTH}" height="${barH}" fill="${color}">` +
        `<title>${escapeXml(repoName)}: ${escapeXml(commit.subject)} (${commit.date.slice(0, 10)}, +${commit.totalAdded}/-${commit.totalDeleted})</title>` +
        `</rect>`,
    );
  }

  // Bottom border
  elements.push(
    `<line x1="${MARGIN.left}" y1="${lanesTop + lanesHeight}" x2="${MARGIN.left + plotWidth}" y2="${lanesTop + lanesHeight}" stroke="#111" stroke-width="0.5" />`,
  );

  // Assemble SVG
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`,
    ...elements,
    `</svg>`,
  ].join("\n");

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, "anniversary.svg");
  await writeFile(outPath, svg);

  console.log(`SVG written to ${outPath}`);
  console.log(`  Dimensions: ${totalWidth} × ${totalHeight}`);
  console.log(`  Repos: ${sortedRepos.length}`);
  console.log(`  Commits: ${commits.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
