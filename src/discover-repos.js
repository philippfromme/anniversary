/**
 * discover-repos.js
 *
 * Uses the GitHub Search API (commits) to discover every repo in the
 * configured orgs where the configured author has commits.
 *
 * Splits queries by year to stay under the 1000-result cap per query,
 * and uses the GitHub username (catches all email variants in one query).
 *
 * Writes out/repos.json — an array of { owner, repo, cloneUrl }.
 */

import { mkdir, writeFile, readFile } from "fs/promises";
import {
  GITHUB_TOKEN,
  ORGS,
  GITHUB_USERNAME,
  EMAILS,
  SINCE,
  UNTIL,
  OUT_DIR,
  REPOS_JSON,
} from "./config.js";

if (!GITHUB_TOKEN) {
  console.error("GITHUB_ACCESS_TOKEN is not set in .env");
  process.exit(1);
}

const headers = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github.cloak-preview+json", // commit search preview
  "User-Agent": "anniversary-script",
};

async function searchCommits(query, page = 1) {
  const url = new URL("https://api.github.com/search/commits");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));

  const res = await fetch(url, { headers });

  if (res.status === 422) {
    return { total_count: 0, items: [] };
  }

  if (res.status === 403 || res.status === 429) {
    // Rate limited — check for Retry-After header
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter) {
      const waitSec = parseInt(retryAfter, 10) || 60;
      console.warn(`  Rate limited. Waiting ${waitSec}s (Retry-After)...`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      return searchCommits(query, page); // retry
    }

    // Check X-RateLimit-Reset
    const resetHeader = res.headers.get("x-ratelimit-reset");
    if (resetHeader) {
      const resetTime = parseInt(resetHeader, 10) * 1000;
      const waitMs = Math.max(resetTime - Date.now(), 1000);
      const waitSec = Math.ceil(waitMs / 1000);
      console.warn(`  Rate limited. Waiting ${waitSec}s (until reset)...`);
      await new Promise((r) => setTimeout(r, waitMs + 1000));
      return searchCommits(query, page); // retry
    }

    return { rate_limited: true, total_count: 0, items: [] };
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }

  return res.json();
}

/**
 * Build year ranges from SINCE to UNTIL
 * e.g. ["2016-04-01..2017-03-31", "2017-04-01..2018-03-31", ...]
 */
function buildYearRanges() {
  const ranges = [];
  const start = new Date(SINCE);
  const end = new Date(UNTIL);

  let cursor = new Date(start);
  while (cursor < end) {
    const rangeEnd = new Date(cursor);
    rangeEnd.setFullYear(rangeEnd.getFullYear() + 1);
    if (rangeEnd > end) {
      rangeEnd.setTime(end.getTime());
    }
    const from = cursor.toISOString().slice(0, 10);
    const to = rangeEnd.toISOString().slice(0, 10);
    ranges.push(`${from}..${to}`);
    cursor = rangeEnd;
  }
  return ranges;
}

async function discoverRepos() {
  const repoSet = new Map(); // "owner/repo" → { owner, repo, cloneUrl }
  let rateLimited = false;

  // Load existing repos.json to merge (supports resuming after rate limit)
  try {
    const existing = JSON.parse(await readFile(REPOS_JSON, "utf-8"));
    for (const r of existing) {
      repoSet.set(`${r.owner}/${r.repo}`, r);
    }
    console.log(`Loaded ${repoSet.size} previously discovered repos.\n`);
  } catch {
    // No existing file, start fresh
  }

  const yearRanges = buildYearRanges();
  console.log(
    `Using ${yearRanges.length} year ranges × ${ORGS.length} orgs = ${yearRanges.length * ORGS.length} queries\n`,
  );

  // Strategy 1: search by GitHub username (catches all email variants)
  for (const org of ORGS) {
    for (const range of yearRanges) {
      const query = `org:${org} author:${GITHUB_USERNAME} author-date:${range}`;
      console.log(`  ${query}`);

      let page = 1;
      let totalFetched = 0;

      while (true) {
        const data = await searchCommits(query, page);

        if (data.rate_limited) {
          console.warn(`  Rate limited! Saving partial results.`);
          rateLimited = true;
          break;
        }

        const items = data.items || [];

        for (const item of items) {
          const fullName = item.repository.full_name;
          if (!repoSet.has(fullName)) {
            const [owner, repo] = fullName.split("/");
            repoSet.set(fullName, {
              owner,
              repo,
              cloneUrl: `https://github.com/${fullName}.git`,
            });
            console.log(`    + ${fullName} (NEW)`);
          }
        }

        totalFetched += items.length;

        if (items.length < 100 || totalFetched >= (data.total_count || 0)) {
          break;
        }

        page++;
        await new Promise((r) => setTimeout(r, 500));
      }

      if (rateLimited) break;

      // Stay within search rate limit (30 req/min)
      await new Promise((r) => setTimeout(r, 2200));
    }

    if (rateLimited) break;
  }

  // Strategy 2: also search by email (catches commits where username
  // doesn't match the GitHub account, e.g. old/misconfigured git setups)
  if (!rateLimited) {
    for (const org of ORGS) {
      for (const email of EMAILS) {
        const query = `org:${org} author-email:${email}`;
        console.log(`  ${query} (email fallback)`);

        let page = 1;
        let totalFetched = 0;

        while (true) {
          const data = await searchCommits(query, page);

          if (data.rate_limited) {
            console.warn(`  Rate limited! Saving partial results.`);
            rateLimited = true;
            break;
          }

          const items = data.items || [];

          for (const item of items) {
            const fullName = item.repository.full_name;
            if (!repoSet.has(fullName)) {
              const [owner, repo] = fullName.split("/");
              repoSet.set(fullName, {
                owner,
                repo,
                cloneUrl: `https://github.com/${fullName}.git`,
              });
              console.log(`    + ${fullName} (NEW, email fallback)`);
            }
          }

          totalFetched += items.length;

          if (items.length < 100 || totalFetched >= (data.total_count || 0)) {
            break;
          }

          page++;
          await new Promise((r) => setTimeout(r, 500));
        }

        if (rateLimited) break;
        await new Promise((r) => setTimeout(r, 2200));
      }

      if (rateLimited) break;
    }
  }

  console.log(`\nTotal unique repos: ${repoSet.size}`);

  const repos = [...repoSet.values()].sort((a, b) =>
    `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`),
  );

  return { repos, rateLimited };
}

async function main() {
  console.log("Discovering repos...\n");

  await mkdir(OUT_DIR, { recursive: true });

  const { repos, rateLimited } = await discoverRepos();

  await writeFile(REPOS_JSON, JSON.stringify(repos, null, 2));

  console.log(`\nDiscovered ${repos.length} repos. Written to ${REPOS_JSON}`);
  console.log(repos.map((r) => `  ${r.owner}/${r.repo}`).join("\n"));

  if (rateLimited) {
    console.log(
      "\n⚠ Rate limited before finishing. Run again later to discover remaining repos.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
