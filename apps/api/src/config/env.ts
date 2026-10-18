// ============================================
// THE BURGER FACTORY — ENVIRONMENT CONFIGURATION
// ============================================

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgresql://burger:factory_secret_2026@localhost:5432/burger_factory?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().default('bf_super_secure_jwt_secret_key_2026_goa'),
  COOKIE_SECRET: z.string().default('bf_cookie_signing_secret_key_32chars'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional()
});

export const env = envSchema.parse(process.env);
