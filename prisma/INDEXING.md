# DreamDay Platform — Indexing Strategy

This document explains why each index and unique constraint exists in the Prisma schema. Indexes are not added "for completeness"; each supports a specific query pattern or integrity rule.

## Unique Constraints

| Constraint | Table | Columns | Purpose |
|------------|--------|---------|---------|
| `uq_event_booking_hall_date` | EventBooking | (eventHallId, eventDate) | **Double-booking prevention.** Guarantees at most one booking per hall per date at the database level; survives race conditions and application bugs. |
| `uq_booking_status_transition_pair` | EventBookingStatusTransitionRule | (fromStatus, toStatus) | Enables FK from EventBookingStatusChange so every recorded transition is a legal one. |
| (PK / unique on id) | All | id | Primary key; UUID for stable references and cross-system correlation. |
| email unique | PlatformUser | email | One account per email. |
| idempotencyKey unique | PaymentTransaction | idempotencyKey | Prevents duplicate charges on retries. |

## Indexes

### PlatformUser
- **idx_platform_user_status_role** `(accountStatus, role)` — Auth/support: "list active operators", "list suspended users".
- **idx_platform_user_deleted_at** `(deletedAt)` — Filter out soft-deleted users in listings and auth checks.

### EventHall
- **idx_event_hall_district_capacity** `(district, capacity)` — Primary discovery: "halls in district X with capacity ≥ Y". Order of columns allows index-only or index-assisted range on capacity after district equality.
- **idx_event_hall_active_not_deleted** `(isActive, deletedAt)` — List only bookable halls (active and not soft-deleted).

### VendorService
- **idx_vendor_service_category_district** `(category, serviceDistrict)` — Discovery by category and region.
- **idx_vendor_service_verified_rating** `(isVerified, rating)` — Ranking and "verified only" filters.
- **idx_vendor_service_deleted_at** `(deletedAt)` — Exclude soft-deleted from search.

### EventBooking
- **idx_event_booking_status** `(bookingStatus)` — Back-office queues: "all PAYMENT_PENDING", "all HOLD_PLACED".
- **idx_event_booking_event_date** `(eventDate)` — Calendar views and date-range reports.
- **idx_event_booking_customer_created** `(customerId, createdAt)` — Customer booking history by recency.

### PaymentTransaction
- **idx_payment_txn_booking_created** `(bookingId, createdAt)` — "All payments for booking X" in order.
- **idx_payment_txn_status_created** `(paymentStatus, createdAt)` — Reconciliation and support: "failed today", "settled this week".

### EventBookingStatusChange
- **idx_booking_status_change_booking_time** `(eventBookingId, changedAt)` — Full status timeline per booking.
- **idx_booking_status_change_to_status_time** `(toStatus, changedAt)` — Analytics: "all transitions to CANCELLED_BY_PLATFORM in last 30 days".

### AuditTrail
- **idx_audit_entity_timeline** `(entityType, entityId, timestamp)` — "Everything that happened to entity X".
- **idx_audit_actor_timeline** `(performedByUserId, timestamp)` — "Everything user Y did".

## Foreign Keys

All FKs use explicit `onDelete`/`onUpdate` to avoid accidental cascades and preserve auditability. EventBooking → EventHall and → PlatformUser use `Restrict` so historical bookings are never orphaned by hall or user deletion. Soft delete (deletedAt) is used instead of hard delete where retention is required.
