const { AiInsight } = require('../../models');
const { EVENT_TYPES } = require('../EventBus');
const { AnalyticsService } = require('../../services/AnalyticsService');

class AnalyticsHandler {
  static initialize(eventBus) {
    // Attendance events that trigger analytics
    eventBus.onEvent(EVENT_TYPES.ATTENDANCE_CHECKED_IN, this.handleAttendanceCheckIn);
    eventBus.onEvent(EVENT_TYPES.ATTENDANCE_CHECKED_OUT, this.handleAttendanceCheckOut);
    eventBus.onEvent(EVENT_TYPES.ATTENDANCE_LATE_ARRIVAL, this.handleLateArrival);
    
    // Leave events that trigger analytics
    eventBus.onEvent(EVENT_TYPES.LEAVE_REQUEST_SUBMITTED, this.handleLeaveSubmitted);
    eventBus.onEvent(EVENT_TYPES.LEAVE_REQUEST_APPROVED, this.handleLeaveApproved);
    
    console.log('🤖 Analytics event handlers initialized');
  }

  static async handleAttendanceCheckIn(event) {
    const { userId, organizationId, attendanceData } = event.data;
    
    try {
      // Check for late arrival pattern
      await AnalyticsService.analyzeLateArrivalPattern(userId, organizationId);
      
      // Check for behavioral patterns
      await AnalyticsService.analyzeBehavioralPattern(userId, organizationId);
      
    } catch (error) {
      console.error('Error in attendance check-in analytics:', error);
    }
  }

  static async handleAttendanceCheckOut(event) {
    const { userId, organizationId, attendanceData } = event.data;
    
    try {
      // Analyze work hours variation
      await AnalyticsService.analyzeWorkHoursVariation(userId, organizationId);
      
      // Check for early departure patterns
      await AnalyticsService.analyzeEarlyDeparturePattern(userId, organizationId);
      
      // Update productivity insights
      await AnalyticsService.updateProductivityInsight(userId, organizationId);
      
    } catch (error) {
      console.error('Error in attendance check-out analytics:', error);
    }
  }

  static async handleLateArrival(event) {
    const { userId, organizationId, attendanceData } = event.data;
    
    try {
      // Generate immediate late arrival insight
      const insight = await AnalyticsService.generateLateArrivalInsight(
        userId, 
        organizationId, 
        attendanceData
      );
      
      if (insight) {
        // Emit AI insight generated event
        event.eventBus.emitEvent(EVENT_TYPES.AI_INSIGHT_GENERATED, {
          userId,
          organizationId,
          insightData: insight
        });
      }
      
    } catch (error) {
      console.error('Error in late arrival analytics:', error);
    }
  }

  static async handleLeaveSubmitted(event) {
    const { userId, organizationId, leaveData } = event.data;
    
    try {
      // Analyze leave pattern
      await AnalyticsService.analyzeLeavePattern(userId, organizationId);
      
      // Check for potential leave abuse
      await AnalyticsService.checkLeaveAbusePattern(userId, organizationId);
      
    } catch (error) {
      console.error('Error in leave submission analytics:', error);
    }
  }

  static async handleLeaveApproved(event) {
    const { userId, organizationId, leaveData } = event.data;
    
    try {
      // Update leave balance analytics
      await AnalyticsService.updateLeaveBalanceInsights(userId, organizationId);
      
      // Analyze team leave impact
      await AnalyticsService.analyzeTeamLeaveImpact(userId, organizationId, leaveData);
      
    } catch (error) {
      console.error('Error in leave approval analytics:', error);
    }
  }

  // Helper method to create AI insights
  static async createAiInsight(insightData) {
    try {
      const insight = await AiInsight.create(insightData);
      console.log(`✨ AI Insight created: ${insight.title} (Score: ${insight.score})`);
      return insight;
    } catch (error) {
      console.error('Error creating AI insight:', error);
      throw error;
    }
  }

  // Real-time anomaly detection
  static async detectAnomalies(userId, organizationId, data) {
    try {
      const anomalies = await AnalyticsService.detectAnomalies(userId, organizationId, data);
      
      for (const anomaly of anomalies) {
        await this.createAiInsight({
          organizationId,
          userId,
          insightType: 'ATTENDANCE_ANOMALY',
          title: anomaly.title,
          description: anomaly.description,
          score: anomaly.score,
          severity: anomaly.severity,
          confidence: anomaly.confidence,
          metadata: anomaly.metadata
        });
      }
      
    } catch (error) {
      console.error('Error in anomaly detection:', error);
    }
  }

  // Predictive analytics for attendance
  static async generatePredictiveInsights(userId, organizationId) {
    try {
      const predictions = await AnalyticsService.generatePredictiveInsights(userId, organizationId);
      
      for (const prediction of predictions) {
        await this.createAiInsight({
          organizationId,
          userId,
          insightType: prediction.type,
          title: prediction.title,
          description: prediction.description,
          score: prediction.score,
          severity: prediction.severity,
          confidence: prediction.confidence,
          metadata: prediction.metadata,
          validUntil: prediction.validUntil
        });
      }
      
    } catch (error) {
      console.error('Error in predictive analytics:', error);
    }
  }

  // Risk assessment for employees
  static async assessEmployeeRisk(userId, organizationId) {
    try {
      const riskAssessment = await AnalyticsService.assessEmployeeRisk(userId, organizationId);
      
      if (riskAssessment && riskAssessment.score > 50) {
        await this.createAiInsight({
          organizationId,
          userId,
          insightType: 'RISK_ASSESSMENT',
          title: riskAssessment.title,
          description: riskAssessment.description,
          score: riskAssessment.score,
          severity: riskAssessment.severity,
          confidence: riskAssessment.confidence,
          metadata: riskAssessment.metadata,
          isActionable: true
        });
      }
      
    } catch (error) {
      console.error('Error in risk assessment:', error);
    }
  }
}

module.exports = AnalyticsHandler;