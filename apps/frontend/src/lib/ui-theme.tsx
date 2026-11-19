'use client';

import { createContext, useContext } from 'react';
import { DEFAULT_UI_THEME, isUiTheme, type UiTheme } from '@erp71/shared-types';

/**
 * The workspace's visual style (Settings › Branding), provided by
 * `BrandingProvider`. Outside a provider — tests, the storefront, auth pages —
 * it is CLASSIC, which is the markup every component had before styles
 * existed.
 */
export const UiThemeContext = createContext<UiTheme>(DEFAULT_UI_THEME);

/** Applies a style chosen on the settings page without a reload. */
export const SetUiThemeContext = createContext<(theme: UiTheme) => void>(() => {});

export type UiStyle = {
    theme: UiTheme;
    /** POLISHED or COLORFUL: calmer type, sentence-case labels, phone list cards. */
    polished: boolean;
    /** COLORFUL only: gradient KPI cards, a hue per module, tinted icon chips. */
    colorful: boolean;
};

export function styleFor(theme: UiTheme): UiStyle {
    return { theme, polished: theme !== 'CLASSIC', colorful: theme === 'COLORFUL' };
}

export function useUiStyle(): UiStyle {
    return styleFor(useContext(UiThemeContext));
}

export function useSetUiTheme() {
    return useContext(SetUiThemeContext);
}

/*
 * The last style seen for each workspace, so a reload paints it straight away
 * instead of flashing CLASSIC while `/tenants/branding` is in flight. Keyed by
 * tenant because one browser can hold several workspaces.
 */
const CACHE_PREFIX = 'erp71.ui_theme.';

function cacheKey(): string | null {
    try {
        const tenantId = sessionStorage.getItem('tenant_id') || localStorage.getItem('last_tenant_id');
        return tenantId ? `${CACHE_PREFIX}${tenantId}` : null;
    } catch {
        return null;
    }
}

export function readCachedUiTheme(): UiTheme | null {
    const key = cacheKey();
    if (!key) return null;
    try {
        const value = localStorage.getItem(key);
        return isUiTheme(value) ? value : null;
    } catch {
        return null;
    }
}

export function writeCachedUiTheme(theme: UiTheme) {
    const key = cacheKey();
    if (!key) return;
    try {
        localStorage.setItem(key, theme);
    } catch {
        // Private mode or storage full: the style still applies, it just isn't remembered.
    }
}

/** Mirrors the style onto `<html data-ui-theme>` for any CSS that wants it. */
export function applyUiThemeToDom(theme: UiTheme) {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.uiTheme = theme.toLowerCase();
}
