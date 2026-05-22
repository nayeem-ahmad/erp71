'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        Sentry.captureException(error);
    }, [error]);

    return (
        <html>
            <body>
                <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>
                    <h2>Something went wrong</h2>
                    <p style={{ color: '#666' }}>An unexpected error occurred. Our team has been notified.</p>
                    <button onClick={reset} style={{ marginTop: 16, padding: '8px 20px', cursor: 'pointer' }}>
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
