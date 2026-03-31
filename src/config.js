import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

config({ path: resolve(ROOT, ".env") });

export const GITHUB_TOKEN = process.env.GITHUB_ACCESS_TOKEN;
export const ORGS = ["bpmn-io", "camunda"];
export const GITHUB_USERNAME = "philippfromme";
export const EMAILS = process.env.EMAILS ? process.env.EMAILS.split(",") : [];
export const SINCE = "2016-04-01";
export const UNTIL = "2026-04-01";
export const TRACK_SECONDS = 90;
export const REPOS_DIR = resolve(ROOT, "repos");
export const OUT_DIR = resolve(ROOT, "out");
export const REPOS_JSON = resolve(OUT_DIR, "repos.json");
export const COMMITS_JSON = resolve(OUT_DIR, "commits.json");
export const CONCURRENCY = 6;
