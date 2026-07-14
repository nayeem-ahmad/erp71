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
