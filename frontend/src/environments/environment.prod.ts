export const environment = {
  production: true,
  apiUrl: 'https://api.smartworkforce.com',
  appName: 'SmartWorkforce AI',
  version: '1.0.0',
  enableDebugMode: false,
  websocketUrl: 'wss://api.smartworkforce.com',
  supportedLanguages: ['en', 'es', 'fr'],
  defaultLanguage: 'en',
  sessionTimeout: 3600000, // 1 hour in milliseconds
  apiTimeout: 30000, // 30 seconds
  chartRefreshInterval: 60000, // 1 minute for production
  notificationDuration: 5000, // 5 seconds
  features: {
    analytics: true,
    notifications: true,
    darkMode: true,
    exportData: true,
    realTimeUpdates: true
  },
  logging: {
    level: 'error',
    enableConsoleLog: false,
    enableRemoteLog: true,
    logEndpoint: 'https://api.smartworkforce.com/logs'
  },
  security: {
    enableCSP: true,
    enableHttps: true,
    secureCookies: true
  }
};