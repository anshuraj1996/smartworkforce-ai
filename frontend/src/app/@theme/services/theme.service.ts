import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface Theme {
  name: string;
  displayName: string;
  isDark: boolean;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  error: string;
  warning: string;
  info: string;
  success: string;
}

export const LIGHT_THEME: Theme = {
  name: 'light',
  displayName: 'Light Theme',
  isDark: false,
  primary: '#1976d2',
  secondary: '#424242',
  accent: '#82b1ff',
  background: '#fafafa',
  surface: '#ffffff',
  error: '#f44336',
  warning: '#ff9800',
  info: '#2196f3',
  success: '#4caf50'
};

export const DARK_THEME: Theme = {
  name: 'dark',
  displayName: 'Dark Theme',
  isDark: true,
  primary: '#90caf9',
  secondary: '#ce93d8',
  accent: '#f48fb1',
  background: '#121212',
  surface: '#1e1e1e',
  error: '#cf6679',
  warning: '#ffb74d',
  info: '#64b5f6',
  success: '#81c784'
};

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_STORAGE_KEY = 'smartworkforce-theme';
  private readonly DARK_MODE_STORAGE_KEY = 'smartworkforce-dark-mode';
  
  private currentThemeSubject = new BehaviorSubject<Theme>(LIGHT_THEME);
  private isDarkModeSubject = new BehaviorSubject<boolean>(false);

  public currentTheme$ = this.currentThemeSubject.asObservable();
  public isDarkMode$ = this.isDarkModeSubject.asObservable();

  constructor() {
    this.initializeTheme();
  }

  /**
   * Initialize theme from localStorage or default
   */
  private initializeTheme(): void {
    const savedTheme = localStorage.getItem(this.THEME_STORAGE_KEY);
    const savedDarkMode = localStorage.getItem(this.DARK_MODE_STORAGE_KEY);
    
    let isDark = false;
    
    if (savedDarkMode !== null) {
      isDark = JSON.parse(savedDarkMode);
    } else {
      // Check system preference
      isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    
    const theme = isDark ? DARK_THEME : LIGHT_THEME;
    this.setTheme(theme, false);
    
    // Listen for system theme changes
    this.listenForSystemThemeChanges();
  }

  /**
   * Set the current theme
   */
  setTheme(theme: Theme, save: boolean = true): void {
    this.currentThemeSubject.next(theme);
    this.isDarkModeSubject.next(theme.isDark);
    
    // Apply theme to document
    this.applyThemeToDocument(theme);
    
    // Save to localStorage
    if (save) {
      localStorage.setItem(this.THEME_STORAGE_KEY, theme.name);
      localStorage.setItem(this.DARK_MODE_STORAGE_KEY, JSON.stringify(theme.isDark));
    }
  }

  /**
   * Toggle between light and dark theme
   */
  toggleTheme(): void {
    const currentTheme = this.currentThemeSubject.value;
    const newTheme = currentTheme.isDark ? LIGHT_THEME : DARK_THEME;
    this.setTheme(newTheme);
  }

  /**
   * Set dark mode
   */
  setDarkMode(isDark: boolean): void {
    const theme = isDark ? DARK_THEME : LIGHT_THEME;
    this.setTheme(theme);
  }

  /**
   * Get current theme
   */
  getCurrentTheme(): Theme {
    return this.currentThemeSubject.value;
  }

  /**
   * Check if dark mode is active
   */
  isDarkMode(): boolean {
    return this.isDarkModeSubject.value;
  }

  /**
   * Apply theme variables to document
   */
  private applyThemeToDocument(theme: Theme): void {
    const root = document.documentElement;
    
    // Remove existing theme classes
    root.classList.remove('light-theme', 'dark-theme');
    
    // Add new theme class
    root.classList.add(theme.isDark ? 'dark-theme' : 'light-theme');
    
    // Set CSS custom properties
    root.style.setProperty('--theme-primary', theme.primary);
    root.style.setProperty('--theme-secondary', theme.secondary);
    root.style.setProperty('--theme-accent', theme.accent);
    root.style.setProperty('--theme-background', theme.background);
    root.style.setProperty('--theme-surface', theme.surface);
    root.style.setProperty('--theme-error', theme.error);
    root.style.setProperty('--theme-warning', theme.warning);
    root.style.setProperty('--theme-info', theme.info);
    root.style.setProperty('--theme-success', theme.success);
    
    // Set meta theme color for mobile browsers
    this.setMetaThemeColor(theme.primary);
  }

  /**
   * Set meta theme color for mobile browsers
   */
  private setMetaThemeColor(color: string): void {
    let themeColorMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;
    
    if (!themeColorMeta) {
      themeColorMeta = document.createElement('meta') as HTMLMetaElement;
      themeColorMeta.name = 'theme-color';
      document.head.appendChild(themeColorMeta);
    }
    
    themeColorMeta.content = color;
  }

  /**
   * Listen for system theme preference changes
   */
  private listenForSystemThemeChanges(): void {
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      mediaQuery.addEventListener('change', (e) => {
        // Only auto-switch if user hasn't manually set a preference
        const hasManualPreference = localStorage.getItem(this.DARK_MODE_STORAGE_KEY) !== null;
        
        if (!hasManualPreference) {
          const theme = e.matches ? DARK_THEME : LIGHT_THEME;
          this.setTheme(theme, false);
        }
      });
    }
  }

  /**
   * Reset theme to system preference
   */
  resetToSystemPreference(): void {
    localStorage.removeItem(this.THEME_STORAGE_KEY);
    localStorage.removeItem(this.DARK_MODE_STORAGE_KEY);
    
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = prefersDark ? DARK_THEME : LIGHT_THEME;
    this.setTheme(theme, false);
  }

  /**
   * Get available themes
   */
  getAvailableThemes(): Theme[] {
    return [LIGHT_THEME, DARK_THEME];
  }

  /**
   * Create custom theme
   */
  createCustomTheme(baseTheme: Theme, overrides: Partial<Theme>): Theme {
    return {
      ...baseTheme,
      ...overrides,
      name: overrides.name || `custom-${Date.now()}`
    };
  }

  /**
   * Get theme-aware color classes for Tailwind CSS
   */
  getThemeClasses(): { [key: string]: string } {
    const theme = this.currentThemeSubject.value;
    
    return {
      background: theme.isDark ? 'bg-gray-900' : 'bg-gray-50',
      surface: theme.isDark ? 'bg-gray-800' : 'bg-white',
      primary: theme.isDark ? 'text-blue-400' : 'text-blue-600',
      secondary: theme.isDark ? 'text-gray-300' : 'text-gray-600',
      text: theme.isDark ? 'text-white' : 'text-gray-900',
      textMuted: theme.isDark ? 'text-gray-400' : 'text-gray-500',
      border: theme.isDark ? 'border-gray-700' : 'border-gray-200',
      hover: theme.isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
    };
  }

  /**
   * Clean up subscriptions
   */
  ngOnDestroy(): void {
    this.currentThemeSubject.complete();
    this.isDarkModeSubject.complete();
  }
}