// ============================================
// THE BURGER FACTORY — SERVER BOOTSTRAP
// ============================================

import { buildApp } from './app.js';
import { env } from './config/env.js';

async function start() {
  const app = await buildApp();

  try {
    const address = await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🍔 Burger Factory API listening at ${address}`);
    console.log(`⚡ Health check available at ${address}/health`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
