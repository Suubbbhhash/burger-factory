// ============================================
// THE BURGER FACTORY — RESERVATION ROUTES
// Public Booking, Secure Lookup & Cancellation
// ============================================

import type { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  createReservationSchema,
  lookupReservationSchema,
  cancelReservationSchema,
  BOOKING_CODE_CHARS,
  BOOKING_CODE_LENGTH,
  TABLE_TURN_MINUTES,
  ZONE_ALIASES
} from '@burger-factory/shared';
import { realtimeHub } from '../../realtime/hub.js';

const prisma = new PrismaClient();

function generateCode(): string {
  let code = 'BF-';
  for (let i = 0; i < BOOKING_CODE_LENGTH; i++) {
    code += BOOKING_CODE_CHARS.charAt(Math.floor(Math.random() * BOOKING_CODE_CHARS.length));
  }
  return code;
}

export const reservationRoutes: FastifyPluginAsync = async (fastify) => {

  // 1. Create Public Reservation
  fastify.post('/', async (request, reply) => {
    const parsed = createReservationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: parsed.error.format()
      });
    }

    const { locationId, date, time, guests, seating, name, email, phone, occasion, notes } = parsed.data;

    // Calculate startsAt and endsAt timestamps
    const startsAt = new Date(`${date}T${time}:00+05:30`);
    const endsAt = new Date(startsAt.getTime() + TABLE_TURN_MINUTES * 60 * 1000);

    // Look up location
    const location = await prisma.location.findFirst({
      where: { OR: [{ id: locationId }, { slug: locationId }] }
    });

    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    // Determine eligible zones
    const allowedZones = (ZONE_ALIASES[seating] || ['indoor', 'outdoor']).map(z => z.toUpperCase());

    // Best-Fit Table Allocation with Atomic Collision Check
    // We execute inside an interactive transaction to prevent race conditions
    const result = await prisma.$transaction(async (tx) => {
      // Find candidate tables
      const candidateTables = await tx.diningTable.findMany({
        where: {
          locationId: location.id,
          isActive: true,
          capacity: { gte: guests },
          zone: { in: allowedZones as any }
        },
        orderBy: { capacity: 'asc' }
      });

      if (candidateTables.length === 0) {
        throw new Error('No tables match your party size at this location.');
      }

      // Check collision for each table (overlap: startsAt < existing.endsAt AND endsAt > existing.startsAt)
      let allocatedTable = null;

      for (const table of candidateTables) {
        const collision = await tx.reservation.findFirst({
          where: {
            tableId: table.id,
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt }
          }
        });

        if (!collision) {
          allocatedTable = table;
          break;
        }
      }

      if (!allocatedTable) {
        throw new Error('All tables are fully booked for this time slot. Please try another time.');
      }

      const code = generateCode();

      const reservation = await tx.reservation.create({
        data: {
          code,
          locationId: location.id,
          tableId: allocatedTable.id,
          guestName: name,
          email: email || null,
          phone,
          partySize: guests,
          startsAt,
          endsAt,
          seatingPref: seating === 'any' ? null : (seating.toUpperCase() as any),
          occasion: occasion || null,
          notes: notes || null,
          status: 'CONFIRMED',
          source: 'ONLINE'
        },
        include: {
          location: true,
          table: true
        }
      });

      return reservation;
    });

    // Broadcast SSE to manager floor canvas
    realtimeHub.broadcast(location.id, 'reservation:created', {
      id: result.id,
      code: result.code,
      guestName: result.guestName,
      partySize: result.partySize,
      time,
      tableLabel: result.table.label,
      tableZone: result.table.zone
    });

    return reply.status(201).send({
      success: true,
      reservation: {
        id: result.id,
        code: result.code,
        name: result.guestName,
        email: result.email,
        phone: result.phone,
        locationId: location.slug,
        locationName: location.name,
        date,
        time,
        guests: result.partySize,
        tableLabel: result.table.label,
        tableZone: result.table.zone.toLowerCase(),
        status: 'confirmed',
        occasion: result.occasion,
        notes: result.notes,
        createdAt: result.createdAt.toISOString()
      }
    });
  });

  // 2. Self-Service Lookup (Protected by phoneLast4 verification)
  fastify.post('/lookup', async (request, reply) => {
    const parsed = lookupReservationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid reference or phone digits' });
    }

    const { bookingCode, phoneLast4 } = parsed.data;

    const reservation = await prisma.reservation.findUnique({
      where: { code: bookingCode },
      include: { location: true, table: true }
    });

    if (!reservation) {
      return reply.status(404).send({ error: 'Reservation not found' });
    }

    // Verify last 4 digits
    const cleanPhone = reservation.phone.replace(/\D/g, '');
    if (!cleanPhone.endsWith(phoneLast4)) {
      return reply.status(403).send({ error: 'Phone number verification failed' });
    }

    return {
      success: true,
      reservation: {
        code: reservation.code,
        name: reservation.guestName,
        phone: reservation.phone,
        locationName: reservation.location.name,
        date: reservation.startsAt.toISOString().split('T')[0],
        time: reservation.startsAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        guests: reservation.partySize,
        tableLabel: reservation.table.label,
        tableZone: reservation.table.zone.toLowerCase(),
        status: reservation.status.toLowerCase()
      }
    };
  });

  // 3. Self-Service Cancellation (Protected by phoneLast4 verification)
  fastify.post('/cancel', async (request, reply) => {
    const parsed = cancelReservationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid cancel request payload' });
    }

    const { bookingCode, phoneLast4, reason } = parsed.data;

    const reservation = await prisma.reservation.findUnique({
      where: { code: bookingCode },
      include: { location: true }
    });

    if (!reservation) {
      return reply.status(404).send({ error: 'Reservation not found' });
    }

    const cleanPhone = reservation.phone.replace(/\D/g, '');
    if (!cleanPhone.endsWith(phoneLast4)) {
      return reply.status(403).send({ error: 'Phone verification failed' });
    }

    if (reservation.status === 'CANCELLED') {
      return reply.status(400).send({ error: 'Reservation is already cancelled' });
    }

    const updated = await prisma.reservation.update({
      where: { code: bookingCode },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        notes: reason ? `${reservation.notes || ''} [Cancelled: ${reason}]` : reservation.notes
      }
    });

    realtimeHub.broadcast(reservation.locationId, 'reservation:updated', {
      code: updated.code,
      status: 'cancelled'
    });

    return {
      success: true,
      message: `Reservation ${bookingCode} cancelled successfully`
    };
  });
};
