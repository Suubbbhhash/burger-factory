// ============================================
// THE BURGER FACTORY — REALTIME SSE HUB
// Server-Sent Events for Manager Floor Dashboards
// ============================================

import type { FastifyReply } from 'fastify';

interface ManagerClient {
  id: string;
  locationId: string;
  reply: FastifyReply;
}

class RealtimeHub {
  private clients: Map<string, ManagerClient> = new Map();

  addClient(id: string, locationId: string, reply: FastifyReply) {
    this.clients.set(id, { id, locationId, reply });

    // Send initial handshake
    this.sendToClient(reply, 'connected', { status: 'ok', clientId: id, locationId });
  }

  removeClient(id: string) {
    this.clients.delete(id);
  }

  /**
   * Broadcast an event to all managers of a specific outlet (or all outlets if locationId === 'all')
   */
  broadcast(locationId: string, eventType: string, data: unknown) {
    for (const client of this.clients.values()) {
      if (client.locationId === 'all' || client.locationId === locationId) {
        this.sendToClient(client.reply, eventType, data);
      }
    }
  }

  /**
   * Send heartbeat ping every 25 seconds to keep long-lived SSE connections alive across proxies
   */
  startHeartbeat() {
    setInterval(() => {
      const pingData = { timestamp: new Date().toISOString() };
      for (const client of this.clients.values()) {
        this.sendToClient(client.reply, 'ping', pingData);
      }
    }, 25000);
  }

  private sendToClient(reply: FastifyReply, eventType: string, data: unknown) {
    try {
      reply.raw.write(`event: ${eventType}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client disconnected
    }
  }
}

export const realtimeHub = new RealtimeHub();
realtimeHub.startHeartbeat();
