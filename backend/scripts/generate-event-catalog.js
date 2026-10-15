// Generates src/events/EVENTS.md from the event contracts, so the catalog can't drift from
// the code. Run: npm run events:catalog   (a test fails if the committed file is stale)
const fs = require('fs');
const path = require('path');
const { DEFINITIONS, TOPICS } = require('../src/events/contracts');
const { ENVELOPE_VERSION } = require('../src/events/contracts/envelope');

const OUTPUT = path.join(__dirname, '..', 'src', 'events', 'EVENTS.md');

// Joi field description -> readable type
function describeField(field) {
  const rules = (field.rules || []).map(r => r.name);
  const allowed = (field.allow || []).filter(v => v !== null && v !== '');
  const nullable = (field.allow || []).includes(null);
  let type = field.type;

  if (field.flags && field.flags.only && allowed.length) {
    type = allowed.map(v => `\`${v}\``).join(' \\| ');
  } else if (rules.includes('guid')) {
    type = 'uuid';
  } else if (rules.includes('pattern')) {
    const source = String(field.rules.find(r => r.name === 'pattern').args.regex);
    type = source.includes('\\d{4}-\\d{2}-\\d{2}') ? 'date (YYYY-MM-DD)' : source.includes(':') ? 'time (HH:MM:SS)' : 'string';
  } else if (type === 'number' && rules.includes('integer')) {
    type = 'integer';
  }

  return nullable ? `${type} \\| null` : type;
}

function renderSchema(schema) {
  const { keys } = schema.describe();
  return [
    '| Field | Type | Required |',
    '|---|---|---|',
    ...Object.entries(keys).map(([name, field]) =>
      `| \`${name}\` | ${describeField(field)} | ${field.flags && field.flags.presence === 'required' ? 'yes' : 'no'} |`)
  ].join('\n');
}

function render() {
  const byTopic = Object.values(TOPICS).map(topic => ({
    topic,
    events: DEFINITIONS.filter(d => d.topic === topic)
  }));

  const lines = [
    '# Event Catalog',
    '',
    '> Generated from `src/events/contracts` by `npm run events:catalog` - do not edit by hand.',
    '',
    '## Envelope',
    '',
    `Every message on every topic is wrapped in the same envelope (envelope version ${ENVELOPE_VERSION}). Only \`data\` differs per event.`,
    '',
    '```json',
    JSON.stringify({
      eventId: 'uuid - unique per event, use it for idempotency',
      eventType: 'WFH_APPROVED',
      eventVersion: 1,
      envelopeVersion: ENVELOPE_VERSION,
      occurredAt: '2026-09-25T10:15:00.000Z',
      source: 'smartworkforce-backend',
      organizationId: 'uuid of the tenant',
      data: {}
    }, null, 2),
    '```',
    '',
    'Kafka headers `event-type`, `event-version` and `event-id` repeat the envelope fields so consumers can filter without parsing the body. The message **key** is the field listed under each event (e.g. `userId`), so all events for one employee land on the same partition, in order.',
    '',
    '## Versioning rules',
    '',
    '- **Non-breaking** (same `eventVersion`): adding an optional field.',
    '- **Breaking** (new `eventVersion`): removing or renaming a field, changing its type, or making it required. Add a new definition with `version + 1` and keep the old one in the contracts so messages already on the topic still validate.',
    '- Producers always emit the latest version.',
    '- Consumers must ignore fields they don\'t know, and skip (with a log line) versions they don\'t support.',
    '- Payloads carry ids, dates and enums only - no names, emails or other personal data.',
    '',
    '## Topics',
    '',
    '| Topic | Events |',
    '|---|---|',
    ...byTopic.map(({ topic, events }) => `| \`${topic}\` | ${events.map(e => `[${e.type}](#${e.type.toLowerCase()})`).join(', ')} |`),
    ''
  ];

  byTopic.forEach(({ topic, events }) => {
    lines.push(`## \`${topic}\``, '');
    events.forEach(e => {
      lines.push(
        `### ${e.type}`,
        '',
        e.description,
        '',
        `- **Version:** ${e.version}`,
        `- **Key:** \`${e.key}\``,
        `- **Producer:** ${e.producer}`,
        '',
        renderSchema(e.schema),
        '',
        'Example `data`:',
        '',
        '```json',
        JSON.stringify(e.example, null, 2),
        '```',
        ''
      );
    });
  });

  return lines.join('\n');
}

module.exports = { render, OUTPUT };

if (require.main === module) {
  fs.writeFileSync(OUTPUT, render());
  console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)} (${DEFINITIONS.length} events)`);
}
