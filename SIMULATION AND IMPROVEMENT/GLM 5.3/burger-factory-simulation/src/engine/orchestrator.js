// ============================================
// SIMULATION — ORCHESTRATOR
// The pipeline:
//   PREFLIGHT  probe server, snapshot baseline, start SSE
//   MAIN       virtual clock loop:
//                - spawn due arrivals (demand plan)
//                - managers drive the service lifecycle
//                - cancellations fire at their scheduled time
//                - chaos injector fires scheduled scenarios
//                - rolling invariant audits every N mutations
//   DAY ROLL   at 04:00 IST: audit + day summary + next-day chaos plan
//   TEARDOWN   drain actors, final audit, SSE parity, report, log footer
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimClock, resolveStartEpoch } from '../core/clock.js';
import { Rng, randomSeedTag } from '../core/rng.js';
import { SimLogger } from '../log/logger.js';
import { ServerAdapter, Metrics } from '../server/adapter.js';
import { Auditor } from '../audit/invariants.js';
import { ActorPool } from '../actors/pool.js';
import { ChaosInjector } from '../chaos/injector.js';
import { DemandEngine } from '../demand/curves.js';
import { ReportBuilder } from '../report/report.js';
import { fmtIST, j, istMidnight } from '../util.js';

const PKG_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))); // <pkg>/src/engine/orchestrator.js -> <pkg>
export function pkgRoot() { return PKG_ROOT; }

const ENGINE_TICK_MS = 100;

