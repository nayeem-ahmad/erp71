'use client';

import { createContext, useContext } from 'react';
import { DEFAULT_UI_SIDEBAR, DEFAULT_UI_THEME, isUiSidebar, isUiTheme, type UiSidebar, type UiTheme } from '@erp71/shared-types';

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

/** The sidebar's colour (Settings › Branding), independent of the style. LIGHT outside a provider. */
export const UiSidebarContext = createContext<UiSidebar>(DEFAULT_UI_SIDEBAR);

/** Applies a sidebar colour chosen on the settings page without a reload. */
export const SetUiSidebarContext = createContext<(sidebar: UiSidebar) => void>(() => {});

export function useUiSidebar(): UiSidebar {
    return useContext(UiSidebarContext);
}

export function useSetUiSidebar() {
    return useContext(SetUiSidebarContext);
}

/*
 * The last style seen for each workspace, so a reload paints it straight away
 * instead of flashing CLASSIC while `/tenants/branding` is in flight. Keyed by
 * tenant because one browser can hold several workspaces.
 */
const THEME_CACHE = 'erp71.ui_theme.';
const SIDEBAR_CACHE = 'erp71.ui_sidebar.';

function cacheKey(prefix: string): string | null {
    try {
        const tenantId = sessionStorage.getItem('tenant_id') || localStorage.getItem('last_tenant_id');
        return tenantId ? `${prefix}${tenantId}` : null;
    } catch {
        return null;
    }
}

function readCached<T>(prefix: string, isValid: (value: unknown) => value is T): T | null {
    const key = cacheKey(prefix);
    if (!key) return null;
    try {
        const value = localStorage.getItem(key);
        return isValid(value) ? value : null;
    } catch {
        return null;
    }
}

function writeCached(prefix: string, value: string) {
    const key = cacheKey(prefix);
    if (!key) return;
    try {
        localStorage.setItem(key, value);
    } catch {
        // Private mode or storage full: the choice still applies, it just isn't remembered.
    }
}

export const readCachedUiTheme = () => readCached(THEME_CACHE, isUiTheme);
export const writeCachedUiTheme = (theme: UiTheme) => writeCached(THEME_CACHE, theme);
export const readCachedUiSidebar = () => readCached(SIDEBAR_CACHE, isUiSidebar);
export const writeCachedUiSidebar = (sidebar: UiSidebar) => writeCached(SIDEBAR_CACHE, sidebar);

/** Mirrors the style onto `<html data-ui-theme>` for any CSS that wants it. */
export function applyUiThemeToDom(theme: UiTheme) {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.uiTheme = theme.toLowerCase();
}
