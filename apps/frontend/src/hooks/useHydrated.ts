'use client';

import { useEffect, useState } from 'react';

/**
 * False during server render and the first client render, true once React has
 * hydrated and event handlers are actually attached.
 *
 * Auth forms need this. Their markup is server-rendered, so the inputs are
 * visible and typable seconds before the JS bundle finishes hydrating — on a
 * cold cache over a slow mobile connection that gap measured ~7s on the login
 * page. A submit inside that window never reaches the React `onSubmit`, so
 * `preventDefault()` never runs and the browser does a native GET submit: the
 * page reloads, the fields clear, and nothing explains why. Gating the submit
 * button on this closes that window.
 */
export function useHydrated(): boolean {
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        setHydrated(true);
    }, []);

    return hydrated;
}
