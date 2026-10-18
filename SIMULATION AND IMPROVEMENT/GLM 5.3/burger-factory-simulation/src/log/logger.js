// ============================================
// SIMULATION — EVENT & ERROR LOGGER
// Everything the simulation does is appended to
// SIMULATION_LOG.txt (chronological, dual-timestamped).
// Errors get ERR-#### ids, categories, context and a
// resolution hint. End-of-run: full error summary is
// appended to the same txt file.
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { fmtIST, j } from '../util.js';
import { CATEGORIES, SIGNATURES } from './errors.js';

export class SimLogger {
  constructor({ filePath, clock, level = 'info', append = true, runId }) {
    this.filePath = filePath;
    this.clock = clock;
    this.level = level;
    this.lines = 0;
    this.errors = [];            // {id, category, signature, actor, message, context, atReal, atVirt, count}
    this._errCount = 0;
    this._byCat = {};
    this._bySig = {};
    this._runId = runId;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const header =
      `\n${'='.repeat(100)}\n` +
      `THE BURGER FACTORY — SIMULATION RUN ${runId}\n` +
      `Started (real) : ${fmtIST(Date.now())}\n` +
      `Dual time      : [R] real clock | [V] virtual clock (D<n> = simulated day n)\n` +
      `Log grammar    : [R ts][V ts][ACTOR][CHANNEL][LEVEL] message | ctx | hint:…\n` +
      `${'='.repeat(100)}\n`;
    if (!append && fs.existsSync(filePath)) fs.writeFileSync(filePath, ''); // fresh log only when append=false
    // append mode keeps run history in one file (append=true default)
    fs.appendFileSync(filePath, header);
  }

  _base(actor, channel, levelTag) {
    return `[R ${fmtIST(Date.now())}][V ${this.clock.stamp()}][${actor}][${channel}] [${levelTag}]`;
  }

  info(actor, channel, msg, ctx) {
    this._write(this._base(actor, channel, 'INFO ') + ' ' + msg + (ctx ? ` | ${j(ctx)}` : ''));
  }

  warn(actor, channel, msg, ctx) {
    this._write(this._base(actor, channel, 'WARN ') + ' ' + msg + (ctx ? ` | ${j(ctx)}` : ''));
  }

  debug(actor, channel, msg, ctx) {
    if (this.level !== 'debug') return;
    this._write(this._base(actor, channel, 'DEBUG') + ' ' + msg + (ctx ? ` | ${j(ctx)}` : ''));
  }

  /**
   * Record an error. Returns the ERR id.
   * signature: one of SIGNATURES keys or '' (uncategorized)
   */
  error(actor, channel, category, signature, msg, ctx, hintOverride) {
    this._errCount += 1;
    const id = `ERR-${String(this._errCount).padStart(4, '0')}`;
    const cat = CATEGORIES[category] || { hint: 'Uncategorized.' };
    const sig = SIGNATURES[signature] || null;
    const hint = hintOverride || (sig ? sig.fix : cat.hint);

    const entry = {
      id, category, signature: signature || '—', actor, message: msg,
      context: ctx, atReal: Date.now(), atVirt: this.clock.now(), count: 1
    };
    const prev = this.errors.length ? this.errors[this.errors.length - 1] : null;
    this.errors.push(entry);
    this._byCat[category] = (this._byCat[category] || 0) + 1;
    if (signature) this._bySig[signature] = (this._bySig[signature] || 0) + 1;

    this._write(
      this._base(actor, channel, 'ERROR') +
      ` ${id}${signature ? '/' + signature : ''} ${msg}` +
      (ctx ? `\n      ctx: ${j(ctx, 700)}` : '') +
      (sig ? `\n      finding: ${sig.ref}` : '') +
      `\n      hint: ${hint}`
    );
    return id;
  }

  section(title) {
    this._write(`\n${'—'.repeat(98)}\n  ${title}\n${'—'.repeat(98)}`);
  }

  _write(line) {
    this.lines += 1;
    fs.appendFileSync(this.filePath, line + '\n');
  }

  /** Error digest for the end-of-run summary block (appended to the txt + returned). */
  errorSummaryBlock() {
    if (this.errors.length === 0) {
      return 'ERRORS: none recorded. Every invariant held for the entire run.';
    }
    const byCat = Object.entries(this._byCat).sort((a, b) => b[1] - a[1]);
    const bySig = Object.entries(this._bySig).sort((a, b) => b[1] - a[1]);
    let s = 'ERROR SUMMARY (grouped by category → signature → suggested fix)\n';
    for (const [cat, n] of byCat) {
      s += `  ${CATEGORIES[cat]?.label || cat}: ${n}\n`;
    }
    s += '\n  Signatures (what to fix first):\n';
    if (bySig.length === 0) s += '    (no classified signatures — see raw errors above)\n';
    for (const [sig, n] of bySig) {
      const ref = SIGNATURES[sig];
      s += `    ${sig} ×${n} — finding ${ref ? ref.ref : '?'} — fix: ${ref ? ref.fix : 'n/a'}\n`;
    }
    return s;
  }

  get errorCount() { return this._errCount; }
}
