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
     * and skip the eager fetch. Pass the document's store so that branch's
     * letterhead wins; it defaults to the hook's own `storeId`. Falls back to
     * the branding header on failure.
     */
    resolve: (storeId?: string) => Promise<PrintHeader>;
}

interface ResolvedTemplate {
    template_id: string | null;
    name: string | null;
    config: DeepPartial<PrintHeaderConfig>;
}

/**
 * One in-flight request per document type and store, shared by every component
 * that prints — clicking Print must never wait on a round trip it already made.
 */
const cache = new Map<string, Promise<ResolvedTemplate | null>>();

/** Call after saving a template so the next print picks up the change. */
export function clearPrintTemplateCache(): void {
    cache.clear();
}

function resolveTemplate(docType?: PrintDocType, storeId?: string): Promise<ResolvedTemplate | null> {
    const key = `${docType ?? 'DEFAULT'}:${storeId ?? ''}`;
    if (!cache.has(key)) {
        const params = new URLSearchParams();
        if (docType) params.set('docType', docType);
        if (storeId) params.set('storeId', storeId);
        const query = params.toString() ? `?${params.toString()}` : '';
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
    /**
     * The store this page prints for, when it is one store at mount (POS, a
     * daily report). Omit for company-wide prints.
     */
    storeId?: string;
}

/**
 * The header design to print with: the tenant's template for this document
 * type, falling back to one derived from branding (logo + primary colour)
 * until the template resolves or if it cannot be loaded.
 */
export function usePrintHeader(
    docType?: PrintDocType,
    { eager = true, storeId }: UsePrintHeaderOptions = {},
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
        void resolveTemplate(docType, storeId).then((resolved) => {
            if (active && resolved?.config) setStored(resolved.config);
        });
        return () => {
            active = false;
        };
    }, [docType, storeId, eager]);

    const resolve = useCallback(async (nextStoreId?: string): Promise<PrintHeader> => {
        const id = nextStoreId ?? storeId;
        const resolved = await resolveTemplate(docType, id);
        // A row of another branch must not repaint this hook's own header.
        if (resolved?.config && id === storeId) setStored(resolved.config);
        return {
            headerConfig: resolved?.config ?? fallbackConfig,
            companyName,
            resolve,
        };
        // `resolve` referencing itself is fine — useCallback keeps it stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docType, storeId, fallbackConfig, companyName]);

    return useMemo(
        () => ({ headerConfig: stored ?? fallbackConfig, companyName, resolve }),
        [stored, fallbackConfig, companyName, resolve],
    );
}
