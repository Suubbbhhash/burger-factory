#!/usr/bin/env node
// ============================================
// THE BURGER FACTORY — REAL-LIFE SIMULATION PIPELINE
// CLI entrypoint.
//
// Quick start:
//   1. Start the app:            start-burger-factory.bat  (vite on :3000)
//      …or the test harness:      node test-harness/server.mjs  (:3100)
//   2. Probe:                     node run.mjs --probe-only
//   3. Smoke (2 min):             node run.mjs --tag smoke --days 1 --accel 600
//   4. Standard (7 virtual days): node run.mjs --tag standard --days 7 --accel 240
//   5. Reproduce a run:           node run.mjs --seed BF-XXXXXX --days 7 --accel 240
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './src/util.js';
import { Orchestrator, pkgRoot } from './src/engine/orchestrator.js';

const HELP = `
The Burger Factory — Real-Life Simulation Pipeline (zero dependencies, Node >= 18)

Usage: node run.mjs [options]

Core options:
  --target URL        Base URL of the app        (default: http://localhost:3000)
  --days N            Virtual days to simulate    (default: 7)
  --accel N           Time compression factor    (default: 240; 1 = real time)
  --seed TAG          Deterministic seed like BF-9F3A2C (default: random, echoed in log)
  --cap N             Max concurrent actors       (default: 800)
  --chaos MODE        off | standard | aggressive (default: standard)
  --multiplier N      Demand volume multiplier   (default: 1)
  --start-date DATE   YYYY-MM-DD start of sim    (default: today)
  --tag NAME          Run tag used in ids/filenames
  --probe-only        Probe the target and exit
  --log-level LEVEL   info | debug               (default: info)
  --out PATH          SIMULATION_LOG.txt path    (default: <pkg>/SIMULATION_LOG.txt)
  --fresh             Start a fresh log (default appends run history)

Presets (npm run):
  smoke | standard | soak
`;

function loadBaseConfig() {
  const p = path.join(pkgRoot(), 'sim.config.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function num(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) { console.log(HELP); process.exit(0); }

  const base = loadBaseConfig();
  const config = {
    ...base,
    target: args.target ? String(args.target).replace(/\/+$/, '') : base.target || 'http://localhost:3000',
    days: num(args.days, base.days ?? 7),
    acceleration: num(args.accel, base.acceleration ?? 240),
    maxConcurrentActors: num(args.cap, base.maxConcurrentActors ?? 800),
    seed: args.seed && args.seed !== true ? String(args.seed) : (base.seed ?? null),
    chaos: ['off', 'standard', 'aggressive'].includes(args.chaos) ? args.chaos : (base.chaos ?? 'standard'),
    tag: args.tag && args.tag !== true ? String(args.tag) : 'run',
    startDate: args['start-date'] && args['start-date'] !== true ? String(args['start-date']) : (base.startDate ?? null),
    demand: { ...base.demand, multiplier: num(args.multiplier, base.demand?.multiplier ?? 1) },
    log: { ...(base.log || {}), level: args['log-level'] || base.log?.level || 'info', append: args.fresh ? false : (base.log?.append !== false) },
    network: base.network || { timeoutMs: 8000 },
    audit: base.audit || { everyMutations: 250, sseGraceMs: 2500 },
    reports: base.reports || { dir: 'reports' },
    sseMonitor: base.sseMonitor !== false,
    warmup: base.warmup || { minutes: 30, bookings: 4 }
  };
  if (args.out) config.log = { ...config.log, path: String(args.out) };

  const orch = new Orchestrator(config);

  if (args['probe-only']) {
    // lightweight: only preflight
    const r = await orch.runProbeOnly();
    process.exit(r ? 0 : 2);
  }

  const result = await orch.run();
  if (!result.ok) process.exit(2);
  process.exit(result.interrupted ? 130 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
