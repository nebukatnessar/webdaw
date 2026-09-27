// Theme types and utilities for WebDaw
export type Theme = 'light' | 'dark' | 'high-contrast';

// Default theme
const DEFAULT_THEME: Theme = 'dark';

// LocalStorage key
const THEME_KEY = 'webdaw-theme';

// Get the current theme from localStorage or return the default
export function getTheme(): Theme {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'high-contrast')) {
    return savedTheme as Theme;
  }
  return DEFAULT_THEME;
}

// Set the theme in localStorage and apply it to the document
export function setTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

// Apply the theme to the document by setting the CSS custom properties
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  
  // Remove all theme classes first
  root.classList.remove('light-theme', 'dark-theme', 'high-contrast-theme');
  
  // Add the selected theme class
  root.classList.add(`${theme}-theme`);
  
  // Dispatch a custom event to notify components about theme change
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

// Initialize the theme on app startup
export function initializeTheme(): void {
  const theme = getTheme();
  applyTheme(theme);
}

// Toggle between light and dark themes
export function toggleTheme(): Theme {
  const currentTheme = getTheme();
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  setTheme(newTheme);
  return newTheme;
}

// Set high-contrast mode
export function setHighContrast(enabled: boolean): Theme {
  const newTheme: Theme = enabled ? 'high-contrast' : getTheme();
  setTheme(newTheme);
  return newTheme;
}

// Check if high-contrast mode is enabled
export function isHighContrast(): boolean {
  return getTheme() === 'high-contrast';
}