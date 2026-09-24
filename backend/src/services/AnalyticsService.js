const { AttendanceLog, AiInsight, User } = require('../models');

class AnalyticsService {
  static async generateLateArrivalInsight(userId, organizationId) {
    try {
      // Get last 30 days of attendance
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const attendanceRecords = await AttendanceLog.findAll({
        where: {
          userId,
          organizationId,
          date: {
            [require('sequelize').Op.gte]: thirtyDaysAgo
          }
        },
        order: [['date', 'DESC']]
      });

      if (attendanceRecords.length === 0) {
        return null;
      }

      // Calculate late arrivals (assuming 9:00 AM is standard start time)
      const standardStartTime = '09:00:00';
      let lateCount = 0;
      let totalLateMins = 0;

      attendanceRecords.forEach(record => {
        if (record.checkInTime) {
          const checkInTime = record.checkInTime; // already a plain "HH:MM:SS" time value
          if (checkInTime > standardStartTime) {
            lateCount++;
            // Calculate late minutes (simplified)
            const checkIn = new Date(`2000-01-01 ${checkInTime}`);
            const standard = new Date(`2000-01-01 ${standardStartTime}`);
            const lateMins = Math.max(0, (checkIn - standard) / (1000 * 60));
            totalLateMins += lateMins;
          }
        }
      });

      const latePercentage = (lateCount / attendanceRecords.length) * 100;
      const avgLateMins = lateCount > 0 ? totalLateMins / lateCount : 0;

      // Determine insight score (0-100, lower is better for lateness)
      let score = Math.max(0, 100 - (latePercentage * 2) - (avgLateMins / 2));

      const insight = {
        userId,
        organizationId,
        insight_type: 'late_arrival_pattern',
        score: Math.round(score),
        metadata: {
          late_days: lateCount,
          total_days: attendanceRecords.length,
          late_percentage: Math.round(latePercentage * 100) / 100,
          avg_late_minutes: Math.round(avgLateMins * 100) / 100,
          period: '30_days',
          explanation: this.generateLateArrivalExplanation(latePercentage, avgLateMins)
        }
      };

      return insight;
    } catch (error) {
      console.error('Error generating late arrival insight:', error);
      return null;
    }
  }

