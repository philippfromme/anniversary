/**
 * markdown.js — generates a summary markdown file from commits.json
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import { COMMITS_JSON, OUT_DIR, SINCE, UNTIL } from "./config.js";

async function main() {
  const raw = await readFile(COMMITS_JSON, "utf-8");
  const commits = JSON.parse(raw);

  if (!commits.length) {
    console.error("No commits found in commits.json");
    process.exit(1);
  }

  const startYear = new Date(SINCE).getFullYear();
  const endYear = new Date(UNTIL).getFullYear();

  // --- Aggregate stats ---
  const repoStats = {};

  for (const c of commits) {
    const key = `${c.owner}/${c.repo}`;
    if (!repoStats[key]) {
      repoStats[key] = {
        owner: c.owner,
        repo: c.repo,
        commits: 0,
        added: 0,
        deleted: 0,
        filesTouched: 0,
        firstCommit: c.date,
        lastCommit: c.date,
      };
    }
    const s = repoStats[key];
    s.commits++;
    s.added += c.totalAdded;
    s.deleted += c.totalDeleted;
    s.filesTouched += c.filesTouched;
    if (c.date < s.firstCommit) s.firstCommit = c.date;
    if (c.date > s.lastCommit) s.lastCommit = c.date;
  }

  const sorted = Object.values(repoStats).sort((a, b) => b.commits - a.commits);

  const totalCommits = sorted.reduce((s, r) => s + r.commits, 0);
  const totalAdded = sorted.reduce((s, r) => s + r.added, 0);
  const totalDeleted = sorted.reduce((s, r) => s + r.deleted, 0);
  const totalFiles = sorted.reduce((s, r) => s + r.filesTouched, 0);

  // --- Year breakdown ---
  const yearCounts = {};
  for (const c of commits) {
    const year = new Date(c.date).getFullYear();
    yearCounts[year] = (yearCounts[year] || 0) + 1;
  }

  // --- Build markdown ---
  const lines = [];

  lines.push(`# 10 Years at Camunda — Commit Summary`);
  lines.push(``);
  lines.push(
    `> ${startYear}–${endYear} · ${totalCommits.toLocaleString()} commits · ${sorted.length} repos`,
  );
  lines.push(``);

  // Overall stats
  lines.push(`## Overview`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total commits | ${totalCommits.toLocaleString()} |`);
  lines.push(`| Total repos | ${sorted.length} |`);
  lines.push(`| Lines added | ${totalAdded.toLocaleString()} |`);
  lines.push(`| Lines deleted | ${totalDeleted.toLocaleString()} |`);
  lines.push(`| Files touched | ${totalFiles.toLocaleString()} |`);
  lines.push(``);

  // Commits per year
  lines.push(`## Commits per Year`);
  lines.push(``);
  lines.push(`| Year | Commits |`);
  lines.push(`| --- | --- |`);
  for (let year = startYear; year <= endYear; year++) {
    const count = yearCounts[year] || 0;
    lines.push(`| ${year} | ${count.toLocaleString()} |`);
  }
  lines.push(``);

  // Full repo ranking
  lines.push(`## Repo Ranking`);
  lines.push(``);
  lines.push(
    `| # | Repo | Commits | Lines added | Lines deleted | Files touched | First commit | Last commit |`,
  );
  lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const first = r.firstCommit.slice(0, 10);
    const last = r.lastCommit.slice(0, 10);
    lines.push(
      `| ${i + 1} | ${r.owner}/${r.repo} | ${r.commits.toLocaleString()} | ${r.added.toLocaleString()} | ${r.deleted.toLocaleString()} | ${r.filesTouched.toLocaleString()} | ${first} | ${last} |`,
    );
  }

  lines.push(``);

  // --- Fun facts ---
  lines.push(`## Fun Facts`);
  lines.push(``);

  // Repos where more lines were deleted than added (true 10x developer move)
  const netDeleters = sorted
    .filter((r) => r.deleted > r.added)
    .sort((a, b) => b.deleted - b.added - (a.deleted - a.added));
  if (netDeleters.length) {
    const top = netDeleters[0];
    lines.push(
      `- **Net negative engineer**: Deleted more lines than added in ${netDeleters.length} repo${netDeleters.length > 1 ? "s" : ""}. Top offender: **${top.repo}** (${top.added.toLocaleString()} added vs ${top.deleted.toLocaleString()} deleted = ${(top.deleted - top.added).toLocaleString()} lines vaporized). Truly a 10x developer. 🗑️`,
    );
  }

  // Busiest single day
  const dayCounts = {};
  for (const c of commits) {
    const day = c.date.slice(0, 10);
    dayCounts[day] = (dayCounts[day] || 0) + 1;
  }
  const busiestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
  if (busiestDay) {
    lines.push(
      `- **Busiest day**: ${busiestDay[0]} with ${busiestDay[1]} commits. Somebody had coffee. ☕`,
    );
  }

  // Longest streak of consecutive days with commits
  const allDays = Object.keys(dayCounts).sort();
  let longestStreak = 1;
  let currentStreak = 1;
  let streakStart = allDays[0];
  let longestStreakStart = allDays[0];
  for (let i = 1; i < allDays.length; i++) {
    const prev = new Date(allDays[i - 1]).getTime();
    const curr = new Date(allDays[i]).getTime();
    if (curr - prev === 86400000) {
      currentStreak++;
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
        longestStreakStart = streakStart;
      }
    } else {
      currentStreak = 1;
      streakStart = allDays[i];
    }
  }
  lines.push(
    `- **Longest streak**: ${longestStreak} consecutive days with commits (starting ${longestStreakStart}). 🔥`,
  );

  // Busiest year
  const busiestYear = Object.entries(yearCounts).sort((a, b) => b[1] - a[1])[0];
  if (busiestYear) {
    lines.push(
      `- **Busiest year**: ${busiestYear[0]} with ${busiestYear[1]} commits. 📈`,
    );
  }

  // Most lines added in a single commit
  const biggestCommit = [...commits].sort(
    (a, b) => b.totalAdded + b.totalDeleted - (a.totalAdded + a.totalDeleted),
  )[0];
  if (biggestCommit) {
    lines.push(
      `- **Biggest single commit**: ${biggestCommit.totalAdded.toLocaleString()} added + ${biggestCommit.totalDeleted.toLocaleString()} deleted in **${biggestCommit.repo}** ("${biggestCommit.subject.slice(0, 60)}"). 💣`,
    );
  }

  // Most repos contributed to in a single day
  const dayRepos = {};
  for (const c of commits) {
    const day = c.date.slice(0, 10);
    if (!dayRepos[day]) dayRepos[day] = new Set();
    dayRepos[day].add(`${c.owner}/${c.repo}`);
  }
  const mostReposDay = Object.entries(dayRepos).sort(
    (a, b) => b[1].size - a[1].size,
  )[0];
  if (mostReposDay) {
    lines.push(
      `- **Most repos in a day**: ${mostReposDay[1].size} repos on ${mostReposDay[0]}. Context-switching champion. 🏆`,
    );
  }

  // Weekend warrior
  let weekendCommits = 0;
  for (const c of commits) {
    const day = new Date(c.date).getDay();
    if (day === 0 || day === 6) weekendCommits++;
  }
  const weekendPct = ((weekendCommits / totalCommits) * 100).toFixed(1);
  lines.push(
    `- **Weekend warrior**: ${weekendCommits} commits on weekends (${weekendPct}% of total). Work-life balance is overrated. 🏖️`,
  );

  // One-hit wonders: repos with exactly 1 commit
  const oneHitWonders = sorted.filter((r) => r.commits === 1);
  if (oneHitWonders.length) {
    lines.push(
      `- **One-hit wonders**: ${oneHitWonders.length} repos with exactly 1 commit. Hit it and quit it. 🎤`,
    );
  }

  lines.push(``);

  const md = lines.join("\n");

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, "anniversary.md");
  await writeFile(outPath, md);

  console.log(`Markdown summary written to ${outPath}`);
  console.log(`  ${totalCommits} commits across ${sorted.length} repos`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
