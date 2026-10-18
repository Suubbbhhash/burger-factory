/**
 * Automated Chat Logger & Sync Script for The Burger Factory
 *
 * This script is triggered by Antigravity IDE lifecycle hooks (.agents/hooks.json)
 * or run manually via `npm run chat:sync` / `node scripts/sync_chat_log.cjs`.
 *
 * It reads conversation transcripts from the Antigravity system logs and keeps
 * `PROJECT_CHAT_LOG.txt` continuously updated with all user prompts and assistant outputs.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT_DIR, 'PROJECT_CHAT_LOG.txt');

function readStdin(timeoutMs = 150) {
  return new Promise((resolve) => {
    let input = '';
    let resolved = false;

    if (process.stdin.isTTY) {
      return resolve('');
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { process.stdin.pause(); } catch (e) {}
        resolve(input);
      }
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(input);
      }
    });
    process.stdin.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(input);
      }
    });
  });
}

async function main() {
  let hookContext = null;
  try {
    const rawStdin = await readStdin(150);
    if (rawStdin && rawStdin.trim().startsWith('{')) {
      hookContext = JSON.parse(rawStdin.trim());
    }
  } catch (e) {
    // continue
  }

  // Find candidate transcript paths
  const candidatePaths = [];
  if (hookContext && hookContext.transcriptPath) {
    candidatePaths.push(hookContext.transcriptPath);
  }

  // Also check standard brain directory
  const conversationId = hookContext?.conversationId || '9aba4487-b4c4-4905-b87e-ddafd136dd3d';
  const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\subbu';
  const brainLogDir = path.join(userHome, '.gemini', 'antigravity-ide', 'brain', conversationId, '.system_generated', 'logs');
  candidatePaths.push(path.join(brainLogDir, 'transcript.jsonl'));
  candidatePaths.push(path.join(brainLogDir, 'transcript_full.jsonl'));

  let foundTranscript = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p) && fs.statSync(p).size > 0) {
      foundTranscript = p;
      break;
    }
  }

  if (foundTranscript) {
    try {
      const content = fs.readFileSync(foundTranscript, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      
      const newEntries = [];
      for (const line of lines) {
        try {
          const step = JSON.parse(line);
          const stepIdx = step.step_index ?? '?';
          const type = step.type;
          const source = step.source;
          const text = step.content || '';

          if (type === 'USER_INPUT' || source === 'USER_EXPLICIT') {
            newEntries.push({
              role: 'USER',
              stepIdx,
              time: step.created_at || new Date().toISOString(),
              text
            });
          } else if (type === 'PLANNER_RESPONSE' && text && text.trim().length > 0) {
            newEntries.push({
              role: 'ASSISTANT',
              stepIdx,
              time: step.created_at || new Date().toISOString(),
              text
            });
          }
        } catch (err) {
          // ignore malformed line
        }
      }

      if (newEntries.length > 0) {
        let existing = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '';
        for (const entry of newEntries) {
          const marker = `[STEP #${entry.stepIdx}] [${entry.role}]`;
          if (!existing.includes(marker)) {
            const entryText = `\n================================================================================\n${marker} - ${entry.time}\n--------------------------------------------------------------------------------\n${entry.text}\n`;
            fs.appendFileSync(LOG_FILE, entryText, 'utf8');
            existing += entryText;
          }
        }
      }
    } catch (err) {
      // transcript read error
    }
  }

  // Hook response for Antigravity hook runner
  const response = {
    decision: 'allow',
    injectSteps: []
  };
  process.stdout.write(JSON.stringify(response) + '\n');
  process.exit(0);
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: 'allow', injectSteps: [] }) + '\n');
  process.exit(0);
});
