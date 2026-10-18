const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'PROJECT_STATE_DUMP.txt');

const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist']);
const EXCLUDE_FILES = new Set(['PROJECT_STATE_DUMP.txt', 'package-lock.json']);

function scanFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      results = results.concat(scanFiles(path.join(dir, entry.name)));
    } else {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(ROOT, fullPath).replace(/\\/g, '/');
      results.push({
        relPath,
        fullPath,
        size: fs.statSync(fullPath).size
      });
    }
  }
  return results;
}

function buildTreeString(dir, prefix = '') {
  let out = '';
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const sorted = entries.filter(e => !EXCLUDE_DIRS.has(e.name) && !EXCLUDE_FILES.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const isLast = i === sorted.length - 1;
    const pointer = isLast ? '└── ' : '├── ';
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out += `${prefix}${pointer}${entry.name}/\n`;
      out += buildTreeString(full, nextPrefix);
    } else {
      const sizeKb = (fs.statSync(full).size / 1024).toFixed(2);
      out += `${prefix}${pointer}${entry.name} (${sizeKb} KB)\n`;
    }
  }
  return out;
}

function getLang(filePath) {
  if (filePath.endsWith('.js') || filePath.endsWith('.cjs')) return 'javascript';
  if (filePath.endsWith('.ts')) return 'typescript';
  if (filePath.endsWith('.html')) return 'html';
  if (filePath.endsWith('.css')) return 'css';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.bat')) return 'bat';
  if (filePath.endsWith('.prisma')) return 'prisma';
  if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) return 'yaml';
  if (filePath.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

function generateDump() {
  console.log('Scanning all project files in:', ROOT);
  const allFiles = scanFiles(ROOT);
  allFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const totalBytes = allFiles.reduce((acc, f) => acc + f.size, 0);
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0];

  let out = '';

  out += `================================================================================\n`;
  out += `THE BURGER FACTORY — COMPLETE SYSTEM STATE & VERBATIM CODEBASE DUMP\n`;
  out += `================================================================================\n`;
  out += `Application: The Burger Factory (Gourmet Burgers & Online Table Booking System)\n`;
  out += `Monorepo Version: 2.0.0\n`;
  out += `Workspace Directory: ${ROOT}\n`;
  out += `Dump Timestamp: ${dateStr} ${timeStr} IST\n`;
  out += `Total Files Captured: ${allFiles.length} files (excluding node_modules, .git, dist, package-lock)\n`;
  out += `Total Uncompressed Size: ${(totalBytes / 1024).toFixed(2)} KB (${totalBytes.toLocaleString()} bytes)\n`;
  out += `================================================================================\n\n`;

  out += `TABLE OF CONTENTS:\n`;
  out += `  1. EXECUTIVE ARCHITECTURE & ENVIRONMENT SPECIFICATION\n`;
  out += `     1.1 Operating Environment & Hardware Diagnostics\n`;
  out += `     1.2 Dual-Mode System Architecture (LAN/Wi-Fi Server vs Monorepo Fastify)\n`;
  out += `     1.3 Recent Core Upgrades & Feature Changelog\n`;
  out += `     1.4 Governance, Chat Logging & Workspace Hooks\n`;
  out += `  2. COMPLETE RECURSIVE DIRECTORY TREE & ASSET INVENTORY\n`;
  out += `     2.1 Visual Directory Hierarchy\n`;
  out += `     2.2 Complete File Manifest with Exact Sizes\n`;
  out += `  3. COMPLETE VERBATIM SOURCE CODE REPOSITORY (ALL ${allFiles.length} FILES)\n`;
  out += `     3.1 Root Frontend, Entrypoints & Automation\n`;
  out += `     3.2 Client Logic, Algorithms & Real-Time Sync (src/js/)\n`;
  out += `     3.3 Design System, Styling Tokens & Component CSS (src/styles/)\n`;
  out += `     3.4 Persistent Database & Seed Data (data/)\n`;
  out += `     3.5 Workspace Automation & Chat Logging (scripts/, .agents/)\n`;
  out += `     3.6 Production Microservices & Database Backend (apps/api/)\n`;
  out += `     3.7 Shared Zod Schemas & Domain Contracts (packages/shared/)\n`;
  out += `     3.8 Monorepo Web Application Package (apps/web/)\n`;
  out += `     3.9 Cloud Infrastructure, Caddy & Container Orchestration (infra/)\n`;
  out += `     3.10 Architectural Blueprints & System Documentation\n`;
  out += `     3.11 Production Upgrade Synchronized Artifacts (NEW/)\n`;
  out += `  4. RUNTIME, STORAGE, STATE MACHINE & API AUDIT\n`;
  out += `     4.1 Real-Time Server-Sent Events (SSE) & REST Protocol\n`;
  out += `     4.2 Data Models, Entities & Table Layouts (All 7 Outlets)\n`;
  out += `     4.3 Storage Strategy (Persistent JSON + LocalStorage Mirror)\n`;
  out += `     4.4 Passcode Security, Hotel-Grade Print Day Sheet & CDN Assets\n\n`;

  out += `================================================================================\n`;
  out += `1. EXECUTIVE ARCHITECTURE & ENVIRONMENT SPECIFICATION\n`;
  out += `================================================================================\n\n`;

  out += `1.1 OPERATING ENVIRONMENT:\n`;
  out += `--------------------------------------------------------------------------------\n`;
  out += `- Workspace Root Path : D:\\Burger_factory\n`;
  out += `- Operating System    : Microsoft Windows 11 Pro 64-bit\n`;
  out += `- Node.js Runtime     : v24.18.0\n`;
  out += `- npm Package Manager : 11.16.0\n`;
  out += `- Module System       : ECMAScript Modules (ESM) with "type": "module" in package.json\n`;
  out += `- Monorepo Layout     : npm workspaces configured with ["apps/*", "packages/*"]\n\n`;

  out += `1.2 DUAL-MODE ARCHITECTURE:\n`;
  out += `--------------------------------------------------------------------------------\n`;
  out += `The Burger Factory operates under two complementary execution paradigms:\n\n`;
  out += `[MODE 1: INTEGRATED LAN / WI-FI DEVELOPMENT & DEMO SERVER]\n`;
  out += `- Launcher: \`start-burger-factory.bat\` or \`npx vite --host 0.0.0.0 --port 3000\`\n`;
  out += `- Binding: 0.0.0.0:3000 allows laptops, smartphones, and tablets on the local Wi-Fi\n`;
  out += `  to interact simultaneously with instant live synchronization.\n`;
  out += `- Embedded REST Engine: vite.config.js incorporates a lightweight Express-like\n`;
  out += `  HTTP middleware providing:\n`;
  out += `    * GET  /api/v1/reservations       -> returns all bookings from data/reservations.json\n`;
  out += `    * POST /api/v1/reservations       -> creates reservation, commits to disk, broadcasts SSE\n`;
  out += `    * PATCH /api/v1/reservations/status -> updates status, stamps timestamps, broadcasts SSE\n`;
  out += `- Embedded Server-Sent Events (SSE): /api/v1/events pushes instant updates to all\n`;
  out += `  connected browsers (Customer phone and Manager tablet stay in lockstep).\n`;
  out += `- Persistent Data: Saved to data/reservations.json with seeded Goa reservations.\n\n`;
  out += `[MODE 2: PRODUCTION MICROSERVICES & DOCKER COMPOSE]\n`;
  out += `- Backend: Fastify v4 + TypeScript + Prisma ORM + PostgreSQL 16 + Redis 7 + BullMQ\n`;
  out += `- Located in apps/api: modular routes for auth, availability, floor, menu, reservations.\n`;
  out += `- Database: PostgreSQL with btree_gist extension for status-aware reservation constraints.\n`;
  out += `- Reverse Proxy: Caddy v2 (infra/Caddyfile) providing automatic TLS and static asset caching.\n`;
  out += `- Shared Contracts: packages/shared provides cross-workspace Zod validation schemas.\n\n`;

  out += `1.3 RECENT CORE UPGRADES & ENHANCEMENTS:\n`;
  out += `--------------------------------------------------------------------------------\n`;
  out += `1. Authentic Goa Menu & Copy Refinement:\n`;
  out += `   - Stripped all placeholder/cringe text and removed all emojis across all files.\n`;
  out += `   - Integrated authentic Goa Burger Factory menu (14 gourmet burgers including Pork\n`;
  out += `     Belly, Beef & Blue Cheese, Calamari, Jackfruit Carnitas; craft cocktails including\n`;
  out += `     Kokum Highball, Feni Sour, Tamarind Mezcalita).\n`;
  out += `2. Hero Joke Rotator:\n`;
  out += `   - Interactive board joke widget with random, no-repeat shuffle button featuring\n`;
  out += `     witty burger jokes from Mitch Hedberg, Jim Gaffigan, and Goa chalkboard rules.\n`;
  out += `3. Mobile Responsive Overhaul (390px iPhone & Android):\n`;
  out += `   - Added overflow-x: clip and min-width: 0 on all container grids to eliminate horizontal scroll.\n`;
  out += `   - Replaced dotted-leader menu items with clean responsive card blocks.\n`;
  out += `   - Added sticky mobile bottom navigation bar (Menu | Book a Table | My Booking).\n`;
  out += `   - Fixed iOS input auto-zoom by enforcing 16px font-size.\n`;
  out += `   - Created 4-column compact time slot chip grid for phones.\n`;
  out += `4. Staff Portal & Passcode Gate:\n`;
  out += `   - Restricted access to manager dashboard via embedded passcode gate (passcode: "burger123")\n`;
  out += `     with auto-fill convenience shortcut.\n`;
  out += `   - Replaced direct /manager.html access from customer site with secure passcode modal.\n`;
  out += `   - Added in-page session lock/logout and route guard redirection.\n`;
  out += `5. Active Navbar ScrollSpy (Red Underline):\n`;
  out += `   - Fixed red underline being stuck on "Home"; dynamic Intersection/scroll tracker\n`;
  out += `     smoothly underlines the section currently in view (Printed Menu, Kitchen, Outlets, Diners).\n`;
  out += `6. Hotel-Grade Printable Day Sheet:\n`;
  out += `   - One-click print button in manager header renders an official, executive 8-column\n`;
  out += `     manifest optimized for black & white laser/thermal printers with service summary metrics.\n\n`;

  out += `1.4 GOVERNANCE & CHAT LOGGING RULES:\n`;
  out += `--------------------------------------------------------------------------------\n`;
  out += `- In accordance with RULE[D:\\Burger_factory\\GEMINI.md], all conversation turns,\n`;
  out += `  prompts, and AI actions are permanently preserved in PROJECT_CHAT_LOG.txt.\n`;
  out += `- Automated lifecycle hooks in .agents/hooks.json execute scripts/sync_chat_log.cjs\n`;
  out += `  on PostInvocation and Stop triggers.\n\n`;

  out += `================================================================================\n`;
  out += `2. COMPLETE RECURSIVE DIRECTORY TREE & ASSET INVENTORY\n`;
  out += `================================================================================\n\n`;

  out += `2.1 VISUAL DIRECTORY HIERARCHY:\n`;
  out += `--------------------------------------------------------------------------------\n`;
  out += `D:\\Burger_factory\\\n`;
  out += buildTreeString(ROOT, '  ');
  out += `\n`;

  out += `2.2 COMPLETE FILE MANIFEST WITH EXACT SIZES:\n`;
  out += `--------------------------------------------------------------------------------\n`;
  out += `${'RELATIVE PATH'.padEnd(60)} ${'SIZE (BYTES)'.padStart(14)} ${'SIZE (KB)'.padStart(12)}\n`;
  out += `${'-'.repeat(88)}\n`;
  for (const f of allFiles) {
    out += `${f.relPath.padEnd(60)} ${f.size.toLocaleString().padStart(14)} ${(f.size / 1024).toFixed(2).padStart(12)} KB\n`;
  }
  out += `${'-'.repeat(88)}\n`;
  out += `${'TOTAL: ' + allFiles.length + ' files'} ${totalBytes.toLocaleString().padStart(14)} ${(totalBytes / 1024).toFixed(2).padStart(12)} KB\n\n`;

  out += `================================================================================\n`;
  out += `3. COMPLETE VERBATIM SOURCE CODE REPOSITORY\n`;
  out += `================================================================================\n`;
  out += `This section contains the full, unabridged source code for every production\n`;
  out += `and development file in the repository. No ellipses, no placeholders, no cuts.\n`;
  out += `================================================================================\n\n`;

  for (let idx = 0; idx < allFiles.length; idx++) {
    const f = allFiles[idx];
    const lang = getLang(f.relPath);
    console.log(`[${idx + 1}/${allFiles.length}] Dumping: ${f.relPath}`);

    out += `================================================================================\n`;
    out += `FILE [${idx + 1}/${allFiles.length}]: /${f.relPath}\n`;
    out += `Size: ${f.size.toLocaleString()} bytes | Language: ${lang}\n`;
    out += `================================================================================\n`;
    out += `\`\`\`${lang}\n`;
    try {
      const content = fs.readFileSync(f.fullPath, 'utf8');
      out += content;
      if (!content.endsWith('\n')) out += '\n';
    } catch (err) {
      out += `[ERROR READING FILE: ${err.message}]\n`;
    }
    out += `\`\`\`\n\n`;
  }

  out += `================================================================================\n`;
  out += `4. RUNTIME, STORAGE, STATE MACHINE & API AUDIT\n`;
  out += `================================================================================\n\n`;

  out += `4.1 REAL-TIME SERVER-SENT EVENTS (SSE) & REST PROTOCOL:\n`;
  out += `--------------------------------------------------------------------------------\n`;
  out += `- SSE Endpoint: GET /api/v1/events\n`;
  out += `  * Content-Type: text/event-stream\n`;
  out += `  * Emits event: 'connected' upon client handshake\n`;
  out += `  * Emits event: 'reservations:changed' whenever a booking is created, seated, cancelled, or completed.\n`;
  out += `- REST Endpoints:\n`;
  out += `  * GET /api/v1/reservations: Returns array of reservation objects.\n`;
  out += `  * POST /api/v1/reservations: Accepts { reservation: {...} }, commits to data/reservations.json.\n`;
  out += `  * PATCH /api/v1/reservations/status: Accepts { code, status, reason }, updates status,\n`;
  out += `    records seatedAt/completedAt/cancelledAt ISO timestamps, and broadcasts.\n`;
  out += `- Fallback: BroadcastChannel('bf_reservations_sync') enables same-origin cross-tab sync even\n`;
  out += `  if network connection drops.\n\n`;

  out += `4.2 DATA MODELS & OUTLET CAPACITIES:\n`;
  out += `--------------------------------------------------------------------------------\n`;
  out += `Total Physical Outlets: 7\n`;
  out += `Total Physical Tables : 108 tables across all outlets\n`;
  out += `Location Breakdown:\n`;
  out += `1. Anjuna (Flagship Shack): 28 tables, 120 seats\n`;
  out += `   - Indoor Dining Room: 14 tables (ANJ-I1 to ANJ-I14)\n`;
  out += `   - Outdoor Garden Deck: 14 tables (ANJ-O1 to ANJ-O14)\n`;
  out += `2. Morjim (Beachside Deck): 20 tables, 90 seats\n`;
  out += `   - Indoor Dining Room: 6 tables (MOR-I1 to MOR-I6)\n`;
  out += `   - Beachfront Wooden Deck: 14 tables (MOR-B1 to MOR-B14)\n`;
  out += `3. Vagator (Sunset Cliff): 14 tables, 64 seats\n`;
  out += `   - Indoor Dining Room: 6 tables (VAG-I1 to VAG-I6)\n`;
  out += `   - Outdoor Cliff Deck: 8 tables (VAG-O1 to VAG-O8)\n`;
  out += `4. Nerul (Riverfront): 10 tables, 52 seats\n`;
  out += `   - Indoor Dining Room: 10 tables (NER-I1 to NER-I10)\n`;
  out += `5. Dona Paula (Jetty View): 10 tables, 42 seats\n`;
  out += `   - Indoor Dining Room: 5 tables (DP-I1 to DP-I5)\n`;
  out += `   - Outdoor Terrace: 5 tables (DP-O1 to DP-O5)\n`;
  out += `6. Panaji (City Center): 14 tables, 68 seats\n`;
  out += `   - Indoor Air-Conditioned: 14 tables (PAN-I1 to PAN-I14)\n`;
  out += `7. New Delhi (Greater Kailash II): 12 tables, 54 seats\n`;
  out += `   - Indoor Dining Room: 6 tables (DEL-I1 to DEL-I6)\n`;
  out += `   - Outdoor Rooftop Deck: 6 tables (DEL-R1 to DEL-R6)\n\n`;

  out += `4.3 STORAGE STRATEGY:\n`;
  out += `--------------------------------------------------------------------------------\n`;
  out += `- Primary Persistence: data/reservations.json (JSON disk store maintained by Vite middleware)\n`;
  out += `- Client Mirror: localStorage['bf_reservations'] (for offline resilience and instant boot)\n`;
  out += `- Session Auth Key: sessionStorage['bf_staff_auth'] === 'true' (locks staff dashboard)\n`;
  out += `- Default Staff Passcode: "burger123" (accepted alternatives: "1234", "staff123", "GoaBurgers2026!")\n\n`;

  out += `4.4 TABLE TURN ALGORITHM & STATE MACHINE:\n`;
  out += `--------------------------------------------------------------------------------\n`;
  out += `- Default Turn Duration: 90 minutes (TURN_MINUTES = 90)\n`;
  out += `- Table Status Lifecycle:\n`;
  out += `  * 'confirmed'  -> Reservation placed and confirmed.\n`;
  out += `  * 'seated'     -> Guest arrived and table occupancy timer begins.\n`;
  out += `  * 'completed'  -> Table cleared and immediately freed for reallocation.\n`;
  out += `  * 'no-show'    -> Guest exceeded 15-minute grace window; table freed.\n`;
  out += `  * 'cancelled'  -> Self-service customer or host cancellation; table freed.\n`;
  out += `- Overtime Detection: Tables seated for > 90 minutes trigger warning badge\n`;
  out += `  (e.g., "⚠️ 104m (Over)") on the interactive floor canvas.\n\n`;

  out += `================================================================================\n`;
  out += `END OF COMPLETE PROJECT STATE DUMP: PROJECT_STATE_DUMP.txt\n`;
  out += `================================================================================\n`;

  console.log('Writing state dump to:', OUT_FILE);
  fs.writeFileSync(OUT_FILE, out, 'utf8');

  const finalStat = fs.statSync(OUT_FILE);
  const lineCount = out.split('\n').length;
  console.log(`Successfully generated PROJECT_STATE_DUMP.txt:`);
  console.log(`- Total Lines: ${lineCount.toLocaleString()}`);
  console.log(`- File Size  : ${(finalStat.size / 1024).toFixed(2)} KB (${finalStat.size.toLocaleString()} bytes)`);
}

generateDump();
