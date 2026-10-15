// Publishes EMPLOYEE_BIRTHDAY for everyone whose birthday it is *in their organization's
// timezone*. Runs hourly; the first run after local midnight does the work and later runs
// find the day already claimed.
//
// Exactly-once per org per day comes from a Redis claim (SET NX EX) on
// "job:birthday:{orgId}:{localDate}" - safe across replicas, restarts and catch-up runs.
// If Redis is down, the job still runs (missing a birthday is worse than a rare duplicate).
// If Kafka is down (publish returns false), the claim is released so the next hourly run retries.

const { v5: uuidv5 } = require('uuid');
const { localDateIn } = require('../../utils/dates');

const CLAIM_TTL_SECONDS = 26 * 60 * 60; // a day plus slack for DST/clock skew

// Fixed namespace for deriving event ids. The same employee + day always gets the same
// eventId, so if a day is retried (Kafka was down part-way) the re-published events are
// recognised as duplicates by consumers instead of wishing someone happy birthday twice.
const BIRTHDAY_EVENT_NAMESPACE = '5b0d7a8e-3f1c-4e6a-9d2b-7c4e1f0a9b63';
const birthdayEventId = (organizationId, userId, localDate) =>
  uuidv5(`EMPLOYEE_BIRTHDAY:${organizationId}:${userId}:${localDate}`, BIRTHDAY_EVENT_NAMESPACE);

const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

// 29 Feb birthdays are celebrated on 28 Feb in non-leap years
function hasBirthdayOn(dateOfBirth, localDate) {
  const birthMonthDay = String(dateOfBirth).slice(5, 10);
  const todayMonthDay = localDate.slice(5, 10);
  if (birthMonthDay === todayMonthDay) return true;
  return birthMonthDay === '02-29' && todayMonthDay === '02-28' && !isLeapYear(Number(localDate.slice(0, 4)));
}

function createBirthdayJob({ organizationRepository, userRepository, claim, release, publish, eventType, logger = console, now = () => new Date() }) {
  return async function runBirthdayJob() {
    const organizations = await organizationRepository.findAllActive();
    let published = 0;
    let orgsProcessed = 0;

    for (const org of organizations) {
      const localDate = localDateIn(org.timezone, now());
      const claimKey = `job:birthday:${org.id}:${localDate}`;
      const claimed = await claim(claimKey, { at: now().toISOString() }, CLAIM_TTL_SECONDS);

      if (claimed === false) continue; // already done today (another run or replica)
      if (claimed === null) {
        logger.warn(`[birthday-job] Redis unavailable - running ${org.id} for ${localDate} without a claim`);
      }

      const users = await userRepository.findWithBirthdays(org.id);
      let failed = 0;
      for (const user of users.filter(u => hasBirthdayOn(u.dateOfBirth, localDate))) {
        const options = { eventId: birthdayEventId(org.id, user.id, localDate) };
        if (await publish(eventType, org.id, { userId: user.id, date: localDate }, options)) {
          published += 1;
        } else {
          failed += 1;
        }
      }

      if (failed > 0) {
        // Give the day back so the next run retries. The ones that did succeed are re-published
        // with the same deterministic eventId, so consumers skip them as duplicates.
        logger.warn(`[birthday-job] ${failed} birthday event(s) for ${org.id} not published - will retry next run`);
        if (claimed) await release(claimKey);
      }
      orgsProcessed += 1;
    }

    return { orgsProcessed, published };
  };
}

module.exports = { createBirthdayJob, localDateIn, hasBirthdayOn, birthdayEventId };
