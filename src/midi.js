/**
 * midi.js — "10 years in 90 seconds"
 *
 * Aesthetic: Ryoji Ikeda × Alva Noto × Ben Frost
 *   - precise digital clicks and sine-like pulses (Ikeda)
 *   - granular micro-textures, sparse geometry (Noto)
 *   - sub-bass pressure and dense noise walls (Frost)
 *
 * 4 layers:
 *   1. DATA PULSE  — every commit = a short click/tone, pitch per repo
 *   2. SUB BASS    — large commits trigger low sustained drones
 *   3. PRESSURE    — high-density windows get sustained tritone pads
 *   4. CLICKS      — percussion channel: precise rhythmic grid
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import pkg from "@tonejs/midi";
const { Midi } = pkg;
import {
  COMMITS_JSON,
  OUT_DIR,
  SINCE,
  UNTIL,
  TRACK_SECONDS,
} from "./config.js";

// --- Constants ---

const BPM = 140;
const QUANTIZE_32 = 60 / BPM / 8; // 1/32 note — tight grid

function stableHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function quantize(seconds) {
  return Math.round(seconds / QUANTIZE_32) * QUANTIZE_32;
}

async function main() {
  const raw = await readFile(COMMITS_JSON, "utf-8");
  const commits = JSON.parse(raw);

  if (!commits.length) {
    console.error("No commits found in commits.json");
    process.exit(1);
  }

  console.log(
    `Generating MIDI (Ikeda/Noto/Frost) from ${commits.length} commits...\n`,
  );

  const startMs = new Date(SINCE).getTime();
  const endMs = new Date(UNTIL).getTime();
  const rangeMs = endMs - startMs;

  // --- Repo → pitch mapping ---
  // Distribute chromatically across C4–B5 (MIDI 60–83), 2 octave spread
  const repoNames = [...new Set(commits.map((c) => `${c.owner}/${c.repo}`))];
  const repoCounts = {};
  for (const c of commits) {
    const key = `${c.owner}/${c.repo}`;
    repoCounts[key] = (repoCounts[key] || 0) + 1;
  }
  const sortedRepos = repoNames.sort(
    (a, b) => (repoCounts[b] || 0) - (repoCounts[a] || 0),
  );
  const repoNote = {};
  for (let i = 0; i < sortedRepos.length; i++) {
    repoNote[sortedRepos[i]] = 60 + (i % 24);
  }

  // --- Create MIDI ---
  const midi = new Midi();
  midi.header.setTempo(BPM);
  midi.header.name = "10 Years — Philipp Fromme";

  // Layer 1: Data Pulse (Square Lead)
  const pulseTrack = midi.addTrack();
  pulseTrack.name = "data_pulse";
  pulseTrack.channel = 0;
  pulseTrack.instrument.number = 80; // Square Lead

  // Layer 2: Sub Bass (Synth Bass 1)
  const bassTrack = midi.addTrack();
  bassTrack.name = "sub_bass";
  bassTrack.channel = 1;
  bassTrack.instrument.number = 38; // Synth Bass 1

  // Layer 3: Pressure (Pad 8 — sweep)
  const padTrack = midi.addTrack();
  padTrack.name = "pressure";
  padTrack.channel = 2;
  padTrack.instrument.number = 95; // Pad 8 (sweep)

  // Layer 4: Clicks (Percussion, channel 9)
  const clickTrack = midi.addTrack();
  clickTrack.name = "clicks";
  clickTrack.channel = 9;

  // --- Process commits ---
  for (const commit of commits) {
    const commitMs = new Date(commit.date).getTime();
    const t = (commitMs - startMs) / rangeMs;
    if (t < 0 || t > 1) continue;

    const noteStart = quantize(t * TRACK_SECONDS);
    const repoName = `${commit.owner}/${commit.repo}`;
    const linesChanged = commit.totalAdded + commit.totalDeleted;

    // Layer 1: Data pulse — every commit, very short
    const pitch = repoNote[repoName] || 60;
    pulseTrack.addNote({
      midi: pitch,
      time: noteStart,
      duration: 0.04,
      velocity: clamp(0.4 + Math.random() * 0.15, 0.35, 0.6),
    });

    // Layer 4: Percussion click — every commit
    // Side stick (37) for large commits, closed hi-hat (42) for small
    const percNote = linesChanged > 50 ? 37 : 42;
    clickTrack.addNote({
      midi: percNote,
      time: noteStart,
      duration: 0.02,
      velocity: clamp(0.3 + Math.log1p(linesChanged) * 0.05, 0.25, 0.55),
    });

    // Layer 2: Sub bass — only for substantial commits (>30 lines)
    if (linesChanged > 30) {
      const bassNote = 24 + (stableHash(repoName) % 12); // C1–B1
      const bassDuration = clamp(
        0.3 + Math.log1p(linesChanged) * 0.15,
        0.3,
        2.0,
      );
      bassTrack.addNote({
        midi: bassNote,
        time: noteStart,
        duration: bassDuration,
        velocity: clamp(0.5 + Math.log1p(linesChanged) * 0.05, 0.4, 0.85),
      });
    }
  }

  // --- Layer 3: Pressure pads from density analysis ---
  // Divide timeline into 2-second windows, add tritone pads where density is high
  const WINDOW_SECONDS = 2;
  const WINDOW_COUNT = Math.ceil(TRACK_SECONDS / WINDOW_SECONDS);
  const windows = new Array(WINDOW_COUNT).fill(0);

  for (const commit of commits) {
    const commitMs = new Date(commit.date).getTime();
    const t = (commitMs - startMs) / rangeMs;
    if (t < 0 || t > 1) continue;
    const idx = Math.min(Math.floor(t * WINDOW_COUNT), WINDOW_COUNT - 1);
    windows[idx]++;
  }

  const maxDensity = Math.max(...windows);
  const densityThreshold = maxDensity * 0.3;

  for (let i = 0; i < WINDOW_COUNT; i++) {
    if (windows[i] > densityThreshold) {
      const windowStart = (i / WINDOW_COUNT) * TRACK_SECONDS;
      const intensity = windows[i] / maxDensity;

      // Tritone interval for tension (Ikeda-like dissonance)
      const padRoot = 48 + (i % 12); // C3 range
      padTrack.addNote({
        midi: padRoot,
        time: windowStart,
        duration: WINDOW_SECONDS,
        velocity: clamp(intensity * 0.6, 0.15, 0.5),
      });
      padTrack.addNote({
        midi: padRoot + 6, // tritone
        time: windowStart,
        duration: WINDOW_SECONDS,
        velocity: clamp(intensity * 0.45, 0.1, 0.4),
      });
    }
  }

  // --- Write ---
  await mkdir(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, "anniversary.mid");
  await writeFile(outPath, Buffer.from(midi.toArray()));

  console.log(`MIDI written to ${outPath}`);
  console.log(`  Duration: ${TRACK_SECONDS}s at ${BPM} BPM`);
  console.log(`  Repos: ${sortedRepos.length}`);
  console.log(`  Commits: ${commits.length}`);
  console.log(`  Layers: data_pulse, sub_bass, pressure, clicks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
