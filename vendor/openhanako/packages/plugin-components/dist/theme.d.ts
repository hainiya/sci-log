import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
export type HanaThemeMode = 'inherit' | 'hana' | 'custom';
export declare const HANA_THEME_IDS: readonly ["warm-paper", "contemplation", "grass-aroma", "high-contrast", "midnight", "midnight-contrast", "absolutely", "delve", "deep-think", "new-warm-paper"];
export type HanaThemeId = (typeof HANA_THEME_IDS)[number];
export interface HanaThemeTokens {
    bg?: string;
    bgCard?: string;
    accent?: string;
    accentHover?: string;
    accentLight?: string;
    text?: string;
    textLight?: string;
    textMuted?: string;
    border?: string;
    danger?: string;
    radiusInput?: string;
    radiusCard?: string;
    fontUi?: string;
    fontSerif?: string;
    fontMono?: string;
}
export declare const HANA_BUILT_IN_THEMES: Record<HanaThemeId, HanaThemeTokens>;
type ThemeStyle = CSSProperties & Record<string, string>;
export interface HanaThemeProviderProps extends HTMLAttributes<HTMLDivElement> {
    mode?: HanaThemeMode;
    theme?: HanaThemeId | HanaThemeTokens;
    children?: ReactNode;
    'data-testid'?: string;
}
export declare function HanaThemeProvider({ mode, theme, className, style, children, 'data-testid': dataTestId, ...rootProps }: HanaThemeProviderProps): any;
export declare function themeStyleFor(mode: HanaThemeMode, theme?: HanaThemeId | HanaThemeTokens): ThemeStyle;
export {};
