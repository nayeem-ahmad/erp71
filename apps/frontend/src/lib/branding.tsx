'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DEFAULT_UI_THEME, isUiTheme, type UiTheme } from '@erp71/shared-types';
import { fetchWithAuth } from './api';
import {
    SetUiThemeContext,
    UiThemeContext,
    applyUiThemeToDom,
    readCachedUiTheme,
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

    const setUiTheme = useCallback((theme: UiTheme) => {
        setUiThemeState(theme);
        applyUiThemeToDom(theme);
        writeCachedUiTheme(theme);
    }, []);

    useEffect(() => {
        const cached = readCachedUiTheme();
        if (cached) {
            setUiThemeState(cached);
            applyUiThemeToDom(cached);
        }
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
            })
            .catch(() => {
                // Fail silently — fall back to defaults
                applyBrandingToDom(defaultBranding);
            });
    }, [setUiTheme]);

    return (
        <BrandingContext.Provider value={branding}>
            <SetUiThemeContext.Provider value={setUiTheme}>
                <UiThemeContext.Provider value={uiTheme}>
                    {children}
                </UiThemeContext.Provider>
            </SetUiThemeContext.Provider>
        </BrandingContext.Provider>
    );
}

export const useBranding = () => useContext(BrandingContext);
