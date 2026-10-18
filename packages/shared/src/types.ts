// ============================================
// THE BURGER FACTORY — SHARED TYPES
// ============================================

import type { ReservationStatusType, ZoneType, UserRoleType } from './constants.js';

export interface PublicReservationDTO {
  id: string;
  code: string;
  locationId: string;
  locationName: string;
  date: string;
  time: string;
  guests: number;
  tableLabel: string;
  tableZone: ZoneType;
  guestName: string;
  email?: string;
  phone: string;
  status: ReservationStatusType;
  occasion?: string;
  notes?: string;
  createdAt: string;
}

export interface ManagerReservationDTO extends PublicReservationDTO {
  tableId: string;
  source: 'online' | 'walk_in' | 'phone';
  seatedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  noShowAt?: string;
  depositStatus?: string;
  depositPaise?: number;
}

export interface TableDTO {
  id: string;
  label: string;
  zone: ZoneType;
  capacity: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  shape: 'rect' | 'round';
  status: 'available' | 'reserved' | 'occupied';
  currentReservation?: {
    id: string;
    code: string;
    guestName: string;
    partySize: number;
    time: string;
    seatedAt?: string;
    elapsedMinutes?: number;
  };
  upcomingReservation?: {
    id: string;
    code: string;
    guestName: string;
    partySize: number;
    time: string;
  };
}

export interface SlotAvailabilityDTO {
  time: string;
  status: 'available' | 'last_tables' | 'full';
  availableTables: number;
  bestFitTableLabel?: string;
  message?: string;
}

export interface ManagerDayStatsDTO {
  totalReservations: number;
  confirmed: number;
  seated: number;
  completed: number;
  cancelled: number;
  noShow: number;
  totalGuests: number;
}

export interface RealtimeEvent<T = unknown> {
  type: 'reservation:created' | 'reservation:updated' | 'table:updated' | 'ping';
  locationId: string;
  payload: T;
  timestamp: string;
}
