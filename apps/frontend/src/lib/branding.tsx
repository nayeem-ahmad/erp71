'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DEFAULT_UI_SIDEBAR, DEFAULT_UI_THEME, isUiSidebar, isUiTheme, type UiSidebar, type UiTheme } from '@erp71/shared-types';
import { fetchWithAuth } from './api';
import {
    NavRecentContext,
    SetNavRecentContext,
    SetUiSidebarContext,
    SetUiThemeContext,
    UiSidebarContext,
    UiThemeContext,
    applyUiThemeToDom,
    readCachedNavRecent,
    readCachedUiSidebar,
    readCachedUiTheme,
    writeCachedNavRecent,
    writeCachedUiSidebar,
    writeCachedUiTheme,
} from './ui-theme';

const DEFAULT_PRIMARY_COLOR = '#2563eb';

interface Branding {
    logoUrl: string | null;
    faviconUrl: string | null;
    businessName: string | null;
    primaryColor: string;
}

const defaultBranding: Branding = {
    logoUrl: null,
    faviconUrl: null,
    businessName: null,
    primaryColor: DEFAULT_PRIMARY_COLOR,
};

const BrandingContext = createContext<Branding>(defaultBranding);

function applyBrandingToDom(branding: Branding) {
    if (typeof document === 'undefined') return;

    // Update favicon if set
    if (branding.faviconUrl) {
        const existing = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
        if (existing) {
            existing.href = branding.faviconUrl;
        } else {
            const link = document.createElement('link');
            link.rel = 'icon';
            link.href = branding.faviconUrl;
            document.head.appendChild(link);
        }
    }
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
    const [branding, setBranding] = useState<Branding>(defaultBranding);
    const [uiTheme, setUiThemeState] = useState<UiTheme>(DEFAULT_UI_THEME);
    const [uiSidebar, setUiSidebarState] = useState<UiSidebar>(DEFAULT_UI_SIDEBAR);
    const [navRecent, setNavRecentState] = useState(true);

    const setUiTheme = useCallback((theme: UiTheme) => {
        setUiThemeState(theme);
        applyUiThemeToDom(theme);
        writeCachedUiTheme(theme);
    }, []);

    const setUiSidebar = useCallback((sidebar: UiSidebar) => {
        setUiSidebarState(sidebar);
        writeCachedUiSidebar(sidebar);
    }, []);

    const setNavRecent = useCallback((enabled: boolean) => {
        setNavRecentState(enabled);
        writeCachedNavRecent(enabled);
    }, []);

    useEffect(() => {
        const cached = readCachedUiTheme();
        if (cached) {
            setUiThemeState(cached);
            applyUiThemeToDom(cached);
        }
        const cachedSidebar = readCachedUiSidebar();
        if (cachedSidebar) setUiSidebarState(cachedSidebar);
        const cachedNavRecent = readCachedNavRecent();
        if (cachedNavRecent !== null) setNavRecentState(cachedNavRecent);
        fetchWithAuth('/tenants/branding')
            .then((data: any) => {
                const primaryColor = data?.brand_primary_color ?? DEFAULT_PRIMARY_COLOR;
                const next: Branding = {
                    logoUrl: data?.brand_logo_url ?? null,
                    faviconUrl: data?.brand_favicon_url ?? null,
                    businessName: data?.brand_business_name ?? null,
                    primaryColor,
                };
                applyBrandingToDom(next);
                setBranding(next);
                setUiTheme(isUiTheme(data?.ui_theme) ? data.ui_theme : DEFAULT_UI_THEME);
                setUiSidebar(isUiSidebar(data?.ui_sidebar) ? data.ui_sidebar : DEFAULT_UI_SIDEBAR);
                // Only an explicit false switches it off; an older API that omits the field leaves it on.
                setNavRecent(data?.nav_recent_enabled !== false);
            })
            .catch(() => {
                // Fail silently — fall back to defaults
                applyBrandingToDom(defaultBranding);
            });
    }, [setUiTheme, setUiSidebar, setNavRecent]);

    return (
        <BrandingContext.Provider value={branding}>
            <SetUiThemeContext.Provider value={setUiTheme}>
                <SetUiSidebarContext.Provider value={setUiSidebar}>
                    <SetNavRecentContext.Provider value={setNavRecent}>
                        <UiThemeContext.Provider value={uiTheme}>
                            <UiSidebarContext.Provider value={uiSidebar}>
                                <NavRecentContext.Provider value={navRecent}>
                                    {children}
                                </NavRecentContext.Provider>
                            </UiSidebarContext.Provider>
                        </UiThemeContext.Provider>
                    </SetNavRecentContext.Provider>
                </SetUiSidebarContext.Provider>
            </SetUiThemeContext.Provider>
        </BrandingContext.Provider>
    );
}

export const useBranding = () => useContext(BrandingContext);
