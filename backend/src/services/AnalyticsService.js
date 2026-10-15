const repositories = require('../repositories');
const { daysAgoStr } = require('../utils/dates');

// Standard start time these insights measure lateness against. Kept as-is from the original
// heuristic rather than the org's shift, so scores stay comparable with earlier ones.
const STANDARD_START_TIME = '09:00:00';

const hoursWorked = (record) => {
  const checkIn = new Date(`${record.date} ${record.checkInTime}`);
  const checkOut = new Date(`${record.date} ${record.checkOutTime}`);
  return (checkOut - checkIn) / (1000 * 60 * 60);
};

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// History each insight looks at
const WINDOW_DAYS = { late: 30, behavior: 60, anomaly: 90 };

// Heuristic, attendance-derived insights computed on demand (lateness, weekday behaviour,
// z-score anomaly). Each generator returns null when there isn't enough history.
class AnalyticsService {
  constructor({ attendanceRepository }) {
    this.attendanceRepository = attendanceRepository;
  }

  // ---- Per-user (one query each) ----

  async generateLateArrivalInsight(userId, organizationId) {
    const records = await this.attendanceRepository.findForUserSince(userId, organizationId, daysAgoStr(WINDOW_DAYS.late));
    return this.computeLateArrival(userId, organizationId, records);
  }

  async generateBehaviorPatternInsight(userId, organizationId) {
    const records = await this.attendanceRepository.findForUserSince(userId, organizationId, daysAgoStr(WINDOW_DAYS.behavior));
    return this.computeBehaviorPattern(userId, organizationId, records);
  }

  async generateAnomalyDetection(userId, organizationId) {
    const records = await this.attendanceRepository.findForUserSince(userId, organizationId, daysAgoStr(WINDOW_DAYS.anomaly));
    return this.computeAnomaly(userId, organizationId, records);
  }

  // ---- Batch: one query for many users (team/org views) ----

  // Map(userId -> { late, behavior, anomaly }), each null when there isn't enough history.
  // Loads the widest window (90 days) once and slices each generator's window in memory.
  async generateForUsers(userIds, organizationId) {
    const results = new Map();
    if (userIds.length === 0) return results;

    const cutoffs = {
      late: daysAgoStr(WINDOW_DAYS.late),
      behavior: daysAgoStr(WINDOW_DAYS.behavior),
      anomaly: daysAgoStr(WINDOW_DAYS.anomaly)
    };
    const records = await this.attendanceRepository.findForUsersSince(userIds, cutoffs.anomaly, { organizationId });

    const byUser = new Map(userIds.map(id => [id, []]));
    records.forEach(r => byUser.get(r.userId) && byUser.get(r.userId).push(r));

    for (const [userId, userRecords] of byUser) {
      const since = (cutoff) => userRecords.filter(r => r.date >= cutoff);
      results.set(userId, {
        late: this.computeLateArrival(userId, organizationId, since(cutoffs.late)),
        behavior: this.computeBehaviorPattern(userId, organizationId, since(cutoffs.behavior)),
        anomaly: this.computeAnomaly(userId, organizationId, userRecords)
      });
    }
    return results;
  }

  // ---- Pure computations over a user's records (ordered by date) ----

  computeLateArrival(userId, organizationId, records) {

    if (records.length === 0) {
      return null;
    }

    let lateCount = 0;
    let totalLateMins = 0;

    records.forEach(record => {
      if (record.checkInTime && record.checkInTime > STANDARD_START_TIME) {
        lateCount++;
        const checkIn = new Date(`2000-01-01 ${record.checkInTime}`);
        const standard = new Date(`2000-01-01 ${STANDARD_START_TIME}`);
        totalLateMins += Math.max(0, (checkIn - standard) / (1000 * 60));
      }
    });

    const latePercentage = (lateCount / records.length) * 100;
    const avgLateMins = lateCount > 0 ? totalLateMins / lateCount : 0;
    const score = Math.max(0, 100 - (latePercentage * 2) - (avgLateMins / 2));

    return {
      userId,
      organizationId,
      insight_type: 'late_arrival_pattern',
      score: Math.round(score),
      metadata: {
        late_days: lateCount,
        total_days: records.length,
        late_percentage: Math.round(latePercentage * 100) / 100,
        avg_late_minutes: Math.round(avgLateMins * 100) / 100,
        period: '30_days',
        explanation: this.generateLateArrivalExplanation(latePercentage, avgLateMins)
      }
    };
  }

  computeBehaviorPattern(userId, organizationId, records) {

    if (records.length < 10) {
      return null;
    }

    // 1 = Monday ... 7 = Sunday
    const weekdayPatterns = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };

