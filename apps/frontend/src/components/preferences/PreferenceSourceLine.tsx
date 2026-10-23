'use client';

import { useState } from 'react';
import type { InvoicePrintPrefs, PersonSectionKey } from '@erp71/shared-types';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { reloadInvoicePrintPrefs } from '@/lib/hooks/useInvoicePrintPrefs';
import { usePreferenceSection } from '@/lib/preferences/use-preference-section';
import { usePreferencesStore } from '@/lib/preferences/store';

/** The words of the four lines; each screen keeps them in its own namespace. */
export interface PreferenceSourceCopy {
    /** "Following {profile} default" */
    following: string;
    builtIn: string;
    customised: string;
    browser: string;
    reset: string;
}

/**
 * Where one of the member's settings comes from, and a way back when it is
 * theirs: "Following <profile> default", "Using the built-in setting",
 * "Customised · Reset" or "Set on this browser · Reset".
 *
 * Reset drops the member's answer (and this browser's old one), so the setting
 * falls back to the profile or the built-in value. Failures toast from the
 * store. Renders nothing until preferences have loaded.
 */
export default function PreferenceSourceLine({
    sectionKey,
    copy,
    onInvoicePrintReset,
}: {
    sectionKey: PersonSectionKey;
    copy: PreferenceSourceCopy;
    /** After `invoicePrint` was reset and the layout re-read — for a screen holding its own copy of it. */
    onInvoicePrintReset?: (prefs: InvoicePrintPrefs) => void;
}) {
    const { fmt } = useI18n();
    const { ready, source } = usePreferenceSection(sectionKey);
    const profile = usePreferencesStore((state) => state.data?.profile ?? null);
    const reset = usePreferencesStore((state) => state.reset);
    const [resetting, setResetting] = useState(false);

    if (!ready) return null;

    const handleReset = async () => {
        setResetting(true);
        try {
            await reset(sectionKey);
            if (sectionKey === 'invoicePrint') {
                // The print screens cache the layout on their own; tell them it changed.
                const prefs = await reloadInvoicePrintPrefs();
                onInvoicePrintReset?.(prefs);
            }
        } finally {
            setResetting(false);
        }
    };

    if (source === 'member' || source === 'browser') {
        return (
            <span className="inline-flex flex-wrap items-center gap-x-1 text-xs text-gray-500">
                <span>{source === 'member' ? copy.customised : copy.browser}</span>
                <span aria-hidden="true">·</span>
                <Button type="button" variant="ghost" disabled={resetting} onClick={() => void handleReset()}>
                    {copy.reset}
                </Button>
            </span>
        );
    }

    return (
        <span className="text-xs text-gray-500">
            {source === 'profile' && profile ? fmt(copy.following, { profile: profile.name }) : copy.builtIn}
        </span>
    );
}
