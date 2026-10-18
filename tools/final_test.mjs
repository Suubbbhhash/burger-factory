#!/usr/bin/env node
// FINAL RELEASE TEST - run before every deploy:   npm run test:final
//  1) client<->server contract test (real src/js/booking.js against a throw-away server)
//  2) 7-day, ~2000-booking multi-outlet simulation with concurrent customers, hosts, network faults and a security prober
// Exit code 0 = safe to ship. Anything else = read FINAL_TEST_REPORT.txt and the sim_logs/ folder it points to.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const steps = [
  { name: 'Client <-> server contract test', args: ['tools/client_contract_test.mjs'] },
  { name: '7-day concurrent simulation + security probes', args: ['tools/simulate.mjs', '--spawn', '--days', '7', '--seed', '42', '--rush', '60', '--race-ms', '4'] }
];
let out = `THE BURGER FACTORY - FINAL TEST REPORT\n${'='.repeat(70)}\nRun at: ${new Date().toISOString()}\n\n`;
let allOk = true;
for (const s of steps) {
  console.log(`\n>>> ${s.name}`);
  const r = spawnSync(process.execPath, s.args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  const text = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0; allOk = allOk && ok;
  const tail = text.split('\n').filter(l => !/^  D\d\d /.test(l)).slice(-45).join('\n');
  console.log(tail);
  out += `[${ok ? 'PASS' : 'FAIL'}] ${s.name} (exit ${r.status})\n${'-'.repeat(70)}\n${tail}\n\n`;
}
out += `${'='.repeat(70)}\nOVERALL VERDICT: ${allOk ? 'PASS - safe to deploy' : 'FAIL - do NOT deploy; see details above'}\n`;
fs.writeFileSync('FINAL_TEST_REPORT.txt', out);
console.log(`\nOVERALL VERDICT: ${allOk ? 'PASS' : 'FAIL'}   (details: FINAL_TEST_REPORT.txt)`);
process.exit(allOk ? 0 : 1);
