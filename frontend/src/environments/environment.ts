export const environment = {
  production: false,
  // apiUrl: 'http://localhost:3000',
  apiUrl: 'http://backend-service:3000',
  appName: 'SmartWorkforce AI',
  version: '1.0.0',
  enableDebugMode: true,
  websocketUrl: 'ws://localhost:3000',
  supportedLanguages: ['en', 'es', 'fr'],
  defaultLanguage: 'en',
  sessionTimeout: 3600000, // 1 hour in milliseconds
  apiTimeout: 30000, // 30 seconds
  chartRefreshInterval: 30000, // 30 seconds
  notificationDuration: 5000, // 5 seconds
  features: {
    analytics: true,
    notifications: true,
    darkMode: true,
    exportData: true,
    realTimeUpdates: true
  }
};