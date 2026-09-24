const { eventBus } = require('./EventBus');
const AuditHandler = require('./handlers/auditHandler');
const AnalyticsHandler = require('./handlers/analyticsHandler');

// Initialize all event handlers
const initializeEventHandlers = () => {
  console.log('🚀 Initializing event handlers...');
  
  try {
    // Initialize audit logging handlers
    AuditHandler.initialize(eventBus);
    
    // Initialize analytics handlers
    AnalyticsHandler.initialize(eventBus);
    
    console.log('✅ All event handlers initialized successfully');
    
    // Log event bus statistics
    const stats = eventBus.getEventStats();
    console.log('📊 Event bus ready:', {
      maxListeners: eventBus.getMaxListeners(),
      eventHistory: stats.totalEvents
    });
    
  } catch (error) {
    console.error('❌ Error initializing event handlers:', error);
    throw error;
  }
};

module.exports = {
  eventBus,
  initializeEventHandlers
};