-- Shared in-app notification delivery queue (PostgreSQL 17+)
-- Additive migration. Does not modify legacy announcements, class posts,
-- notification_reads, attendance reminders or attendance records.

BEGIN;

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id BIGSERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    recipient_type TEXT NOT NULL CHECK (recipient_type IN ('staff', 'student')),
    recipient_id INTEGER NOT NULL CHECK (recipient_id > 0),
    category TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id BIGINT NOT NULL CHECK (source_id > 0),
    channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel = 'in_app'),
    idempotency_key TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    destination TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'delivered', 'read', 'cancelled', 'failed')),
    delivered_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, idempotency_key),
    CHECK (length(trim(idempotency_key)) > 0),
    CHECK (length(trim(category)) > 0),
    CHECK (length(trim(source_type)) > 0),
    CHECK (length(trim(title)) > 0),
    CHECK (destination IS NULL OR destination LIKE '/%'),
    CHECK (
        (status = 'delivered' AND delivered_at IS NOT NULL)
        OR status <> 'delivered'
    ),
    CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL)
        OR status <> 'cancelled'
    )
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due
    ON notification_deliveries (scheduled_at, id)
    WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_recipient
    ON notification_deliveries
       (school_id, recipient_type, recipient_id, status, delivered_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_source
    ON notification_deliveries (school_id, source_type, source_id, status);

COMMIT;
