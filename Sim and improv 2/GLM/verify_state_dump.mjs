#!/usr/bin/env node
// =============================================================================
// THE BURGER FACTORY — STATE DUMP VERIFIER
// Certifies PROJECT_STATE_DUMP.txt directly on the Windows workspace.
//
//   1) Copy this file into D:\Burger_factory\
//   2) Run:  node verify_state_dump.mjs
//      options: --dump <path>   (default: .\PROJECT_STATE_DUMP.txt)
//               --root <path>   (default: "Workspace Directory" parsed from dump)
//
// Checks:
//   [1] header totals vs manifest body (file count + byte sum)
//   [2] FILE block sequence (N blocks, contiguous 1..N)
//   [3] manifest path set vs block path set (both directions)
//   [4] root <-> apps/web mirror parity (byte sizes)
//   [5] verbatim embedding: every block vs the live file on disk
// Exit code: 0 = PASS, 1 = FAIL, 2 = dump not found. Zero dependencies.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const dumpPath = opt('--dump') ?? path.join(process.cwd(), 'PROJECT_STATE_DUMP.txt');
if (!fs.existsSync(dumpPath)) { console.error(`Dump not found: ${dumpPath}`); process.exit(2); }

const raw = fs.readFileSync(dumpPath, 'utf8');
const L = raw.replace(/\r\n/g, '\n').split('\n');
const dumpBytes = Buffer.byteLength(raw);
const lineCount = raw.match(/\n/g)?.length ?? 0;

