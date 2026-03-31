/**
 * clone-repos.js
 *
 * Reads out/repos.json and clones (or fetches) each repo into repos/<owner>/<repo>.
 * Full history is required for git log analysis.
 */

import { mkdir, access, readFile } from "fs/promises";
import { resolve } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import pLimit from "p-limit";
import { REPOS_DIR, REPOS_JSON, CONCURRENCY } from "./config.js";

const exec = promisify(execFile);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function cloneOrFetch(repo) {
  const dir = resolve(REPOS_DIR, repo.owner, repo.repo);

  if (await exists(resolve(dir, ".git"))) {
    console.log(`  Fetching ${repo.owner}/${repo.repo}...`);
    try {
      await exec("git", ["fetch", "--all", "--prune"], {
        cwd: dir,
        timeout: 120_000,
      });
    } catch (err) {
      console.warn(
        `  Warning: fetch failed for ${repo.owner}/${repo.repo}: ${err.message}`,
      );
    }
  } else {
    console.log(`  Cloning ${repo.owner}/${repo.repo}...`);
    await mkdir(resolve(REPOS_DIR, repo.owner), { recursive: true });
    try {
      await exec("git", ["clone", "--", repo.cloneUrl, dir], {
        timeout: 300_000,
      });
    } catch (err) {
      console.warn(
        `  Warning: clone failed for ${repo.owner}/${repo.repo}: ${err.message}`,
      );
    }
  }
}

async function main() {
  const raw = await readFile(REPOS_JSON, "utf-8");
  const repos = JSON.parse(raw);

  console.log(
    `Cloning/fetching ${repos.length} repos (concurrency: ${CONCURRENCY})...\n`,
  );
  await mkdir(REPOS_DIR, { recursive: true });

  const limit = pLimit(CONCURRENCY);
  await Promise.all(repos.map((repo) => limit(() => cloneOrFetch(repo))));

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
