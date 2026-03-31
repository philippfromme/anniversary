/**
 * svg.js — printable timeline poster
 *
 * Aesthetic: Dieter Rams / Bauhaus
 *   - warm off-white background (#f5f3f0)
 *   - black type, Space Mono
 *   - 4-level green commit squares (GitHub-style)
 *   - top 20 repos by commit count + "+N more" summary
 *   - clean geometric rules, no decoration
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import { COMMITS_JSON, OUT_DIR, SINCE, UNTIL } from "./config.js";

// --- Palette (matches web player) ---
const BG = "#f5f3f0";
const FG = "#1a1a1a";
const FG_SEC = "#6b6b6b";
const FG_TER = "#a0a0a0";
const RULE = "#d0ccc6";
const ACCENT = "#ff0000";

const TEMP_COLORS = ["#9be9a8", "#40c463", "#30a14e", "#216e39"];

// --- Layout ---
const MARGIN = { top: 80, right: 80, bottom: 60, left: 200 };
const ROW_HEIGHT = 32;
const MAX_VISIBLE_REPOS = 20;
const BAR_WIDTH = 8;
const HEADER_HEIGHT = 12;
const FONT = "'Space Mono', monospace";

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

function tempColor(linesChanged) {
  const t = clamp(Math.log1p(linesChanged) / 7, 0, 1);
  return TEMP_COLORS[Math.min(Math.floor(t * 4), 3)];
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
  const sortedRepos = Object.entries(repoCounts).sort((a, b) => b[1] - a[1]);

  const topRepos = sortedRepos.slice(0, MAX_VISIBLE_REPOS);
  const otherRepos = sortedRepos.slice(MAX_VISIBLE_REPOS);
  const otherCount = otherRepos.reduce((sum, [, count]) => sum + count, 0);
  const topRepoKeys = new Set(topRepos.map(([key]) => key));

  const totalRows = topRepos.length + (otherRepos.length > 0 ? 1 : 0);

  // Dimensions
  const plotWidth = 1200;
  const lanesHeight = totalRows * ROW_HEIGHT;
  const plotHeight = HEADER_HEIGHT + lanesHeight;
  const totalWidth = MARGIN.left + plotWidth + MARGIN.right;
  const totalHeight = MARGIN.top + plotHeight + MARGIN.bottom;

  const headerTop = MARGIN.top;
  const lanesTop = MARGIN.top + HEADER_HEIGHT;

  const elements = [];

  // Background
  elements.push(
    `<rect width="${totalWidth}" height="${totalHeight}" fill="${BG}" />`,
  );

  // Google Fonts reference (for rendering outside browser, embed font)
  elements.push(
    `<style>@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700');</style>`,
  );

  // ── Title ──
  elements.push(
    `<text x="${MARGIN.left}" y="${MARGIN.top - 40}" fill="${FG}" font-family="${FONT}" font-size="24" font-weight="700">10 years x 1 developer = 10X developer</text>`,
  );
  elements.push(
    `<text x="${MARGIN.left}" y="${MARGIN.top - 18}" fill="${FG_SEC}" font-family="${FONT}" font-size="11">${commits.length} commits · ${sortedRepos.length} repos · 2016–2026</text>`,
  );

  // ── Header rule ──
  elements.push(
    `<rect x="${MARGIN.left}" y="${headerTop}" width="${plotWidth}" height="2" fill="${FG}" />`,
  );

  // ── Year grid lines ──
  for (let year = 2016; year <= 2026; year++) {
    const yearMs = new Date(`${year}-04-01`).getTime();
    const t = (yearMs - startMs) / rangeMs;
    const x = MARGIN.left + t * plotWidth;

    elements.push(
      `<line x1="${x}" y1="${lanesTop}" x2="${x}" y2="${lanesTop + lanesHeight}" stroke="${RULE}" stroke-width="0.5" />`,
    );

    elements.push(
      `<text x="${x}" y="${lanesTop + lanesHeight + 16}" text-anchor="middle" fill="${FG_TER}" font-family="${FONT}" font-size="9">${year}</text>`,
    );
  }

  // ── Per-repo lanes ──
  for (let i = 0; i < topRepos.length; i++) {
    const [repoKey, count] = topRepos[i];
    const rowY = lanesTop + i * ROW_HEIGHT;

    // Alternating background
    if (i % 2 === 0) {
      elements.push(
        `<rect x="${MARGIN.left}" y="${rowY}" width="${plotWidth}" height="${ROW_HEIGHT}" fill="rgba(0,0,0,0.02)" />`,
      );
    }

    // Bottom border
    const borderColor = i === 0 ? FG : RULE;
    const borderH = i === 0 ? 1.5 : 0.5;
    elements.push(
      `<rect x="${MARGIN.left}" y="${rowY + ROW_HEIGHT}" width="${plotWidth}" height="${borderH}" fill="${borderColor}" />`,
    );

    // Repo name
    const shortName = repoKey.split("/")[1] || repoKey;
    const displayName =
      shortName.length > 26 ? shortName.slice(0, 25) + "…" : shortName;
    const shade = i === 0 ? FG : i < 5 ? FG_SEC : FG_TER;
    const weight = i === 0 ? "700" : "400";
    const fontSize = i === 0 ? 12 : 11;
    elements.push(
      `<text x="${MARGIN.left - 10}" y="${rowY + ROW_HEIGHT / 2 + 4}" text-anchor="end" fill="${shade}" font-family="${FONT}" font-size="${fontSize}" font-weight="${weight}">${escapeXml(displayName)}</text>`,
    );

    // Commit count (right)
    elements.push(
      `<text x="${MARGIN.left + plotWidth + 8}" y="${rowY + ROW_HEIGHT / 2 + 4}" fill="${FG_TER}" font-family="${FONT}" font-size="11">${count}</text>`,
    );

    // Commit bars — temperature colored, deduped by pixel
    const repoCommits = commits
      .filter((c) => `${c.owner}/${c.repo}` === repoKey)
      .map((c) => {
        const commitMs = new Date(c.date).getTime();
        const t = (commitMs - startMs) / rangeMs;
        const linesChanged = c.totalAdded + c.totalDeleted;
        return { x: MARGIN.left + t * plotWidth, linesChanged };
      })
      .filter((c) => c.x >= MARGIN.left && c.x <= MARGIN.left + plotWidth)
      .sort((a, b) => b.linesChanged - a.linesChanged);

    const barH = BAR_WIDTH;
    const barY = Math.round(rowY + (ROW_HEIGHT - barH) / 2);
    const drawnXs = [];
    for (const c of repoCommits) {
      const tooClose = drawnXs.some((dx) => Math.abs(dx - c.x) < BAR_WIDTH);
      if (tooClose) continue;
      drawnXs.push(c.x);
      const color = tempColor(c.linesChanged);
      elements.push(
        `<rect x="${(c.x - BAR_WIDTH / 2).toFixed(1)}" y="${barY}" width="${BAR_WIDTH}" height="${barH}" fill="${color}">` +
          `<title>${escapeXml(repoKey)}: +${c.linesChanged} lines</title>` +
          `</rect>`,
      );
    }
  }

  // ── "+N more repos" row ──
  if (otherRepos.length > 0) {
    const otherRowY = lanesTop + topRepos.length * ROW_HEIGHT;

    elements.push(
      `<text x="${MARGIN.left - 10}" y="${otherRowY + ROW_HEIGHT / 2 + 4}" text-anchor="end" fill="${FG_TER}" font-family="${FONT}" font-size="11">+${otherRepos.length} more</text>`,
    );

    elements.push(
      `<text x="${MARGIN.left + plotWidth + 8}" y="${otherRowY + ROW_HEIGHT / 2 + 4}" fill="${FG_TER}" font-family="${FONT}" font-size="11">${otherCount}</text>`,
    );

    // Faint commit ticks for other repos
    const otherCommits = commits.filter(
      (c) => !topRepoKeys.has(`${c.owner}/${c.repo}`),
    );
    for (const c of otherCommits) {
      const commitMs = new Date(c.date).getTime();
      const t = (commitMs - startMs) / rangeMs;
      const x = MARGIN.left + t * plotWidth;
      if (x < MARGIN.left || x > MARGIN.left + plotWidth) continue;
      elements.push(
        `<rect x="${x.toFixed(1)}" y="${otherRowY + ROW_HEIGHT * 0.3}" width="1" height="${ROW_HEIGHT * 0.4}" fill="${RULE}" />`,
      );
    }
  }

  // ── Bottom rule ──
  elements.push(
    `<rect x="${MARGIN.left}" y="${lanesTop + lanesHeight}" width="${plotWidth}" height="1" fill="${FG}" />`,
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
  console.log(`  Top repos: ${topRepos.length}`);
  console.log(`  Other repos: ${otherRepos.length}`);
  console.log(`  Commits: ${commits.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