export class Orchestrator {
  constructor(config) {
    this.config = config;
    this.seed = config.seed || randomSeedTag();
    this.runId = `${(config.tag || 'run').replace(/[^a-z0-9_-]/gi, '')}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
    this.startReal = Date.now();
    this.interrupted = false;
    this.daySummaries = [];
    this._stopping = false;
    this._done = false;
  }

  /** Standalone preflight probe (--probe-only). Returns true when server is reachable. */
  async runProbeOnly() {
    const cfg = this.config;
    const clock = this.clock = new SimClock({ startEpochMs: resolveStartEpoch(cfg.startDate), acceleration: 1 });
    const logPath = path.isAbsolute(cfg.log.path) ? cfg.log.path : path.join(PKG_ROOT, cfg.log.path);
    this.logger = new SimLogger({ filePath: logPath, clock, level: 'info', append: true, runId: `${this.runId}-probe` });
    this.adapter = new ServerAdapter({ target: cfg.target, timeoutMs: cfg.network.timeoutMs, logger: this.logger, clock, metrics: this.metrics = new Metrics() });
    this.logger.section(`PROBE ONLY — ${cfg.target}`);
    const probe = await this.adapter.probe();
    if (probe.list === null) {
      this.logger.error('SYS', 'ENGINE', 'SERVER', '', `probe FAILED — ${cfg.target} is not answering (HTTP ${probe.res.status}, ${probe.res.error || 'no response'})`);
      console.error(`PROBE FAILED: ${cfg.target} is not answering. Start the app (start-burger-factory.bat) or the harness (node test-harness/server.mjs).`);
      return false;
    }
    this.logger.info('SYS', 'ENGINE', `probe OK — HTTP ${probe.res.status}, ${probe.list.length} reservation(s) on server, GET latency ${probe.res.latencyMs}ms`);
    console.log(`PROBE OK: ${probe.list.length} reservation(s), latency ${probe.res.latencyMs}ms`);
    const sseTest = await this.adapter.startSse();
    await new Promise(r => setTimeout(r, 1200));
    const ok = this.adapter.sse.connected;
    this.adapter.stopSse();
    this.logger.info('SYS', 'SSE', ok ? 'SSE handshake verified (event: connected received)' : 'SSE could NOT connect — check /api/v1/events');
    console.log(ok ? 'SSE: OK' : 'SSE: FAILED');
    return true;
  }

  async run() {
    const cfg = this.config;
    const clock = this.clock = new SimClock({
      startEpochMs: resolveStartEpoch(cfg.startDate),
      acceleration: cfg.acceleration
    });

    const logPath = path.isAbsolute(cfg.log.path) ? cfg.log.path : path.join(PKG_ROOT, cfg.log.path);
    this.logger = new SimLogger({
      filePath: logPath, clock, level: cfg.log.level || 'info',
      append: cfg.log.append !== false, runId: this.runId
    });

    this.logger.section(`RUN ${this.runId} — PREFLIGHT`);
    this.logger.info('SYS', 'ENGINE',
      `boot: target=${cfg.target} days=${cfg.days} accel=${cfg.acceleration}x seed=${this.seed} chaos=${cfg.chaos} cap=${cfg.maxConcurrentActors}`,
      { startAt: fmtIST(clock.startEpochMs), log: logPath });

    const metrics = this.metrics = new Metrics();
    this.adapter = new ServerAdapter({ target: cfg.target, timeoutMs: cfg.network.timeoutMs, logger: this.logger, clock, metrics });

    // ---- PREFLIGHT: probe ----
    this.logger.info('SYS', 'ENGINE', `probing ${cfg.target} ...`);
    const probe = await this.adapter.probe();
    if (probe.list === null) {
      this.logger.error('SYS', 'ENGINE', 'SERVER', '', `PREFLIGHT FAILED — cannot read ${cfg.target}/api/v1/reservations`, { status: probe.res.status, error: probe.res.error });
      this.logger.info('SYS', 'ENGINE', 'hint: start the app first (start-burger-factory.bat) or point --target at the test harness (node test-harness/server.mjs).');
      return { ok: false, reason: 'probe' };
    }
    const baseline = probe.list;
    this.logger.info('SYS', 'ENGINE', `probe OK: HTTP ${probe.res.status}, ${baseline.length} existing reservation(s), GET latency ${probe.res.latencyMs}ms`);

    // ---- world ----
    this.worldRng = new Rng(this.seed, 'world');
    this.injector = new ChaosInjector({ mode: cfg.chaos, worldRng: this.worldRng, adapter: this.adapter, logger: this.logger, clock, ledger: null });
    this.pool = new ActorPool({ clock, adapter: this.adapter, logger: this.logger, worldRng: this.worldRng, config: cfg, auditor: null, injector: this.injector });
    this.injector.pool = this.pool;
    this.auditor = new Auditor({ adapter: this.adapter, logger: this.logger, clock, ledger: this.pool.ledger, auditCfg: cfg.audit });
    this.pool.auditor = this.auditor;

    for (const r of baseline) {
      const c = r.code || r.id;
      if (c) this.auditor.baselineCodes.add(c);
    }

    this.demand = new DemandEngine(this.worldRng, cfg, clock);
    const plan = this.demand.buildPlan();
    this.logger.info('SYS', 'ENGINE', `demand plan built: ${plan.length} arrivals across ${cfg.days} virtual day(s)`, this.demand.describe());

    this.pool.createManagers();
    this.logger.info('SYS', 'ENGINE', '7 floor managers online (one per outlet)');

    if (cfg.sseMonitor !== false) {
      await this.adapter.startSse();
      this.logger.info('SYS', 'SSE', 'SSE monitor attached to /api/v1/events (parity accounting on)');
    }

    this.injector.planDay(clock.startEpochMs); // day-1 scenarios

    // ---- MAIN LOOP ----
    this.logger.section(`RUN ${this.runId} — MAIN (D1..D${cfg.days})`);
    clock.start();

    this._endEpoch = istMidnight(clock.startEpochMs) + cfg.days * 86400000 - 60000; // 23:59 of last day
    this._nextRoll = clock.nextDayRollAfter(clock.startEpochMs);                    // 04:00 of D2
    this._planIdx = 0;
    this._lastProgress = 0;
    this._dayStartCounters = null;

    await new Promise((resolve) => {
      this._resolveMain = resolve;
      this._sigint = () => {
        if (this._stopping) return;
        this.interrupted = true;
        this.logger.warn('SYS', 'ENGINE', 'SIGINT — draining for graceful teardown ...');
        resolve();
      };
      process.once('SIGINT', this._sigint);
      this._engine = setInterval(() => this._tick(resolve), ENGINE_TICK_MS);
    });

    // ---- TEARDOWN ----
    await this.teardown();
    return { ok: true, interrupted: this.interrupted };
  }

  _tick(resolve) {
    const clock = this.clock;
    const now = clock.now();

    // spawn due arrivals
    while (this._planIdx < this.demand.plan.length && this.demand.plan[this._planIdx].at <= now) {
      if (this._stopping) break;
      this.pool.spawn(this.demand.plan[this._planIdx]);
      this._planIdx++;
    }

    // chaos scheduled events
    this.injector.tick(now);

    // due cancellations + managers (async, guarded)
    this.pool.checkDueCancels().catch(e => this.logger.error('POOL', 'CLIENT', 'CLIENT', '', `cancel loop: ${e && e.message}`));
    this.pool.tickManagers().catch(() => {});

    // day roll at 04:00
    if (now >= this._nextRoll && !this._rolling) {
      this._rolling = true;
      const finishedDay = Math.max(1, Math.floor((this._nextRoll - istMidnight(clock.startEpochMs)) / 86400000));
      const dayDate = new Date(istMidnight(clock.startEpochMs) + (finishedDay - 1) * 86400000 + 330 * 60000).toISOString().slice(0, 10);
      this.daySummaries.push({ day: finishedDay, date: dayDate, counters: { ...this.pool.dayCounters } });
      this.logger.section(`DAY ROLL — end of D${finishedDay} (${dayDate})`);
      this.pool.resetDay();
      this.injector.onNewDay();
      this.injector.planDay(istMidnight(clock.startEpochMs) + finishedDay * 86400000);
      this._nextRoll += 86400000;
      this.auditor.audit(`day-roll D${finishedDay}`).finally(() => { this._rolling = false; });
    }

    // progress heartbeat (real 5s)
    if (Date.now() - this._lastProgress > 5000) {
      this._lastProgress = Date.now();
      const s = this.pool.stats;
      this.logger.info('SYS', 'ENGINE',
        `progress V=${clock.stamp()} spawned=${s.spawned} active=${s.active} queued=${s.queued} booked=${s.booked} walkins=${s.walkinSeated} cancels=${s.cancels} errors=${this.logger.errorCount}`);
    }

    // end of run
    if ((now >= this._endEpoch || this.interrupted) && !this._stopping) {
      this._stopping = true;
      clearInterval(this._engine);
      process.removeListener('SIGINT', this._sigint);
      resolve();
    }
  }

  async teardown() {
    const { clock, logger, config } = this;
    logger.section(`RUN ${this.runId} — TEARDOWN`);
    this._stopping = true;
    this.pool.stopped = true; // no new spawns
    clock.stop();             // freeze virtual time so teardown logs stay inside the last service day
    logger.info('SYS', 'ENGINE', 'draining in-flight customers ...');
    await this.pool.drain(15000);
    for (const m of this.pool.managers.values()) m.stop();
    await this.auditor.audit('teardown-final');
    const parity = this.adapter.sseParity(config.audit.sseGraceMs || 2500);
    this.logger.info('SYS', 'SSE',
      parity.missing.length === 0
        ? `SSE parity clean: ${parity.received} events for ${parity.expected} mutations`
        : `SSE parity: ${parity.received} events / ${parity.expected} mutations — ${parity.missing.length} missing (see SSE-GAP error)`,
      parity.missing.length === 0 ? {} : { byAction: parity.missing.reduce((a, m) => { a[m.action] = (a[m.action] || 0) + 1; return a; }, {}) });
    this.adapter.stopSse();
    clock.stop();

    // final day summary for the (possibly incomplete) last day
    if (this.daySummaries.length < config.days && !this.interrupted) {
      const d = config.days;
      this.daySummaries.push({ day: d, date: clock.dateStr(), counters: { ...this.pool.dayCounters } });
    }

    // report
    this.reporter = new ReportBuilder({
      config, clock, logger, adapter: this.adapter, pool: this.pool,
      auditor: this.auditor, injector: this.injector, demand: this.demand,
      runId: this.runId, seed: this.seed, daySummaries: this.daySummaries
    });
    const { markdown, errorsJson } = this.reporter.build();

    const reportsDir = path.isAbsolute(config.reports.dir) ? config.reports.dir : path.join(PKG_ROOT, config.reports.dir);
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, `sim-report-${this.runId}.md`);
    fs.writeFileSync(reportPath, markdown, 'utf8');
    fs.writeFileSync(path.join(reportsDir, `simulation_errors_${this.runId}.json`), JSON.stringify(errorsJson, null, 2), 'utf8');

    logger.section(`RUN ${this.runId} — SUMMARY`);
    logger._write(this.reporter.logFooter({ interrupted: this.interrupted }));
    logger.info('SYS', 'ENGINE', `report: ${reportPath}`);
    logger._write(`${'='.repeat(100)}`);
    this._done = true;
    return reportPath;
  }
}