  static async generateBehaviorPatternInsight(userId, organizationId) {
    try {
      // Get last 60 days of attendance for pattern analysis
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      const attendanceRecords = await AttendanceLog.findAll({
        where: {
          userId,
          organizationId,
          date: {
            [require('sequelize').Op.gte]: sixtyDaysAgo
          }
        },
        order: [['date', 'ASC']]
      });

      if (attendanceRecords.length < 10) {
        return null;
      }

      // Analyze weekday patterns
      const weekdayPatterns = {
        1: [], // Monday
        2: [], // Tuesday
        3: [], // Wednesday
        4: [], // Thursday
        5: [], // Friday
        6: [], // Saturday
        7: []  // Sunday
      };

      attendanceRecords.forEach(record => {
        const date = new Date(record.date);
        const weekday = date.getDay() || 7; // Convert Sunday from 0 to 7
        
        if (record.checkInTime && record.checkOutTime) {
          const checkIn = new Date(`${record.date} ${record.checkInTime}`);
          const checkOut = new Date(`${record.date} ${record.checkOutTime}`);
          const hoursWorked = (checkOut - checkIn) / (1000 * 60 * 60);
          
          weekdayPatterns[weekday].push({
            hoursWorked,
            isLate: record.checkInTime > '09:00:00'
          });
        }
      });

      // Calculate pattern insights
      let mostProductiveDay = null;
      let maxAvgHours = 0;
      let consistencyScore = 100;

      Object.keys(weekdayPatterns).forEach(day => {
        const dayData = weekdayPatterns[day];
        if (dayData.length > 0) {
          const avgHours = dayData.reduce((sum, d) => sum + d.hoursWorked, 0) / dayData.length;
          const latePercentage = dayData.filter(d => d.isLate).length / dayData.length;
          
          if (avgHours > maxAvgHours) {
            maxAvgHours = avgHours;
            mostProductiveDay = this.getDayName(parseInt(day));
          }

          // Reduce consistency score for high variation
          const variance = dayData.reduce((sum, d) => sum + Math.pow(d.hoursWorked - avgHours, 2), 0) / dayData.length;
          consistencyScore -= variance * 5;
        }
      });

      consistencyScore = Math.max(0, Math.min(100, consistencyScore));

      const insight = {
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

      return insight;
    } catch (error) {
      console.error('Error generating behavior pattern insight:', error);
      return null;
    }
  }

  static async generateAnomalyDetection(userId, organizationId) {
    try {
      // Get last 90 days for anomaly detection
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const attendanceRecords = await AttendanceLog.findAll({
        where: {
          userId,
          organizationId,
          date: {
            [require('sequelize').Op.gte]: ninetyDaysAgo
          }
        },
        order: [['date', 'ASC']]
      });

      if (attendanceRecords.length < 20) {
        return null;
      }

      // Calculate work hours for each day
      const workHours = [];
      attendanceRecords.forEach(record => {
        if (record.checkInTime && record.checkOutTime) {
          const checkIn = new Date(`${record.date} ${record.checkInTime}`);
          const checkOut = new Date(`${record.date} ${record.checkOutTime}`);
          const hours = (checkOut - checkIn) / (1000 * 60 * 60);
          workHours.push(hours);
        }
      });

      if (workHours.length === 0) {
        return null;
      }

      // Calculate statistical measures
      const mean = workHours.reduce((sum, h) => sum + h, 0) / workHours.length;
      const variance = workHours.reduce((sum, h) => sum + Math.pow(h - mean, 2), 0) / workHours.length;
      const stdDev = Math.sqrt(variance);

      // Detect anomalies (values more than 2 standard deviations from mean)
      const anomalies = workHours.filter(h => Math.abs(h - mean) > 2 * stdDev);
      const anomalyPercentage = (anomalies.length / workHours.length) * 100;

      // Calculate stability score (higher is better)
      let stabilityScore = Math.max(0, 100 - (anomalyPercentage * 10) - (stdDev * 5));

      const insight = {
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

      return insight;
    } catch (error) {
      console.error('Error generating anomaly detection insight:', error);
      return null;
    }
  }

  static async storeInsight(insightData) {
    try {
      return await AiInsight.create({
        ...insightData,
        generated_at: new Date()
      });
    } catch (error) {
      console.error('Error storing insight:', error);
      return null;
    }
  }

  static async getInsightsForUser(userId, organizationId, limit = 10) {
    try {
      return await AiInsight.findAll({
        where: {
          userId,
          organizationId
        },
        order: [['generated_at', 'DESC']],
        limit
      });
    } catch (error) {
      console.error('Error retrieving insights:', error);
      return [];
    }
  }

  static async getTeamInsights(organizationId, limit = 50) {
    try {
      return await AiInsight.findAll({
        where: {
          organizationId
        },
        include: [{
          model: User,
          attributes: ['name', 'email']
        }],
        order: [['generated_at', 'DESC']],
        limit
      });
    } catch (error) {
      console.error('Error retrieving team insights:', error);
      return [];
    }
  }

  // Helper methods
  static generateLateArrivalExplanation(latePercentage, avgLateMins) {
    if (latePercentage < 5) {
      return "Excellent punctuality! Very rarely late to work.";
    } else if (latePercentage < 15) {
      return `Mostly punctual with ${latePercentage.toFixed(1)}% late arrivals.`;
    } else if (latePercentage < 30) {
      return `Moderate lateness concern. Late ${latePercentage.toFixed(1)}% of the time, averaging ${avgLateMins.toFixed(0)} minutes.`;
    } else {
      return `Significant punctuality issue. Late ${latePercentage.toFixed(1)}% of the time, averaging ${avgLateMins.toFixed(0)} minutes late.`;
    }
  }

  static generateBehaviorPatternExplanation(mostProductiveDay, consistencyScore) {
    const consistency = consistencyScore > 80 ? "very consistent" : 
                       consistencyScore > 60 ? "moderately consistent" : "inconsistent";
    
    return `Most productive on ${mostProductiveDay}s. Work pattern is ${consistency} (${consistencyScore.toFixed(0)}% consistency score).`;
  }

  static generateAnomalyExplanation(anomalyPercentage, stabilityScore) {
    if (stabilityScore > 80) {
      return "Very stable work pattern with minimal anomalies.";
    } else if (stabilityScore > 60) {
      return `Generally stable with ${anomalyPercentage.toFixed(1)}% anomalous days.`;
    } else {
      return `Irregular work pattern with ${anomalyPercentage.toFixed(1)}% anomalous days. May indicate schedule flexibility needs.`;
    }
  }

  static getDayName(dayNumber) {
    const days = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return days[dayNumber] || 'Unknown';
  }
}

module.exports = AnalyticsService;