const grab = (re) => { const m = raw.match(re); return m ? m[1].trim() : ''; };
const root = opt('--root') ?? (grab(/Workspace Directory:\s*(.+)/) || path.dirname(dumpPath));
const stamp = grab(/Dump Timestamp:\s*(.+)/) || '(unparsed)';
const N = parseInt(grab(/Total Files Captured:\s*(\d+)\s*files/), 10) || 0;
const S = parseInt(grab(/Total Uncompressed Size:[^(]*\(([\d,]+)\s*bytes\)/).replace(/,/g, ''), 10) || 0;

const fails = []; const warns = [];
const MUTABLE = (p) => /(^|\/)(data\/reservations\.json|PROJECT_CHAT_LOG\.txt|SIMULATION_ERROR_REPORT\.txt|SIMULATION_LOG\.txt|sim_logs\/|test-harness\/data\/)/.test(p);

// ---- manifest (section 2.2) ---------------------------------------------------
const manIdx = L.findIndex((x) => /^RELATIVE PATH/.test(x));
const manEnd = L.findIndex((x) => /^TOTAL:\s*\d+\s+files/.test(x));
const man = new Map();
if (manIdx >= 0 && manEnd > manIdx) {
  for (let i = manIdx + 2; i < manEnd; i++) {
    const m = L[i].match(/^(.+?)\s{2,}([\d,]+)\s+[\d.]+\s+KB\s*$/);
    if (m) man.set(m[1].trim(), parseInt(m[2].replace(/,/g, ''), 10));
  }
}
const manSum = [...man.values()].reduce((a, b) => a + b, 0);

// ---- FILE blocks ---------------------------------------------------------------
const blocks = [];
for (let i = 0; i < L.length; i++) {
  const m = L[i].match(/^FILE \[(\d+)\/(\d+)\]:\s*\/(.+?)\s*$/);
  if (m) blocks.push({ idx: +m[1], den: +m[2], p: m[3], h: i });
}

// ---- terminal boundary for the last block (section 4 header, else footer) -----
let terminal = L.length;
if (blocks.length) {
  const lastH = blocks[blocks.length - 1].h;
  for (let j = lastH + 1; j < L.length - 1; j++) {
    if (/^4\.\s+RUNTIME/.test(L[j]) && /^=+$/.test(L[j - 1]) && /^=+$/.test(L[j + 1])) { terminal = j; break; }
  }
  if (terminal === L.length) {
    for (let j = L.length - 1; j >= 0; j--) if (/^END OF COMPLETE/.test(L[j])) { terminal = j; break; }
  }
}

function contentOf(i) {
  const b = blocks[i];
  const end = i + 1 < blocks.length ? blocks[i + 1].h : terminal;
  const region = L.slice(b.h + 1, end);
  const open = region.findIndex((x) => /^\s*```/.test(x));
  if (open < 0) return null;
  let close = -1;
  for (let j = open + 1; j < region.length; j++) if (region[j].trim() === '```') close = j;
  return close > open ? region.slice(open + 1, close).join('\n') : null;
}

const norm = (s) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '');
const hr = '='.repeat(78);
console.log(hr);
console.log('THE BURGER FACTORY — STATE DUMP VERIFICATION');
console.log(hr);
console.log(`Dump      : ${dumpPath}`);
console.log(`Root      : ${root}`);
console.log(`Stamp     : ${stamp}`);
console.log(`Measured  : ${lineCount.toLocaleString()} lines / ${dumpBytes.toLocaleString()} bytes (${(dumpBytes / 1e6).toFixed(2)} MB)`);
console.log('Reference : final-turn claim was 86,254 lines / 3.91 MB');
console.log();

console.log('[1] HEADER vs MANIFEST BODY');
console.log(`    header  : ${N} files, ${S.toLocaleString()} bytes`);
console.log(`    manifest: ${man.size} entries, ${manSum.toLocaleString()} bytes`);
if (!N) fails.push('header file count could not be parsed');
if (man.size !== N) fails.push(`manifest lists ${man.size} entries but header claims ${N} files`);
if (manSum !== S) fails.push(`manifest sums to ${manSum.toLocaleString()} but header claims ${S.toLocaleString()} bytes`);
console.log();

console.log('[2] FILE BLOCK SEQUENCE');
let seqBad = 0; let denBad = 0;
blocks.forEach((b, i) => { if (b.idx !== i + 1) seqBad++; if (N && b.den !== N) denBad++; });
console.log(`    parsed  : ${blocks.length} blocks (expected ${N})`);
if (blocks.length !== N) fails.push(`block count ${blocks.length} != ${N}`);
if (seqBad) fails.push(`${seqBad} block(s) out of sequence`);
if (denBad) fails.push(`${denBad} block(s) with wrong denominator`);
console.log();

console.log('[3] MANIFEST vs BLOCK PATH SETS');
const blkSet = new Set(blocks.map((b) => b.p));
const manOnly = [...man.keys()].filter((p) => !blkSet.has(p));
const blkOnly = blocks.filter((b) => !man.has(b.p)).map((b) => b.p);
manOnly.forEach((p) => fails.push(`manifest entry with no block: ${p}`));
blkOnly.forEach((p) => fails.push(`block missing from manifest: ${p}`));
console.log(`    manifest-only: ${manOnly.length ? manOnly.join(' | ') : 'none'}`);
console.log(`    blocks-only  : ${blkOnly.length ? blkOnly.join(' | ') : 'none'}`);
console.log();

console.log('[4] ROOT <-> apps/web MIRROR PARITY');
let pairs = 0; let pairOk = 0;
const mirrorBad = [];
for (const p of man.keys()) {
  if (!p.startsWith('apps/web/')) continue;
  const r = p.slice('apps/web/'.length);
  if (r === 'package.json') continue;
  pairs++;
  if (!man.has(r)) mirrorBad.push(`${p}: no root counterpart`);
  else if (man.get(r) !== man.get(p)) mirrorBad.push(`${p} ${man.get(p)}B vs root ${r} ${man.get(r)}B`);
  else pairOk++;
}
mirrorBad.forEach((x) => fails.push(`mirror ${x}`));
console.log(`    pairs   : ${pairs} checked, ${pairOk} byte-identical`);
console.log();

console.log('[5] VERBATIM EMBEDDING vs FILES ON DISK');
let vMatch = 0; let vDiff = 0; let vMiss = 0;
const details = [];
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  if (!man.has(b.p)) continue;
  const content = contentOf(i);
  let disk = null;
  try { disk = fs.readFileSync(path.join(root, b.p), 'utf8'); } catch { /* absent */ }
  if (content === null) {
    vDiff++; details.push(`${b.p}: MALFORMED BLOCK`);
    fails.push(`${b.p}: malformed block (fences not found)`);
    continue;
  }
  if (disk === null) {
    vMiss++;
    if (MUTABLE(b.p)) warns.push(`${b.p}: not on disk (mutable)`);
    else { details.push(`${b.p}: not on disk`); fails.push(`${b.p}: not on disk`); }
    continue;
  }
  if (norm(content) === norm(disk)) { vMatch++; }
  else if (MUTABLE(b.p)) { vDiff++; warns.push(`${b.p}: content drift (mutable file — expected after later runs)`); }
  else { vDiff++; details.push(`${b.p}: CONTENT DIFFERS`); fails.push(`${b.p}: embedded content differs from disk`); }
}
console.log(`    verbatim: ${vMatch} match, ${vDiff} differ, ${vMiss} not on disk`);
details.slice(0, 10).forEach((d) => console.log(`      - ${d}`));
if (details.length > 10) console.log(`      ... ${details.length - 10} more`);
console.log();

console.log(hr);
if (fails.length === 0) {
  console.log(`VERDICT: PASS — dump certified (${vMatch} files verbatim, ${warns.length} warnings)`);
  warns.slice(0, 10).forEach((w) => console.log(`  WARN: ${w}`));
  process.exit(0);
}
console.log(`VERDICT: FAIL — ${fails.length} failure(s), ${warns.length} warning(s)`);
fails.slice(0, 15).forEach((f) => console.log(`  FAIL: ${f}`));
if (fails.length > 15) console.log(`  ... ${fails.length - 15} more`);
warns.slice(0, 10).forEach((w) => console.log(`  WARN: ${w}`));
console.log('Rebuild with `node scripts/build_full_state_dump.cjs` and re-run this verifier.');
process.exit(1);
