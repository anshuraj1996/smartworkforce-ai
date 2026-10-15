-- migrate:no-transaction
--
-- Idempotent consumers. Kafka delivers at-least-once: after a crash or a consumer-group
-- rebalance, events that were handled but not yet committed are delivered again.

-- 1) Which events each consumer group has already handled (keyed by the envelope's eventId).
--    The worker runtime checks this before calling a handler and records it afterwards.
--    Rows are pruned after 14 days by the worker's cleanup job (Kafka can't redeliver
--    anything older than its retention).
CREATE TABLE IF NOT EXISTS processed_events (
  consumer_group text NOT NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_group, event_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at
  ON processed_events (processed_at);

-- 2) Belt and braces for notifications: a crash between "notifications inserted" and
--    "event marked processed" would still redeliver the event. With this index the second
--    insert for the same user + event is skipped (INSERT ... ON CONFLICT DO NOTHING), so a
--    notification can never appear twice. Partial: only worker-created notifications carry
--    an eventId.
DROP INDEX CONCURRENTLY IF EXISTS uq_notifications_user_event;
CREATE UNIQUE INDEX CONCURRENTLY uq_notifications_user_event
  ON notifications (user_id, (metadata->>'eventId'))
  WHERE metadata ? 'eventId';
