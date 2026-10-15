const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

// outbox_events (migration 004). Raw SQL: FOR UPDATE SKIP LOCKED and batch status updates
// are clearer here than through a model. Every query joins the ambient transaction
// (database/transaction.js), so add() commits with the caller's business write.
class OutboxRepository {
  async add({ eventId, eventType, topic, key, envelope, headers }) {
    await sequelize.query(
      `INSERT INTO outbox_events (event_id, event_type, topic, message_key, envelope, headers)
       VALUES (:eventId, :eventType, :topic, :key, :envelope, :headers)
       ON CONFLICT (event_id) DO NOTHING`,
      {
        replacements: { eventId, eventType, topic, key, envelope: JSON.stringify(envelope), headers: JSON.stringify(headers) },
        type: QueryTypes.INSERT
      }
    );
  }

  // Next pending rows in insert order, locked for this transaction. SKIP LOCKED: another relay
  // replica skips rows this one holds instead of waiting for them or publishing them twice.
  // Must be called inside a transaction - the locks last until it ends.
  claimPending(limit) {
    return sequelize.query(
      `SELECT id, event_id, event_type, topic, message_key, envelope, headers, attempts
       FROM outbox_events
       WHERE status = 'PENDING' AND available_at <= now()
       ORDER BY id
       LIMIT :limit
       FOR UPDATE SKIP LOCKED`,
      { replacements: { limit }, type: QueryTypes.SELECT }
    );
  }

  async markPublished(ids) {
    if (!ids.length) return;
    await sequelize.query(
      `UPDATE outbox_events SET status = 'PUBLISHED', published_at = now(), attempts = attempts + 1, last_error = NULL
       WHERE id IN (:ids)`,
      { replacements: { ids } }
    );
  }

  async markRetry(ids, error, delaySeconds) {
    if (!ids.length) return;
    await sequelize.query(
      `UPDATE outbox_events
       SET attempts = attempts + 1, last_error = :error, available_at = now() + make_interval(secs => :delaySeconds)
       WHERE id IN (:ids)`,
      { replacements: { ids, error: String(error).slice(0, 1000), delaySeconds } }
    );
  }

  async markFailed(ids, error) {
    if (!ids.length) return;
    await sequelize.query(
      `UPDATE outbox_events SET status = 'FAILED', attempts = attempts + 1, last_error = :error WHERE id IN (:ids)`,
      { replacements: { ids, error: String(error).slice(0, 1000) } }
    );
  }

  // Backlog health for /stats and system health: how many are waiting and for how long
  async pendingSummary() {
    const [row] = await sequelize.query(
      `SELECT count(*)::int AS pending,
              COALESCE(EXTRACT(EPOCH FROM now() - min(created_at)), 0)::int AS oldest_pending_seconds,
              (SELECT count(*)::int FROM outbox_events WHERE status = 'FAILED') AS failed
       FROM outbox_events WHERE status = 'PENDING'`,
      { type: QueryTypes.SELECT }
    );
    return row;
  }

  async deletePublishedBefore(cutoff) {
    const [, result] = await sequelize.query(
      `DELETE FROM outbox_events WHERE status = 'PUBLISHED' AND published_at < :cutoff`,
      { replacements: { cutoff } }
    );
    return result && typeof result.rowCount === 'number' ? result.rowCount : 0;
  }
}

module.exports = OutboxRepository;
