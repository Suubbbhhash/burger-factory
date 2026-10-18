// ============================================
// THE BURGER FACTORY — AVAILABILITY ROUTES
// Live Real-Time Slot Grid for Customer UI
// ============================================

import type { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  availabilityQuerySchema,
  TIME_SLOTS,
  TABLE_TURN_MINUTES,
  ZONE_ALIASES
} from '@burger-factory/shared';

const prisma = new PrismaClient();

export const availabilityRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const parsed = availabilityQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid availability query parameters' });
    }

    const { locationId, date, guests, seating } = parsed.data;

    const location = await prisma.location.findFirst({
      where: { OR: [{ id: locationId }, { slug: locationId }] }
    });

    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    const allowedZones = (ZONE_ALIASES[seating || 'any'] || ['indoor', 'outdoor']).map(z => z.toUpperCase());

    // 1. Get all eligible tables for this location and party size
    const candidateTables = await prisma.diningTable.findMany({
      where: {
        locationId: location.id,
        isActive: true,
        capacity: { gte: guests },
        zone: { in: allowedZones as any }
      }
    });

    if (candidateTables.length === 0) {
      return {
        locationId: location.slug,
        date,
        slots: TIME_SLOTS.map(time => ({ time, status: 'full', availableCount: 0 }))
      };
    }

    const dayStart = new Date(`${date}T00:00:00+05:30`);
    const dayEnd = new Date(`${date}T23:59:59+05:30`);

    // 2. Fetch all active reservations for this day
    const dayReservations = await prisma.reservation.findMany({
      where: {
        locationId: location.id,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startsAt: { gte: dayStart, lte: dayEnd }
      },
      select: {
        tableId: true,
        startsAt: true,
        endsAt: true
      }
    });

    // 3. Evaluate each time slot
    const slots = TIME_SLOTS.map(time => {
      const slotStart = new Date(`${date}T${time}:00+05:30`);
      const slotEnd = new Date(slotStart.getTime() + TABLE_TURN_MINUTES * 60 * 1000);

      let freeCount = 0;

      for (const table of candidateTables) {
        const isBooked = dayReservations.some(r => {
          if (r.tableId !== table.id) return false;
          return (slotStart < r.endsAt && slotEnd > r.startsAt);
        });

        if (!isBooked) {
          freeCount++;
        }
      }

      let status: 'available' | 'last_tables' | 'full' = 'available';
      if (freeCount === 0) {
        status = 'full';
      } else if (freeCount <= 2) {
        status = 'last_tables';
      }

      return {
        time,
        status,
        availableCount: freeCount
      };
    });

    return {
      locationId: location.slug,
      locationName: location.name,
      date,
      slots
    };
  });
};