    records.forEach(record => {
      const weekday = new Date(record.date).getDay() || 7;
      if (record.checkInTime && record.checkOutTime) {
        weekdayPatterns[weekday].push({
          hoursWorked: hoursWorked(record),
          isLate: record.checkInTime > STANDARD_START_TIME
        });
      }
    });

    let mostProductiveDay = null;
    let maxAvgHours = 0;
    let consistencyScore = 100;

    Object.keys(weekdayPatterns).forEach(day => {
      const dayData = weekdayPatterns[day];
      if (dayData.length > 0) {
        const avgHours = dayData.reduce((sum, d) => sum + d.hoursWorked, 0) / dayData.length;

        if (avgHours > maxAvgHours) {
          maxAvgHours = avgHours;
          mostProductiveDay = DAY_NAMES[parseInt(day, 10)] || 'Unknown';
        }

        // High variation within a weekday lowers consistency
        const variance = dayData.reduce((sum, d) => sum + Math.pow(d.hoursWorked - avgHours, 2), 0) / dayData.length;
        consistencyScore -= variance * 5;
      }
    });

    consistencyScore = Math.max(0, Math.min(100, consistencyScore));

    return {
      userId,
      organizationId,
      insight_type: 'behavior_pattern',
      score: Math.round(consistencyScore),
      metadata: {
        most_productive_day: mostProductiveDay,
        avg_hours_productive_day: Math.round(maxAvgHours * 100) / 100,
        consistency_score: Math.round(consistencyScore),
        period: '60_days',
        explanation: this.generateBehaviorPatternExplanation(mostProductiveDay, consistencyScore)
      }
    };
  }

  // Days whose working hours are more than 2 standard deviations from the employee's mean
  computeAnomaly(userId, organizationId, records) {

    if (records.length < 20) {
      return null;
    }

    const workHours = records
      .filter(record => record.checkInTime && record.checkOutTime)
      .map(hoursWorked);

    if (workHours.length === 0) {
      return null;
    }

    const mean = workHours.reduce((sum, h) => sum + h, 0) / workHours.length;
    const variance = workHours.reduce((sum, h) => sum + Math.pow(h - mean, 2), 0) / workHours.length;
    const stdDev = Math.sqrt(variance);

    const anomalies = workHours.filter(h => Math.abs(h - mean) > 2 * stdDev);
    const anomalyPercentage = (anomalies.length / workHours.length) * 100;
    const stabilityScore = Math.max(0, 100 - (anomalyPercentage * 10) - (stdDev * 5));

    return {
      userId,
      organizationId,
      insight_type: 'anomaly_detection',
      score: Math.round(stabilityScore),
      metadata: {
        avg_work_hours: Math.round(mean * 100) / 100,
        std_deviation: Math.round(stdDev * 100) / 100,
        anomaly_count: anomalies.length,
        anomaly_percentage: Math.round(anomalyPercentage * 100) / 100,
        stability_score: Math.round(stabilityScore),
        period: '90_days',
        explanation: this.generateAnomalyExplanation(anomalyPercentage, stabilityScore)
      }
    };
  }

  generateLateArrivalExplanation(latePercentage, avgLateMins) {
    if (latePercentage < 5) {
      return 'Excellent punctuality! Very rarely late to work.';
    } else if (latePercentage < 15) {
      return `Mostly punctual with ${latePercentage.toFixed(1)}% late arrivals.`;
    } else if (latePercentage < 30) {
      return `Moderate lateness concern. Late ${latePercentage.toFixed(1)}% of the time, averaging ${avgLateMins.toFixed(0)} minutes.`;
    }
    return `Significant punctuality issue. Late ${latePercentage.toFixed(1)}% of the time, averaging ${avgLateMins.toFixed(0)} minutes late.`;
  }

  generateBehaviorPatternExplanation(mostProductiveDay, consistencyScore) {
    const consistency = consistencyScore > 80 ? 'very consistent'
      : consistencyScore > 60 ? 'moderately consistent' : 'inconsistent';

    return `Most productive on ${mostProductiveDay}s. Work pattern is ${consistency} (${consistencyScore.toFixed(0)}% consistency score).`;
  }

  generateAnomalyExplanation(anomalyPercentage, stabilityScore) {
    if (stabilityScore > 80) {
      return 'Very stable work pattern with minimal anomalies.';
    } else if (stabilityScore > 60) {
      return `Generally stable with ${anomalyPercentage.toFixed(1)}% anomalous days.`;
    }
    return `Irregular work pattern with ${anomalyPercentage.toFixed(1)}% anomalous days. May indicate schedule flexibility needs.`;
  }
}

module.exports = new AnalyticsService({ attendanceRepository: repositories.attendanceRepository });
module.exports.AnalyticsService = AnalyticsService;
