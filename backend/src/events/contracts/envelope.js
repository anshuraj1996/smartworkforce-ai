const Joi = require('joi');
const { randomUUID } = require('crypto');

// Version of the envelope itself (not of any one event). Bump only if the wrapper changes.
const ENVELOPE_VERSION = 1;
const SOURCE = 'smartworkforce-backend';

// Every message on every topic has this shape. The per-event schema only describes `data`.
//
// {
//   "eventId":        "uuid - unique per event; consumers use it for idempotency",
//   "eventType":      "WFH_APPROVED",
//   "eventVersion":   1,
//   "envelopeVersion": 1,
//   "occurredAt":     "2026-09-25T10:15:00.000Z",
//   "source":         "smartworkforce-backend",
//   "organizationId": "tenant the event belongs to",
//   "data":           { ...event-specific fields... }
// }
const envelopeSchema = Joi.object({
  eventId: Joi.string().uuid().required(),
  eventType: Joi.string().pattern(/^[A-Z]+(_[A-Z]+)+$/).required(),
  eventVersion: Joi.number().integer().min(1).required(),
  envelopeVersion: Joi.number().integer().min(1).required(),
  occurredAt: Joi.string().isoDate().required(),
  source: Joi.string().required(),
  organizationId: Joi.string().uuid().required(),
  data: Joi.object().required()
});

function buildEnvelope(definition, organizationId, data, { occurredAt = new Date(), eventId = randomUUID() } = {}) {
  return {
    eventId,
    eventType: definition.type,
    eventVersion: definition.version,
    envelopeVersion: ENVELOPE_VERSION,
    occurredAt: occurredAt.toISOString(),
    source: SOURCE,
    organizationId,
    data
  };
}

module.exports = { ENVELOPE_VERSION, SOURCE, envelopeSchema, buildEnvelope };
