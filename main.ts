// Token launch radar (token-radar-01): reads the sealed DefiLlama snapshot, ranks every protocol
// that records no token by an implied launch value, and assembles the hand-in under the output dir:
// board.json, data.js, dashboard/, screenshots/ and dossier.json.
//
//   node main.ts --input <snapshot.json|dir> --output <dir>
// Defaults: --input /input/snapshot.json, output from --output, MAKEFUN_OUTPUT_DIR, or /output.
// Node 22+ standard library only; the .ts sources run as they are.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input/snapshot.json');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`radar: no snapshot at ${inputFile} (pass --input <snapshot.json|directory>)\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`radar: refusing to write a board the gate would reject: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);

// Self-check the board as written, not the board in memory: the hand-in is the file on disk.
const written = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8')) as { rows: typeof board };
const onDisk = new Set(written.rows.map((row) => row.slug));
for (const slug of snapshot.watchlist) {
  if (!onDisk.has(slug)) {
    process.stderr.write(`radar: self-check failed: watchlist slug ${slug} is missing from board.json\n`);
    process.exit(1);
  }
}
const byRank = [...written.rows].sort((a, b) => a.rank - b.rank);
if (byRank.some((row, at) => row.rank !== at + 1)) {
  process.stderr.write(`radar: self-check failed: board.json ranks are not exactly 1..${byRank.length}\n`);
  process.exit(1);
}
for (let at = 1; at < byRank.length; at++) {
  if (byRank[at]!.implied_value_usd > byRank[at - 1]!.implied_value_usd) {
    process.stderr.write(`radar: self-check failed: board.json implied value rises at rank ${byRank[at]!.rank}\n`);
    process.exit(1);
  }
}

writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory tree of regular files, skipping dot-names at every level. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) copied.push(...copyTree(src, dst));
    else if (statSync(src).isFile()) {
      copyFileSync(src, dst);
      copied.push(name);
    }
  }
  return copied;
}

copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`radar: screenshots/ holds ${shots.length} images; hand in 3 (board, detail, filtered)\n`);
  process.exit(1);
}

// Written last: the gate rebuilds the dossier from this output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536 }));

process.stdout.write(
  `radar: ${snapshot.protocols.length} protocols scanned, ${board.length} pre-token rows ranked, ` +
    `${snapshot.watchlist.length} watchlist slugs covered; wrote board.json, data.js, dashboard/, screenshots/ (${shots.length}) and dossier.json under ${out}\n`,
);
