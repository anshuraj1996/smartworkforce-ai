const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

// Which events a consumer group has already handled (table: processed_events, migration 003).
// No Sequelize model - three small raw queries are clearer than a model for a log table.
class ProcessedEventRepository {
  async isProcessed(consumerGroup, eventId) {
    const rows = await sequelize.query(
      'SELECT 1 FROM processed_events WHERE consumer_group = :consumerGroup AND event_id = :eventId',
      { replacements: { consumerGroup, eventId }, type: QueryTypes.SELECT }
    );
    return rows.length > 0;
  }

  // ON CONFLICT: two replicas racing on the same redelivered event both succeed quietly
  async markProcessed(consumerGroup, eventId, eventType) {
    await sequelize.query(
      `INSERT INTO processed_events (consumer_group, event_id, event_type)
       VALUES (:consumerGroup, :eventId, :eventType)
       ON CONFLICT (consumer_group, event_id) DO NOTHING`,
      { replacements: { consumerGroup, eventId, eventType }, type: QueryTypes.INSERT }
    );
  }

  async deleteProcessedBefore(cutoff) {
    const [, result] = await sequelize.query(
      'DELETE FROM processed_events WHERE processed_at < :cutoff',
      { replacements: { cutoff } }
    );
    return result && typeof result.rowCount === 'number' ? result.rowCount : 0;
  }
}

module.exports = ProcessedEventRepository;
