const { createBirthdayJob, localDateIn, hasBirthdayOn, birthdayEventId } = require('../../workers/jobs/birthdayJob');

const quietLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('localDateIn', () => {
  // 2026-10-07 20:00 UTC is already 8 Oct in India but still 7 Oct in New York
  const instant = new Date('2026-10-07T20:00:00Z');

  it('uses the organization timezone, not the server one', () => {
    expect(localDateIn('Asia/Kolkata', instant)).toBe('2026-10-08');
    expect(localDateIn('America/New_York', instant)).toBe('2026-10-07');
    expect(localDateIn('UTC', instant)).toBe('2026-10-07');
  });

  it('falls back to UTC for an invalid timezone', () => {
    expect(localDateIn('Mars/Olympus', instant)).toBe('2026-10-07');
  });
});

describe('hasBirthdayOn', () => {
  it('matches month and day, any birth year', () => {
    expect(hasBirthdayOn('1994-10-08', '2026-10-08')).toBe(true);
    expect(hasBirthdayOn('1994-10-09', '2026-10-08')).toBe(false);
  });

  it('celebrates 29 Feb birthdays on 28 Feb in non-leap years only', () => {
    expect(hasBirthdayOn('2000-02-29', '2027-02-28')).toBe(true);
    expect(hasBirthdayOn('2000-02-29', '2028-02-28')).toBe(false);
    expect(hasBirthdayOn('2000-02-29', '2028-02-29')).toBe(true);
  });
});

describe('createBirthdayJob', () => {
  const build = ({ claimResult = true, publishResult = true, orgs } = {}) => {
    const deps = {
      organizationRepository: {
        findAllActive: jest.fn().mockResolvedValue(orgs || [{ id: 'org-in', timezone: 'Asia/Kolkata' }, { id: 'org-us', timezone: 'America/New_York' }])
      },
      userRepository: {
        findWithBirthdays: jest.fn().mockResolvedValue([
          { id: 'birthday-8th', dateOfBirth: '1990-10-08' },
          { id: 'birthday-7th', dateOfBirth: '1991-10-07' },
          { id: 'not-today', dateOfBirth: '1992-01-01' }
        ])
      },
      claim: jest.fn().mockResolvedValue(claimResult),
      release: jest.fn(),
      publish: jest.fn().mockResolvedValue(publishResult)
    };
    const run = createBirthdayJob({
      ...deps,
      eventType: 'EMPLOYEE_BIRTHDAY',
      logger: quietLogger,
      now: () => new Date('2026-10-07T20:00:00Z')
    });
    return { run, deps };
  };

  it('publishes per organization for that organization\'s local date', async () => {
    const { run, deps } = build();

    const result = await run();

    expect(deps.publish).toHaveBeenCalledWith('EMPLOYEE_BIRTHDAY', 'org-in', { userId: 'birthday-8th', date: '2026-10-08' }, { eventId: birthdayEventId('org-in', 'birthday-8th', '2026-10-08') });
    expect(deps.publish).toHaveBeenCalledWith('EMPLOYEE_BIRTHDAY', 'org-us', { userId: 'birthday-7th', date: '2026-10-07' }, { eventId: birthdayEventId('org-us', 'birthday-7th', '2026-10-07') });
    expect(deps.publish).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ orgsProcessed: 2, published: 2 });
  });

  it('claims each org-day with a key that expires after ~a day', async () => {
    const { run, deps } = build();

    await run();

    expect(deps.claim).toHaveBeenCalledWith('job:birthday:org-in:2026-10-08', expect.any(Object), 26 * 60 * 60);
    expect(deps.claim).toHaveBeenCalledWith('job:birthday:org-us:2026-10-07', expect.any(Object), 26 * 60 * 60);
  });

  it('does nothing for an org-day another run or replica already claimed', async () => {
    const { run, deps } = build({ claimResult: false });

    expect(await run()).toEqual({ orgsProcessed: 0, published: 0 });
    expect(deps.userRepository.findWithBirthdays).not.toHaveBeenCalled();
  });

  it('still runs when Redis is unavailable (claim returns null)', async () => {
    const { run, deps } = build({ claimResult: null });

    await run();

    expect(deps.publish).toHaveBeenCalledTimes(2);
    expect(quietLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Redis unavailable'));
  });

  it('releases the claim when Kafka is down, so the next hourly run retries', async () => {
    const { run, deps } = build({ publishResult: false, orgs: [{ id: 'org-in', timezone: 'Asia/Kolkata' }] });

    expect(await run()).toEqual({ orgsProcessed: 1, published: 0 });
    expect(deps.release).toHaveBeenCalledWith('job:birthday:org-in:2026-10-08');
  });
});

describe('birthdayEventId', () => {
  // A retried day re-publishes with the SAME eventId, so consumers dedupe it
  it('is a stable UUID per organization + employee + day', () => {
    const id = birthdayEventId('org-1', 'emp-1', '2026-10-08');

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(birthdayEventId('org-1', 'emp-1', '2026-10-08')).toBe(id);
    expect(birthdayEventId('org-1', 'emp-1', '2027-10-08')).not.toBe(id);
    expect(birthdayEventId('org-1', 'emp-2', '2026-10-08')).not.toBe(id);
  });
});
