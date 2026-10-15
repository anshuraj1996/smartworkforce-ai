// Runs EXPLAIN (ANALYZE, BUFFERS) on the hot queries the repositories issue and prints a
// one-line verdict per query: time, indexes used, and any sequential scans.
//
//   npm run db:explain              # summary table
//   npm run db:explain -- --plans   # also print each full plan tree
//
// Read-only: every query is a SELECT. ANALYZE really executes them (that's how it gets real
// timings), so point it at a copy of production-sized data rather than an empty dev DB -
// on a tiny table Postgres correctly prefers a Seq Scan and the output looks misleading.
//
// Typical use: run it, apply migrations (npm run db:migrate), run it again, compare.
require('dotenv').config();
const { Client } = require('pg');
const { resolveSchema } = require('../src/database/schema');

const SHOW_PLANS = process.argv.includes('--plans');

// Each mirrors a repository query (same filters/order), with $n params from sample data
const QUERIES = [
  {
    name: 'pending leave approvals (LeaveRepository.findPending)',
    sql: `SELECT * FROM leave_requests WHERE organization_id = $1 AND status = 'PENDING' ORDER BY created_at ASC`,
    params: s => [s.orgId]
  },
  {
    name: 'pending WFH approvals (WfhRepository.findPending)',
    sql: `SELECT * FROM wfh_requests WHERE organization_id = $1 AND status = 'PENDING' ORDER BY created_at ASC`,
    params: s => [s.orgId]
  },
  {
    name: 'leave overlap check (LeaveRepository.findOverlapping)',
    sql: `SELECT id FROM leave_requests WHERE user_id = $1 AND status IN ('PENDING', 'APPROVED')
          AND start_date <= $2 AND end_date >= $3 LIMIT 1`,
    params: s => [s.userId, s.today, s.today]
  },
  {
    name: 'team members of a manager (UserRepository.findActiveMembers)',
    sql: `SELECT id, name, department FROM users WHERE organization_id = $1 AND is_active AND manager_id = $2`,
    params: s => [s.orgId, s.managerId]
  },
  {
    name: 'all active users in org (UserRepository.findActiveInOrg)',
    sql: `SELECT id FROM users WHERE organization_id = $1 AND is_active`,
    params: s => [s.orgId]
  },
  {
    name: 'email lookup in org (UserRepository.findByEmailInOrg)',
    sql: `SELECT id FROM users WHERE organization_id = $1 AND lower(email) = $2`,
    params: s => [s.orgId, s.email]
  },
  {
    name: 'team attendance today (AttendanceRepository.findForUsersOnDate)',
    sql: `SELECT * FROM attendance_logs WHERE user_id = ANY($1) AND date = $2`,
    params: s => [s.teamIds, s.today]
  },
  {
    name: '90-day history for insights (AttendanceRepository.findForUsersSince)',
    sql: `SELECT * FROM attendance_logs WHERE user_id = ANY($1) AND date >= $2 AND organization_id = $3 ORDER BY date ASC`,
    params: s => [s.teamIds, s.daysAgo90, s.orgId]
  },
  {
    name: 'unread notification count (NotificationRepository.countUnread)',
    sql: `SELECT count(*) FROM notifications WHERE user_id = $1 AND is_read = false`,
    params: s => [s.userId]
  },
  {
    name: 'notification list (NotificationRepository.findForUser)',
    sql: `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    params: s => [s.userId]
  },
  {
    name: 'recent org activity (AuditLogRepository.findRecent)',
    sql: `SELECT * FROM audit_logs WHERE organization_id = $1 ORDER BY "timestamp" DESC LIMIT 20`,
    params: s => [s.orgId]
  },
  {
    name: 'login history (AuditLogRepository.findLogins)',
    sql: `SELECT * FROM audit_logs WHERE actor_id = $1 AND action = 'LOGIN' ORDER BY "timestamp" DESC LIMIT 20`,
    params: s => [s.userId]
  },
  {
    name: 'insight history (AiInsightRepository.findHistory)',
    sql: `SELECT * FROM ai_insights WHERE organization_id = $1 ORDER BY generated_at DESC LIMIT 50`,
    params: s => [s.orgId]
  }
];

// Walk the JSON plan tree collecting node types, indexes, and seq-scanned tables
function summarize(plan) {
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    (node.Plans || []).forEach(walk);
  };
  walk(plan.Plan);

  return {
    timeMs: plan['Execution Time'],
    indexes: [...new Set(nodes.filter(n => n['Index Name']).map(n => n['Index Name']))],
    seqScans: [...new Set(nodes.filter(n => n['Node Type'] === 'Seq Scan').map(n => n['Relation Name']))],
    rows: plan.Plan['Actual Rows']
  };
}

async function sampleData(client) {
  const { rows: [org] } = await client.query(`SELECT id FROM organizations WHERE is_active ORDER BY created_at LIMIT 1`);
  if (!org) throw new Error('No organization found - seed the database first (npm run db:init)');

  const { rows: [manager] } = await client.query(
    `SELECT manager_id AS id FROM users WHERE organization_id = $1 AND manager_id IS NOT NULL GROUP BY manager_id ORDER BY count(*) DESC LIMIT 1`,
    [org.id]
  );
  const { rows: [user] } = await client.query(`SELECT id, email FROM users WHERE organization_id = $1 ORDER BY created_at LIMIT 1`, [org.id]);
  const { rows: team } = await client.query(`SELECT id FROM users WHERE organization_id = $1 AND is_active LIMIT 30`, [org.id]);

  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  return {
    orgId: org.id,
    managerId: manager ? manager.id : user.id,
    userId: user.id,
    email: user.email.toLowerCase(),
    teamIds: team.map(t => t.id),
    today: day(0),
    daysAgo90: day(-90)
  };
}

async function main() {
  const schema = resolveSchema();
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
  });
  await client.connect();

  try {
    await client.query(`SET search_path TO "${schema}"`);
    const sample = await sampleData(client);

    console.log(`\nEXPLAIN ANALYZE on ${QUERIES.length} queries (schema "${schema}")\n`);
    for (const q of QUERIES) {
      const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}`, q.params(sample));
      const plan = rows[0]['QUERY PLAN'][0];
      const s = summarize(plan);

      const verdict = s.seqScans.length ? `SEQ SCAN on ${s.seqScans.join(', ')}` : 'index only';
      console.log(`${s.timeMs.toFixed(2).padStart(9)} ms  ${verdict.padEnd(32)} ${q.name}`);
      if (s.indexes.length) console.log(`${' '.repeat(14)}indexes: ${s.indexes.join(', ')}`);

      if (SHOW_PLANS) {
        const { rows: text } = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${q.sql}`, q.params(sample));
        console.log(text.map(r => `    ${r['QUERY PLAN']}`).join('\n'));
      }
    }
    console.log('\nA Seq Scan is expected (and correct) on small tables; it matters once a table has thousands of rows.\n');
  } finally {
    await client.end();
  }
}

module.exports = { summarize, QUERIES };

if (require.main === module) {
  main().catch((error) => {
    console.error('[db:explain] Failed:', error.message);
    process.exit(1);
  });
}
