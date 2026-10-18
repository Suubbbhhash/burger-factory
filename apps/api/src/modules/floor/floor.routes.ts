// ============================================
// THE BURGER FACTORY — FLOOR MANAGER ROUTES
// Spatial Floor Canvas, Status Transitions, SSE & CSV
// ============================================

import type { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import {
  walkInReservationSchema,
  updateReservationStatusSchema,
  BOOKING_CODE_CHARS,
  BOOKING_CODE_LENGTH,
  TABLE_TURN_MINUTES
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

export const floorRoutes: FastifyPluginAsync = async (fastify) => {

  // 1. Real-time Server-Sent Events (SSE) stream for Floor Managers
  fastify.get('/events', async (request, reply) => {
    const { locationId = 'all' } = request.query as { locationId?: string };

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    realtimeHub.addClient(clientId, locationId, reply);

    request.raw.on('close', () => {
      realtimeHub.removeClient(clientId);
    });

    // Keep connection hanging for SSE
    await new Promise(() => {});
  });

  // 2. Get Spatial Floor Canvas Tables & Occupancies
  fastify.get('/manifest', async (request, reply) => {
    const { locationId = 'anjuna', date = new Date().toISOString().split('T')[0] } = request.query as any;

    const location = await prisma.location.findFirst({
      where: { OR: [{ id: locationId }, { slug: locationId }] }
    });

    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    const tables = await prisma.diningTable.findMany({
      where: { locationId: location.id, isActive: true },
      orderBy: [{ zone: 'asc' }, { label: 'asc' }]
    });

    const dayStart = new Date(`${date}T00:00:00+05:30`);
    const dayEnd = new Date(`${date}T23:59:59+05:30`);

    const reservations = await prisma.reservation.findMany({
      where: {
        locationId: location.id,
        status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] },
        startsAt: { gte: dayStart, lte: dayEnd }
      }
    });

    const now = new Date();

    const manifestTables = tables.map(t => {
      const activeRes = reservations.find(r => {
        if (r.tableId !== t.id) return false;
        if (r.status === 'SEATED') return true;
        return (now >= r.startsAt && now < r.endsAt);
      });

      const upcomingRes = reservations.find(r => {
        if (r.tableId !== t.id || r.status !== 'CONFIRMED') return false;
        return r.startsAt > now;
      });

      let status = 'available';
      let currentReservation = undefined;

      if (activeRes && activeRes.status === 'SEATED') {
        status = 'occupied';
        const seatedTime = activeRes.seatedAt || activeRes.startsAt;
        const elapsedMinutes = Math.floor((now.getTime() - new Date(seatedTime).getTime()) / 60000);

        currentReservation = {
          id: activeRes.id,
          code: activeRes.code,
          guestName: activeRes.guestName,
          partySize: activeRes.partySize,
          time: activeRes.startsAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
          seatedAt: seatedTime.toISOString(),
          elapsedMinutes
        };
      } else if (activeRes || upcomingRes) {
        status = 'reserved';
        const res = activeRes || upcomingRes!;
        currentReservation = {
          id: res.id,
          code: res.code,
          guestName: res.guestName,
          partySize: res.partySize,
          time: res.startsAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        };
      }

      return {
        id: t.id,
        label: t.label,
        zone: t.zone.toLowerCase(),
        capacity: t.capacity,
        posX: t.posX,
        posY: t.posY,
        width: t.width,
        height: t.height,
        shape: t.shape,
        status,
        currentReservation
      };
    });

    return {
      locationId: location.slug,
      date,
      tables: manifestTables
    };
  });

  // 3. Walk-In Seating directly from Floor Map
  fastify.post('/walkin', async (request, reply) => {
    const parsed = walkInReservationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.format() });
    }

    const { locationId, tableId, guests, name, phone, notes } = parsed.data;

    const location = await prisma.location.findFirst({
      where: { OR: [{ id: locationId }, { slug: locationId }] }
    });

    if (!location) return reply.status(404).send({ error: 'Location not found' });

    const table = await prisma.diningTable.findFirst({
      where: {
        locationId: location.id,
        OR: [{ id: tableId }, { label: tableId }]
      }
    });

    if (!table) return reply.status(404).send({ error: 'Table not found' });

    const now = new Date();
    const endsAt = new Date(now.getTime() + TABLE_TURN_MINUTES * 60 * 1000);
    const code = generateCode();

    const reservation = await prisma.reservation.create({
      data: {
        code,
        locationId: location.id,
        tableId: table.id,
        guestName: name || 'Walk-in Guest',
        phone: phone || '+910000000000',
        partySize: guests,
        startsAt: now,
        endsAt,
        seatingPref: table.zone,
        status: 'SEATED',
        source: 'WALK_IN',
        seatedAt: now,
        notes: notes || 'Walk-in seated from floor map'
      }
    });

    realtimeHub.broadcast(location.id, 'reservation:seated', {
      tableLabel: table.label,
      guestName: reservation.guestName,
      code: reservation.code
    });

    return reply.status(201).send({
      success: true,
      reservation: {
        code: reservation.code,
        tableLabel: table.label,
        status: 'seated'
      }
    });
  });

  // 4. Update Reservation Status (Seat, Complete, No-Show, Cancel)
  fastify.patch('/reservations/:code/status', async (request, reply) => {
    const { code } = request.params as { code: string };
    const parsed = updateReservationStatusSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid status' });
    }

    const { status } = parsed.data;
    const now = new Date();

    const existing = await prisma.reservation.findUnique({
      where: { code }
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Reservation not found' });
    }

    const updateData: any = {
      status: status.toUpperCase()
    };

    if (status === 'seated') updateData.seatedAt = now;
    if (status === 'completed') updateData.completedAt = now;
    if (status === 'no-show') updateData.noShowAt = now;
    if (status === 'cancelled') updateData.cancelledAt = now;

    const updated = await prisma.reservation.update({
      where: { code },
      data: updateData
    });

    realtimeHub.broadcast(existing.locationId, 'reservation:updated', {
      code: updated.code,
      status: updated.status.toLowerCase()
    });

    return {
      success: true,
      code: updated.code,
      status: updated.status.toLowerCase()
    };
  });
};
