// ============================================
// SIMULATION — REPORT BUILDER
// End-of-run analytics. Writes:
//   1. <reports>/sim-report-<runid>.md   (human report)
//   2. simulation_errors.json            (machine-readable error registry)
//   3. a summary block appended to SIMULATION_LOG.txt
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { percentile, fmtIST, j } from '../util.js';
import { TABLE_STATS } from '../demand/outlets.js';

export class ReportBuilder {
  constructor(ctx) { Object.assign(this, ctx); }

  build() {
    const { config, clock, logger, adapter, pool, auditor, injector, demand, runId, seed } = this;
    const m = adapter.metrics;
    const latencyRows = [];
    for (const [name, mm] of Object.entries(m.byEndpoint)) {
      const s = [...mm.samples].sort((a, b) => a - b);
      latencyRows.push({
        endpoint: name, count: mm.count,
        p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99),
        max: mm.max, errors: mm.errors
      });
    }
    latencyRows.sort((a, b) => b.count - a.count);

    const stats = pool.stats;
    const dd = demand.describe();
    const violations = auditor.violations || [];
    const byKind = {};
    for (const v of violations) byKind[v.kind] = (byKind[v.kind] || 0) + 1;

    const md = [];
    md.push(`# Simulation Report — ${runId}`);
    md.push('');
    md.push(`| | |`);
    md.push(`|---|---|`);
    md.push(`| Target | ${config.target} |`);
    md.push(`| Seed | ${seed} (reproduce with --seed ${seed}) |`);
    md.push(`| Virtual days | ${config.days} @ ${config.acceleration}x |`);
    md.push(`| Sim window | ${fmtIST(clock.startEpochMs)} → ${fmtIST(clock.startEpochMs + config.days * 86400000)} |`);
    md.push(`| Wall time | ${(clock.realElapsed() / 60000).toFixed(1)} min |`);
    md.push(`| Chaos | ${config.chaos} |`);
    md.push('');
    md.push(`## Demand`);
    md.push(`Planned population: **${dd.total}** (${j(dd.byChannel)})`);
    md.push('');
    md.push(`| Outlet | Planned | Tables | Seats |`);
    md.push(`|---|---|---|---|`);
    for (const [out, n] of Object.entries(dd.byOutlet).sort((a, b) => b[1] - a[1])) {
      md.push(`| ${out} | ${n} | ${TABLE_STATS.per[out].tables} | ${TABLE_STATS.per[out].seats} |`);
    }
    md.push('');
    md.push(`## Outcomes`);
    md.push(`| Metric | Value |`);
    md.push(`|---|---|`);
    md.push(`| Spawned customers | ${stats.spawned} |`);
    md.push(`| Booked (online/phone) | ${stats.booked} |`);
    md.push(`| Walk-ins seated | ${stats.walkinSeated} |`);
    md.push(`| Abandoned | ${stats.abandoned} |`);
    md.push(`| Client-side rejections | ${stats.clientRejects} |`);
    md.push(`| POST rejected/aborted | ${stats.postRejected} |`);
    md.push(`| Cancellations | ${stats.cancels} |`);
    md.push(`| No-shows | ${stats.noShows} |`);
    md.push(`| Seated by managers | ${stats.seated} |`);
    md.push(`| Completed turns | ${stats.completed} |`);
    md.push(`| Peak in-flight HTTP | ${m.peakInFlight} |`);
    md.push(`| HTTP requests total | ${m.totalRequests} (${m.totalErrors} failed) |`);
    md.push('');
    md.push(`## Server latency (real ms)`);
    md.push(`| Endpoint | n | p50 | p95 | p99 | max | errors |`);
    md.push(`|---|---|---|---|---|---|---|`);
    for (const r of latencyRows) md.push(`| ${r.endpoint} | ${r.count} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} | ${r.errors} |`);
    md.push('');
    md.push(`## Realtime (SSE)`);
    const sse = adapter.sse;
    md.push(`Events received: ${sse.events}; expected mutations: ${sse.expected.length}; reconnects: ${sse.reconnects}.`);
    md.push('');
    md.push(`## Chaos`);
    md.push('```json');
    md.push(JSON.stringify(injector.describe(), null, 2));
    md.push('```');
    md.push('');
    md.push(`## Invariant violations`);
    if (violations.length === 0) md.push('NONE — every invariant held for the entire run.');
    else {
      md.push(`Total distinct: ${violations.length}`);
      md.push('```json');
      md.push(JSON.stringify(byKind, null, 2));
      md.push('```');
    }
    md.push('');
    md.push(`## Per-day summary`);
    for (const d of (this.daySummaries || [])) {
      md.push(`- D${d.day} (${d.date}): spawned ${d.counters.spawned}, booked ${d.counters.booked}, walkins ${d.counters.walkinSeated}, cancelled ${d.counters.cancels}, no-shows ${d.counters.noShows}, seated ${d.counters.seated}, completed ${d.counters.completed}`);
    }
    md.push('');
    md.push(`## Errors`);
    md.push('```');
    md.push(logger.errorSummaryBlock());
    md.push('```');

    // machine-readable sidecar
    const errorsJson = {
      runId, seed,
      configEcho: { target: config.target, days: config.days, acceleration: config.acceleration, chaos: config.chaos },
      errors: logger.errors.map(e => ({ id: e.id, category: e.category, signature: e.signature, actor: e.actor, message: e.message, atVirt: fmtIST(e.atVirt) })),
      violations
    };

    return { markdown: md.join('\n'), errorsJson, stats };
  }

  /** Text block appended to SIMULATION_LOG.txt at end of run. */
  logFooter({ interrupted }) {
    const stats = this.pool.stats;
    const m = this.adapter.metrics;
    const lines = [];
    lines.push('RUN SUMMARY');
    lines.push(`  spawned=${stats.spawned} booked=${stats.booked} walkins=${stats.walkinSeated} abandoned=${stats.abandoned} cancels=${stats.cancels} no-shows=${stats.noShows} seated=${stats.seated} completed=${stats.completed}`);
    lines.push(`  http: requests=${m.totalRequests} failures=${m.totalErrors} peakInFlight=${m.peakInFlight}`);
    lines.push(`  sse: events=${this.adapter.sse.events} expected=${this.adapter.sse.expected.length} reconnects=${this.adapter.sse.reconnects}`);
    lines.push(`  chaos: ${j(this.injector.describe())}`);
    lines.push(`  invariant violations: ${this.auditor.violations.length}`);
    lines.push('');
    lines.push(this.logger.errorSummaryBlock());
    lines.push(interrupted ? 'RUN TERMINATED EARLY (SIGINT) — partial results.' : 'RUN COMPLETED.');
    lines.push(`Reproduce: node run.mjs --seed ${this.seed} --days ${this.config.days} --accel ${this.config.acceleration} --chaos ${this.config.chaos} --target ${this.config.target}`);
    return lines.join('\n');
  }
}
