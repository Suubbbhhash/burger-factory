// ============================================
// THE BURGER FACTORY — FASTIFY APP MANIFEST
// ============================================

import fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';

import { reservationRoutes } from './modules/reservations/reservation.routes.js';
import { availabilityRoutes } from './modules/availability/availability.routes.js';
import { floorRoutes } from './modules/floor/floor.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { menuRoutes, locationRoutes } from './modules/menu/menu.routes.js';

export async function buildApp() {
  const app = fastify({
    logger: env.NODE_ENV !== 'test',
    trustProxy: true
  });

  // CORS
  await app.register(cors, {
    origin: [env.CORS_ORIGIN, 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
  });

  // Cookies
  await app.register(cookie, {
    secret: env.COOKIE_SECRET
  });

  // JWT
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: 'bf_token',
      signed: false
    }
  });

  // Rate Limiting (Prevents booking spam and ID guessing)
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  });

  // Health Check
  app.get('/health', async () => ({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'burger-factory-api'
  }));

  // Register API v1 Routes
  await app.register(async (v1) => {
    v1.register(reservationRoutes, { prefix: '/reservations' });
    v1.register(availabilityRoutes, { prefix: '/availability' });
    v1.register(floorRoutes, { prefix: '/floor' });
    v1.register(authRoutes, { prefix: '/auth' });
    v1.register(menuRoutes, { prefix: '/menu' });
    v1.register(locationRoutes, { prefix: '/locations' });
  }, { prefix: '/api/v1' });

  return app;
}
