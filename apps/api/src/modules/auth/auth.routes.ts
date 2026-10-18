// ============================================
// THE BURGER FACTORY — AUTH ROUTES
// Manager & Admin Authentication (Argon2 + JWT Cookie)
// ============================================

import type { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { loginSchema } from '@burger-factory/shared';

const prisma = new PrismaClient();

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid login payload' });
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { locations: { include: { location: true } } }
    });

    if (!user || !user.isActive) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    // Generate JWT
    const token = fastify.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        locations: user.locations.map(l => l.location.slug)
      },
      { expiresIn: '7d' }
    );

    // Set HttpOnly Cookie
    reply.setCookie('bf_token', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60
    });

    return {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    };
  });

  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('bf_token', { path: '/' });
    return { success: true, message: 'Logged out' };
  });

  fastify.get('/me', async (request, reply) => {
    try {
      await request.jwtVerify();
      return { authenticated: true, user: request.user };
    } catch {
      return reply.status(401).send({ authenticated: false });
    }
  });
};
