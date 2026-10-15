-- Transactional outbox.
--
-- The dual-write problem: a service commits its database change and then publishes to Kafka.
-- If Kafka is down (or the process dies) between the two, the change exists but the event is
-- lost. Instead, services insert the event here IN THE SAME TRANSACTION as the change - both
-- commit or neither does - and the outbox relay (worker) publishes pending rows to Kafka,
-- retrying for as long as Kafka is unavailable.

CREATE TABLE IF NOT EXISTS outbox_events (
  -- bigserial: insert order = publish order
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  event_type text NOT NULL,
  topic text NOT NULL,
  message_key text NOT NULL,
  envelope jsonb NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- PENDING -> PUBLISHED; FAILED only for errors retrying can't fix (needs a look)
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  -- retry backoff: the relay only picks rows whose time has come
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

-- The relay's poll: next pending rows in order. Partial, so it only ever holds the small
-- backlog, not the published history.
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
  ON outbox_events (available_at, id) WHERE status = 'PENDING';

-- Daily cleanup of published rows
CREATE INDEX IF NOT EXISTS idx_outbox_events_published_at
  ON outbox_events (published_at) WHERE status = 'PUBLISHED';
