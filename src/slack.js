/**
 * slack.js — generates a Slack message from commits.json
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import { COMMITS_JSON, OUT_DIR, SINCE, UNTIL } from "./config.js";

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toLocaleString();
}

async function main() {
  const raw = await readFile(COMMITS_JSON, "utf-8");
  const commits = JSON.parse(raw);

  if (!commits.length) {
    console.error("No commits found in commits.json");
    process.exit(1);
  }

  const startYear = new Date(SINCE).getFullYear();
  const endYear = new Date(UNTIL).getFullYear();
  const years = endYear - startYear;

  // --- Aggregate stats ---
  const repos = new Set();
  let totalAdded = 0;
  let totalDeleted = 0;

  const dayCounts = {};
  const dayRepos = {};
  const yearCounts = {};

  for (const c of commits) {
    repos.add(`${c.owner}/${c.repo}`);
    totalAdded += c.totalAdded;
    totalDeleted += c.totalDeleted;

    const day = c.date.slice(0, 10);
    dayCounts[day] = (dayCounts[day] || 0) + 1;

    if (!dayRepos[day]) dayRepos[day] = new Set();
    dayRepos[day].add(`${c.owner}/${c.repo}`);

    const year = new Date(c.date).getFullYear();
    yearCounts[year] = (yearCounts[year] || 0) + 1;
  }

  // Busiest day
  const busiestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];

  // Most repos in a day
  const mostReposDay = Object.entries(dayRepos).sort(
    (a, b) => b[1].size - a[1].size,
  )[0];

  // Repos where more deleted than added
  const repoStats = {};
  for (const c of commits) {
    const key = `${c.owner}/${c.repo}`;
    if (!repoStats[key]) repoStats[key] = { added: 0, deleted: 0 };
    repoStats[key].added += c.totalAdded;
    repoStats[key].deleted += c.totalDeleted;
  }
  const netDeleters = Object.values(repoStats).filter(
    (r) => r.deleted > r.added,
  );

  // Busiest year
  const busiestYear = Object.entries(yearCounts).sort((a, b) => b[1] - a[1])[0];

  // --- Build message ---
  const lines = [];

  lines.push(`🎉 ${years} years at Camunda today!`);
  lines.push(``);
  lines.push(
    `To celebrate, I built a little visualization of my entire git history across bpmn-io and camunda orgs.`,
  );
  lines.push(``);
  lines.push(`The numbers:`);
  lines.push(
    `📊 ${commits.length.toLocaleString()} commits · ${repos.size} repos · ${formatNumber(totalAdded)} lines added · ${formatNumber(totalDeleted)} deleted`,
  );
  lines.push(``);
  lines.push(`Some fun facts:`);
  lines.push(`☕ Busiest day: ${busiestDay[1]} commits on ${busiestDay[0]}`);
  lines.push(
    `🏆 Most context-switching: ${mostReposDay[1].size} repos in a single day`,
  );
  lines.push(
    `🗑️ Deleted more lines than I added in ${netDeleters.length} repos — truly a 10x developer`,
  );
  lines.push(
    `📈 Busiest year: ${busiestYear[0]} with ${busiestYear[1]} commits`,
  );
  lines.push(``);
  lines.push(
    `👉 Interactive player: https://philippfromme.github.io/anniversary/`,
  );
  lines.push(`👉 Repo: https://github.com/philippfromme/anniversary`);

  const msg = lines.join("\n");

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, "slack.md");
  await writeFile(outPath, msg);

  console.log(`Slack message written to ${outPath}`);
  console.log();
  console.log(msg);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
