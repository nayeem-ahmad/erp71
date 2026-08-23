'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
/** Google refuses to render its button wider than this. */
const MAX_BUTTON_WIDTH = 400;

type GoogleCredentialResponse = { credential?: string };

type GoogleIdentityServices = {
    accounts: {
        id: {
            initialize: (config: {
                client_id: string;
                callback: (response: GoogleCredentialResponse) => void;
                auto_select?: boolean;
                cancel_on_tap_outside?: boolean;
                use_fedcm_for_prompt?: boolean;
            }) => void;
            renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
    };
};

declare global {
    interface Window {
        google?: GoogleIdentityServices;
    }
}

let gsiScriptPromise: Promise<void> | null = null;

/**
 * Load Google Identity Services once per page load. Two buttons mounting at the
 * same time share the one promise instead of racing two <script> tags in.
 */
function loadGsiScript(): Promise<void> {
    if (gsiScriptPromise) return gsiScriptPromise;

    gsiScriptPromise = new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
        if (existing) {
            if (window.google?.accounts?.id) {
                resolve();
                return;
            }
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in')));
            return;
        }

        const script = document.createElement('script');
        script.src = GSI_SRC;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Google sign-in'));
        document.head.appendChild(script);
    }).catch((err) => {
        // Don't cache the failure — a flaky network shouldn't disable the button
        // for the rest of the session.
        gsiScriptPromise = null;
        throw err;
    });

    return gsiScriptPromise;
}

export type GoogleSignInButtonProps = {
    /** Receives the Google ID token. The caller decides what to exchange it for. */
    onCredential: (credential: string) => void | Promise<void>;
    /** Surfaces script/config failures to the page's own error banner. */
    onError?: (message: string) => void;
    /** Google renders "Sign in with Google" or "Sign up with Google" accordingly. */
    text?: 'signin_with' | 'signup_with' | 'continue_with';
    /** True while the caller is exchanging the credential, so we can mask the button. */
    busy?: boolean;
    /** Blocks the button while another auth flow on the page is running. */
    disabled?: boolean;
    /**
     * Fires once the backend has said whether Google sign-in is configured, so
     * the page can drop its own chrome (dividers, hint text) when it isn't.
     */
    onAvailabilityChange?: (available: boolean) => void;
};

/**
 * Renders Google's own sign-in button. It has to be Google's rendered widget
 * rather than a styled `<button>` — their branding terms require it, and the
 * button is an iframe, so it can't be restyled or click-intercepted from here.
 */
export default function GoogleSignInButton({
    onCredential,
    onError,
    text = 'signin_with',
    busy = false,
    disabled = false,
    onAvailabilityChange,
}: GoogleSignInButtonProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    // Fetching the config and loading Google's script takes seconds on a cold
    // cache, and rendering nothing in the meantime reads as "this deployment has
    // no Google sign-in". A placeholder says "still loading" instead.
    const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
    // Held in a ref so re-rendering the page (e.g. typing in a form field)
    // doesn't re-initialize Google with a stale callback.
    const onCredentialRef = useRef(onCredential);
    onCredentialRef.current = onCredential;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    const onAvailabilityChangeRef = useRef(onAvailabilityChange);
    onAvailabilityChangeRef.current = onAvailabilityChange;

    const handleCredential = useCallback((response: GoogleCredentialResponse) => {
        if (!response?.credential) {
            onErrorRef.current?.('Google sign-in was cancelled. Please try again.');
            return;
        }
        void onCredentialRef.current(response.credential);
    }, []);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            // Anything that goes wrong here leaves the page with no Google button
            // — never a broken login form. Hence one catch around the whole setup.
            let config: { enabled?: boolean; client_id?: string } | null = null;
            try {
                config = await api.getGoogleAuthConfig();
            } catch {
                config = null;
            }
            if (cancelled) return;

            // Not configured on this deployment — render nothing rather than a
            // button that can only fail.
            const available = !!config?.enabled && !!config?.client_id;
            onAvailabilityChangeRef.current?.(available);
            if (!available) {
                setStatus('unavailable');
                return;
            }

            try {
                await loadGsiScript();
            } catch {
                if (!cancelled) {
                    setStatus('unavailable');
                    onErrorRef.current?.('Could not load Google sign-in. Please try again.');
                }
                return;
            }

            const container = containerRef.current;
            if (cancelled || !container || !window.google?.accounts?.id) return;

            window.google.accounts.id.initialize({
                client_id: config!.client_id!,
                callback: handleCredential,
                // No One Tap prompt and no silent auto sign-in: the user should
                // land on this page and choose, not be signed in on arrival.
                auto_select: false,
                cancel_on_tap_outside: true,
            });

            container.innerHTML = '';
            window.google.accounts.id.renderButton(container, {
                type: 'standard',
                theme: 'outline',
                size: 'large',
                text,
                shape: 'rectangular',
                logo_alignment: 'left',
                width: Math.min(container.offsetWidth || MAX_BUTTON_WIDTH, MAX_BUTTON_WIDTH),
            });
            setReady(true);
            setStatus('ready');
        })();

        return () => {
            cancelled = true;
        };
    }, [handleCredential, text]);

    return (
        <div className="relative">
            {status === 'loading' && (
                <div
                    aria-hidden
                    className="h-11 w-full animate-pulse rounded-md border border-gray-200 bg-gray-50"
                />
            )}
            {/* Google's iframe ignores pointer-events on itself, so an overlay is
                the only way to block a second click while the first is in flight. */}
            <div ref={containerRef} className="flex justify-center [color-scheme:light]" />
            {ready && (busy || disabled) && (
                <div className="absolute inset-0 flex items-center justify-center rounded-md bg-white/70">
                    {busy && <Loader2 className="w-5 h-5 animate-spin text-blue-600" />}
                </div>
            )}
        </div>
    );
}
