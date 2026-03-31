/**
 * extract.js
 *
 * Reads out/repos.json, walks each cloned repo, runs git log filtered by
 * author emails, and writes out/commits.json with all commit data.
 */

import { readFile, writeFile, access, readdir, mkdir } from "fs/promises";
import { resolve } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import pLimit from "p-limit";
import {
  EMAILS,
  SINCE,
  UNTIL,
  REPOS_DIR,
  OUT_DIR,
  REPOS_JSON,
  COMMITS_JSON,
  CONCURRENCY,
} from "./config.js";

const exec = promisify(execFile);

const SEPARATOR = "---GIT-SYMPHONY-SEP---";
const FORMAT = ["%H", "%aI", "%ae", "%an", "%s"].join("|");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseGitLog(output, owner, repo) {
  const commits = [];
  const blocks = output.split(SEPARATOR).filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (!lines.length) continue;

    const headerLine = lines[0];
    const pipeIndex = headerLine.indexOf("|");
    if (pipeIndex === -1) continue;

    const parts = headerLine.split("|");
    if (parts.length < 5) continue;

    const [hash, date, email, author, ...subjectParts] = parts;
    const subject = subjectParts.join("|"); // subject may contain pipes

    // Verify email matches (case-insensitive)
    const emailLower = email.toLowerCase();
    if (!EMAILS.some((e) => e.toLowerCase() === emailLower)) continue;

    // Parse numstat lines
    const files = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const [addedStr, deletedStr, ...pathParts] = line.split("\t");
      const filePath = pathParts.join("\t"); // path may contain tabs (renames)
      const added = addedStr === "-" ? 0 : parseInt(addedStr, 10) || 0;
      const deleted = deletedStr === "-" ? 0 : parseInt(deletedStr, 10) || 0;
      files.push({ added, deleted, path: filePath });
    }

    const totalAdded = files.reduce((s, f) => s + f.added, 0);
    const totalDeleted = files.reduce((s, f) => s + f.deleted, 0);

    commits.push({
      hash,
      date,
      email,
      author,
      subject,
      owner,
      repo,
      files,
      totalAdded,
      totalDeleted,
      filesTouched: files.length,
    });
  }

  return commits;
}

async function extractRepo({ owner, repo }) {
  const dir = resolve(REPOS_DIR, owner, repo);

  if (!(await exists(resolve(dir, ".git")))) {
    console.warn(`  Skipping ${owner}/${repo} — not cloned`);
    return [];
  }

  // Build --author args for each email
  const authorArgs = EMAILS.flatMap((e) => ["--author", e]);

  try {
    const { stdout } = await exec(
      "git",
      [
        "log",
        "--all",
        ...authorArgs,
        `--since=${SINCE}`,
        `--until=${UNTIL}`,
        "--date=iso-strict",
        `--pretty=format:${SEPARATOR}${FORMAT}`,
        "--numstat",
      ],
      { cwd: dir, maxBuffer: 50 * 1024 * 1024, timeout: 60_000 },
    );

    const commits = parseGitLog(stdout, owner, repo);
    console.log(`  ${owner}/${repo}: ${commits.length} commits`);
    return commits;
  } catch (err) {
    console.warn(
      `  Warning: git log failed for ${owner}/${repo}: ${err.message}`,
    );
    return [];
  }
}

async function main() {
  const raw = await readFile(REPOS_JSON, "utf-8");
  const repos = JSON.parse(raw);

  console.log(
    `Extracting commits from ${repos.length} repos (emails: ${EMAILS.join(", ")})...\n`,
  );

  await mkdir(OUT_DIR, { recursive: true });

  const limit = pLimit(CONCURRENCY);
  const results = await Promise.all(
    repos.map((repo) => limit(() => extractRepo(repo))),
  );

  const allCommits = results
    .flat()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  await writeFile(COMMITS_JSON, JSON.stringify(allCommits, null, 2));

  console.log(
    `\nTotal: ${allCommits.length} commits written to ${COMMITS_JSON}`,
  );

  // Summary
  const repoStats = {};
  for (const c of allCommits) {
    const key = `${c.owner}/${c.repo}`;
    repoStats[key] = (repoStats[key] || 0) + 1;
  }
  const sorted = Object.entries(repoStats).sort((a, b) => b[1] - a[1]);
  console.log("\nCommits per repo:");
  for (const [name, count] of sorted) {
    console.log(`  ${name}: ${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
