'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { fetchWithAuth } from './api';

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

function darkenHex(hex: string): string {
    try {
        const clean = hex.replace('#', '');
        const full = clean.length === 3
            ? clean.split('').map((c) => c + c).join('')
            : clean;
        const r = Math.round(parseInt(full.slice(0, 2), 16) * 0.85);
        const g = Math.round(parseInt(full.slice(2, 4), 16) * 0.85);
        const b = Math.round(parseInt(full.slice(4, 6), 16) * 0.85);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } catch {
        return '#1d4ed8';
    }
}

function applyBrandingToDom(branding: Branding) {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--color-primary', branding.primaryColor);
    document.documentElement.style.setProperty('--color-primary-dark', darkenHex(branding.primaryColor));

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

    useEffect(() => {
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
            })
            .catch(() => {
                // Fail silently — fall back to defaults
                applyBrandingToDom(defaultBranding);
            });
    }, []);

    return (
        <BrandingContext.Provider value={branding}>
            {children}
        </BrandingContext.Provider>
    );
}

export const useBranding = () => useContext(BrandingContext);
