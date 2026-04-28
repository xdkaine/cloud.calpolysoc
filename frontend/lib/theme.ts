export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: ThemePreference = "system";
export const THEME_STORAGE_KEY = "calpolysoc-cloud-theme";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function getThemeInitScript() {
  return `(function(){try{var theme=localStorage.getItem('${THEME_STORAGE_KEY}')||'${DEFAULT_THEME}';var prefersDark=window.matchMedia('${THEME_MEDIA_QUERY}').matches;var resolved=theme==='system'?(prefersDark?'dark':'light'):theme;var root=document.documentElement;root.classList.toggle('dark',resolved==='dark');root.style.colorScheme=resolved;}catch(error){}})();`;
}