// ============================================
// THE BURGER FACTORY — SHARED ZOD SCHEMAS
// ============================================

import { z } from 'zod';
import { TIME_SLOTS, ZONES, RESERVATION_STATUS } from './constants.js';

// Phone regex: E.164 format or Indian 10-digit mobile
export const phoneSchema = z.string()
  .trim()
  .refine(
    (val) => /^(\+91[\-\s]?)?[6789]\d{9}$/.test(val.replace(/\s+/g, '')),
    { message: 'Please enter a valid 10-digit Indian phone number (+91)' }
  );

// Date: YYYY-MM-DD
export const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD');

// Time slot
export const timeSlotSchema = z.enum(TIME_SLOTS as unknown as [string, ...string[]]);

// Zone preference
export const zonePrefSchema = z.enum(['any', 'indoor', 'outdoor', 'beachside', 'rooftop']);

// Public Table Booking Request
export const createReservationSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  email: z.string().trim().email('Invalid email address').optional().or(z.literal('')),
  phone: phoneSchema,
  locationId: z.string().min(1, 'Please select a location'),
  date: dateSchema,
  time: timeSlotSchema,
  guests: z.coerce.number().int().min(1, 'At least 1 guest required').max(12, 'Online bookings capped at 12 guests. For larger parties, please contact us directly.'),
  seating: zonePrefSchema.default('any'),
  occasion: z.enum(['', 'birthday', 'anniversary', 'date', 'business', 'other']).default(''),
  notes: z.string().max(300, 'Notes cannot exceed 300 characters').default('')
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

// Live Availability Query
export const availabilityQuerySchema = z.object({
  locationId: z.string(),
  date: dateSchema,
  guests: z.coerce.number().int().min(1).max(12),
  seating: zonePrefSchema.optional().default('any')
});

export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>;

// Self-Service Lookup Request (Requires 4-digit phone validation to prevent credential guessing)
export const lookupReservationSchema = z.object({
  bookingCode: z.string().trim().toUpperCase().regex(/^(BF-)?[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4,6}$/, 'Invalid Booking Reference format'),
  phoneLast4: z.string().trim().regex(/^\d{4}$/, 'Please enter the last 4 digits of your phone number for verification')
});

export type LookupReservationInput = z.infer<typeof lookupReservationSchema>;

// Self-Service Cancellation Request
export const cancelReservationSchema = z.object({
  bookingCode: z.string().trim().toUpperCase().regex(/^(BF-)?[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4,6}$/, 'Invalid Booking Reference format'),
  phoneLast4: z.string().trim().regex(/^\d{4}$/, 'Please enter the last 4 digits of your phone number for verification'),
  reason: z.string().max(200).optional()
});

export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;

// Walk-in Seating (Manager direct seat from floor map)
export const walkInReservationSchema = z.object({
  locationId: z.string().min(1),
  tableId: z.string().min(1),
  guests: z.coerce.number().int().min(1).max(16),
  name: z.string().trim().default('Walk-in Guest'),
  phone: z.string().trim().optional().default(''),
  notes: z.string().max(200).optional().default('Walk-in seated from floor map')
});

export type WalkInReservationInput = z.infer<typeof walkInReservationSchema>;

// Manager Status Update
export const updateReservationStatusSchema = z.object({
  status: z.enum([
    RESERVATION_STATUS.CONFIRMED,
    RESERVATION_STATUS.SEATED,
    RESERVATION_STATUS.COMPLETED,
    RESERVATION_STATUS.CANCELLED,
    RESERVATION_STATUS.NO_SHOW
  ])
});

export type UpdateReservationStatusInput = z.infer<typeof updateReservationStatusSchema>;

// Staff / Manager Login
export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

export type LoginInput = z.infer<typeof loginSchema>;
