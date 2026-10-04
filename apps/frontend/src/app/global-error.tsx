'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect, useMemo } from 'react';
import { DEFAULT_LOCALE } from '@/lib/localization/config';
import { getLoadedMessagesOrDefault } from '@/lib/localization/load-messages';
import { getStoredLocalePreference } from '@/lib/localization/preference';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    // Synchronous on purpose: this page is the last resort when the app itself
    // has failed, so it must not wait on — or fail on — fetching a language
    // chunk. The user's language is usually already loaded by the provider this
    // page replaces; if not, English.
    const m = useMemo(() => {
        const locale = getStoredLocalePreference() ?? DEFAULT_LOCALE;
        return getLoadedMessagesOrDefault(locale).marketing.globalError;
    }, []);

    useEffect(() => {
        Sentry.captureException(error);
    }, [error]);

    return (
        <html>
            <body>
                <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>
                    <h2>{m.title}</h2>
                    <p style={{ color: '#666' }}>{m.description}</p>
                    <button onClick={reset} style={{ marginTop: 16, padding: '8px 20px', cursor: 'pointer' }}>
                        {m.tryAgain}
                    </button>
                </div>
            </body>
        </html>
    );
}