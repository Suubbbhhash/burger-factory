// ============================================
// THE BURGER FACTORY — MENU & LOCATION ROUTES
// ============================================

import type { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const menuRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const categories = await prisma.menuCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: { isAvailable: true },
          orderBy: { name: 'asc' }
        }
      }
    });

    return { categories };
  });
};

export const locationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const locations = await prisma.location.findMany({
      where: { isActive: true },
      include: {
        tables: {
          where: { isActive: true },
          select: { id: true, label: true, zone: true, capacity: true }
        }
      }
    });

    return { locations };
  });
};
