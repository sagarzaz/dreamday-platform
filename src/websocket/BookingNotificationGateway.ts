/**
 * DreamDay Platform — WebSocket notification gateway.
 *
 * WHY WebSocket over polling:
 * - Real-time: admin sees new bookings and customer sees confirmation without refresh.
 * - Lower latency and fewer empty polls; one persistent connection per client.
 *
 * HORIZONTAL SCALING: With multiple app instances, a client may connect to instance A
 * while the booking was created on instance B. Use Redis Pub/Sub: publish
 * "booking:created" from the instance that created the booking; all instances
 * subscribe and forward to their connected admins. Same for "booking:confirmed"
 * to the customer's socket. This gateway implements in-process broadcast;
 * production should replace with Redis pub/sub and per-instance subscribers.
 */

import { WebSocket } from 'ws';
import { verifyAccessToken, type AccessPayload } from '../auth/tokens';
import { PlatformAccessRole } from '@prisma/client';
import { logger } from '../lib/logger';

export type NotificationKind = 'booking_created' | 'booking_confirmed';

export interface BookingCreatedPayload {
  kind: 'booking_created';
  bookingId: string;
  eventHallId: string;
  eventDate: string;
  customerId: string;
}

export interface BookingConfirmedPayload {
  kind: 'booking_confirmed';
  bookingId: string;
}

export type NotificationPayload = BookingCreatedPayload | BookingConfirmedPayload;

interface AuthenticatedSocket {
  ws: WebSocket;
  userId: string;
  role: PlatformAccessRole;
}

const adminRoles: PlatformAccessRole[] = [
  'PLATFORM_SUPERADMIN',
  'PLATFORM_OPERATOR',
  'EVENT_COORDINATOR',
];

export class BookingNotificationGateway {
  private readonly adminSockets: Map<string, AuthenticatedSocket> = new Map();
  private readonly userSockets: Map<string, AuthenticatedSocket> = new Map();

  /**
   * Authenticate incoming connection via query token or first message.
   * Expects ?token=JWT or first JSON message { type: 'auth', token: '...' }.
   */
  handleConnection(ws: WebSocket, url: string): void {
    const token = new URL(url, 'http://localhost').searchParams.get('token');
    if (token) {
      this.authenticateAndRegister(ws, token);
      return;
    }
    let resolved = false;
    ws.on('message', (raw) => {
      if (resolved) return;
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; token?: string };
        if (msg.type === 'auth' && msg.token) {
          resolved = true;
          this.authenticateAndRegister(ws, msg.token);
        }
      } catch {
        ws.close(4000, 'Send { type: "auth", token: "<access_token>" }');
      }
    });
    ws.once('close', () => { resolved = true; });
  }

  private authenticateAndRegister(ws: WebSocket, token: string): void {
    let payload: AccessPayload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      ws.close(4001, 'Invalid or expired token');
      return;
    }
    const socket: AuthenticatedSocket = { ws, userId: payload.sub, role: payload.role };
    this.userSockets.set(payload.sub, socket);
    if (adminRoles.includes(payload.role)) {
      this.adminSockets.set(payload.sub, socket);
    }
    ws.on('close', () => {
      this.adminSockets.delete(payload.sub);
      this.userSockets.delete(payload.sub);
    });
    ws.send(JSON.stringify({ type: 'authenticated', userId: payload.sub }));
  }

  /** Notify all connected admins (e.g. after booking creation). */
  notifyAdmins(payload: NotificationPayload): void {
    const message = JSON.stringify(payload);
    for (const [, { ws }] of this.adminSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
    logger.info('Notified admins', { kind: payload.kind, bookingId: (payload as { bookingId: string }).bookingId });
  }

  /** Notify a specific user (e.g. customer on confirmation). */
  notifyUser(userId: string, payload: NotificationPayload): void {
    const socket = this.userSockets.get(userId);
    if (socket?.ws.readyState === WebSocket.OPEN) {
      socket.ws.send(JSON.stringify(payload));
      logger.info('Notified user', { userId, kind: payload.kind });
    }
  }
}
