'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchWithAuth } from '../api';
import { useBranding } from '../branding';
import { headerConfigFromBranding } from './header';
import type { DeepPartial, PrintDocType, PrintHeaderConfig } from './types';

export interface PrintHeader {
    /** Pass as `headerConfig` to any printer in `lib/`. */
    headerConfig: DeepPartial<PrintHeaderConfig>;
    /** Tenant business name, when branding has one. */
    companyName?: string;
    /**
     * Resolves the stored template on demand — for callers that print rarely
     * and skip the eager fetch. Falls back to the branding header on failure.
     */
    resolve: () => Promise<PrintHeader>;
}

interface ResolvedTemplate {
    template_id: string | null;
    name: string | null;
    config: DeepPartial<PrintHeaderConfig>;
}

/**
 * One in-flight request per document type, shared by every component that
 * prints — clicking Print must never wait on a round trip it already made.
 */
const cache = new Map<string, Promise<ResolvedTemplate | null>>();

/** Call after saving a template so the next print picks up the change. */
export function clearPrintTemplateCache(): void {
    cache.clear();
}

function resolveTemplate(docType?: PrintDocType): Promise<ResolvedTemplate | null> {
    const key = docType ?? 'DEFAULT';
    if (!cache.has(key)) {
        const query = docType ? `?docType=${encodeURIComponent(docType)}` : '';
        cache.set(
            key,
            Promise.resolve()
                .then(() => fetchWithAuth(`/print-templates/resolve${query}`))
                .then((data: any) => (data?.config ? (data as ResolvedTemplate) : null))
                // Printing must still work when the request fails — fall back to branding.
                .catch(() => null),
        );
    }
    return cache.get(key)!;
}

export interface UsePrintHeaderOptions {
    /**
     * Fetch the template on mount. Turn off for components that render on many
     * pages but print rarely (list tables) — they call `resolve()` on click.
     */
    eager?: boolean;
}

/**
 * The header design to print with: the tenant's template for this document
 * type, falling back to one derived from branding (logo + primary colour)
 * until the template resolves or if it cannot be loaded.
 */
export function usePrintHeader(
    docType?: PrintDocType,
    { eager = true }: UsePrintHeaderOptions = {},
): PrintHeader {
    const branding = useBranding();
    const [stored, setStored] = useState<DeepPartial<PrintHeaderConfig> | null>(null);

    const fallbackConfig = useMemo(
        () => headerConfigFromBranding({
            logoUrl: branding.logoUrl,
            primaryColor: branding.primaryColor,
        }),
        [branding.logoUrl, branding.primaryColor],
    );
    const companyName = branding.businessName ?? undefined;

    useEffect(() => {
        if (!eager) return;
        let active = true;
        void resolveTemplate(docType).then((resolved) => {
            if (active && resolved?.config) setStored(resolved.config);
        });
        return () => {
            active = false;
        };
    }, [docType, eager]);

    const resolve = useCallback(async (): Promise<PrintHeader> => {
        const resolved = await resolveTemplate(docType);
        if (resolved?.config) setStored(resolved.config);
        return {
            headerConfig: resolved?.config ?? fallbackConfig,
            companyName,
            resolve,
        };
        // `resolve` referencing itself is fine — useCallback keeps it stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docType, fallbackConfig, companyName]);

    return useMemo(
        () => ({ headerConfig: stored ?? fallbackConfig, companyName, resolve }),
        [stored, fallbackConfig, companyName, resolve],
    );
}
