const { EventEmitter } = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // Increase max listeners for production
    this.eventHistory = [];
    this.maxHistorySize = 1000;
  }

  // Enhanced emit with logging and error handling
  emitEvent(eventType, eventData) {
    try {
      const event = {
        type: eventType,
        data: eventData,
        timestamp: new Date(),
        id: this.generateEventId()
      };

      // Store event in history
      this.addToHistory(event);

      // Log event (in production, use proper logging)
      console.log(`📡 Event emitted: ${eventType}`, {
        id: event.id,
        timestamp: event.timestamp,
        dataKeys: Object.keys(eventData || {})
      });

      // Emit the event
      this.emit(eventType, event);

      return event;
    } catch (error) {
      console.error('❌ Error emitting event:', error);
      throw error;
    }
  }

  // Enhanced listener registration with error handling
  onEvent(eventType, handler) {
    const wrappedHandler = async (event) => {
      try {
        await handler(event);
      } catch (error) {
        console.error(`❌ Error in event handler for ${eventType}:`, error);
        // Emit error event for monitoring
        this.emitEvent('EVENT_HANDLER_ERROR', {
          originalEvent: event,
          error: error.message,
          handler: handler.name || 'anonymous'
        });
      }
    };

    this.on(eventType, wrappedHandler);
    console.log(`🔗 Event listener registered for: ${eventType}`);
  }

  // Generate unique event ID
  generateEventId() {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Add event to history
  addToHistory(event) {
    this.eventHistory.push(event);
    
    // Maintain history size
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  // Get event history
  getEventHistory(eventType = null, limit = 100) {
    let events = this.eventHistory;
    
    if (eventType) {
      events = events.filter(event => event.type === eventType);
    }
    
    return events.slice(-limit);
  }

  // Get event statistics
  getEventStats() {
    const stats = {};
    
    this.eventHistory.forEach(event => {
      stats[event.type] = (stats[event.type] || 0) + 1;
    });
    
    return {
      totalEvents: this.eventHistory.length,
      eventTypes: Object.keys(stats).length,
      eventCounts: stats
    };
  }
}

// Create singleton instance
const eventBus = new EventBus();

// Event type constants
const EVENT_TYPES = {
  // Authentication events
  USER_LOGGED_IN: 'USER_LOGGED_IN',
  USER_LOGGED_OUT: 'USER_LOGGED_OUT',
  
  // Attendance events
  ATTENDANCE_CHECKED_IN: 'ATTENDANCE_CHECKED_IN',
  ATTENDANCE_CHECKED_OUT: 'ATTENDANCE_CHECKED_OUT',
  ATTENDANCE_AUTO_CHECKOUT: 'ATTENDANCE_AUTO_CHECKOUT',
  ATTENDANCE_LATE_ARRIVAL: 'ATTENDANCE_LATE_ARRIVAL',
  
  // Leave events
  LEAVE_REQUEST_SUBMITTED: 'LEAVE_REQUEST_SUBMITTED',
  LEAVE_REQUEST_APPROVED: 'LEAVE_REQUEST_APPROVED',
  LEAVE_REQUEST_REJECTED: 'LEAVE_REQUEST_REJECTED',
  LEAVE_REQUEST_CANCELLED: 'LEAVE_REQUEST_CANCELLED',
  
  // AI events
  AI_INSIGHT_GENERATED: 'AI_INSIGHT_GENERATED',
  AI_ANOMALY_DETECTED: 'AI_ANOMALY_DETECTED',
  AI_PATTERN_IDENTIFIED: 'AI_PATTERN_IDENTIFIED',
  
  // System events
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  SYSTEM_WARNING: 'SYSTEM_WARNING',
  BACKGROUND_JOB_STARTED: 'BACKGROUND_JOB_STARTED',
  BACKGROUND_JOB_COMPLETED: 'BACKGROUND_JOB_COMPLETED',
  BACKGROUND_JOB_FAILED: 'BACKGROUND_JOB_FAILED',
  
  // Admin events
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  ORGANIZATION_UPDATED: 'ORGANIZATION_UPDATED',
  
  // Error events
  EVENT_HANDLER_ERROR: 'EVENT_HANDLER_ERROR'
};

// Helper functions for common events
const emitAttendanceEvent = (type, userId, organizationId, attendanceData) => {
  return eventBus.emitEvent(type, {
    userId,
    organizationId,
    attendanceData,
    timestamp: new Date()
  });
};

const emitLeaveEvent = (type, userId, organizationId, leaveData) => {
  return eventBus.emitEvent(type, {
    userId,
    organizationId,
    leaveData,
    timestamp: new Date()
  });
};

const emitAiEvent = (type, userId, organizationId, insightData) => {
  return eventBus.emitEvent(type, {
    userId,
    organizationId,
    insightData,
    timestamp: new Date()
  });
};

const emitSystemEvent = (type, message, metadata = {}) => {
  return eventBus.emitEvent(type, {
    message,
    metadata,
    timestamp: new Date()
  });
};

module.exports = {
  eventBus,
  EVENT_TYPES,
  emitAttendanceEvent,
  emitLeaveEvent,
  emitAiEvent,
  emitSystemEvent
};