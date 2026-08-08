'use client';

/**
 * Firebase phone authentication, loaded from Google's CDN on demand.
 *
 * The compat bundles are used deliberately rather than the `firebase` npm
 * package: the SDK is only ever needed by the handful of visitors who choose
 * mobile sign-in, and loading it at that moment keeps it out of every other
 * page's bundle — the same trade already made for Google Identity Services.
 * It also keeps the Firebase config a *runtime* value served by the backend,
 * where a bundled SDK would push it towards build-time `NEXT_PUBLIC_` vars.
 */

/** Pinned so a Firebase release can never change how sign-in behaves unannounced. */
const FIREBASE_SDK_VERSION = '10.14.1';
const FIREBASE_SCRIPTS = [
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js`,
    // Must load after app-compat: it registers itself onto the app namespace.
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth-compat.js`,
];

/** The public client config the backend serves from `GET /auth/firebase/config`. */
export type FirebaseWebConfig = {
    api_key: string;
    auth_domain: string;
    project_id: string;
};

/** A code has been sent; this is the handle that redeems it for an ID token. */
export type PhoneConfirmation = {
    /** Returns the Firebase ID token to post to the ERP71 backend. */
    confirm: (code: string) => Promise<string>;
    /** Releases the reCAPTCHA widget. Safe to call more than once. */
    dispose: () => void;
};

type FirebaseCompat = any;

declare global {
    interface Window {
        firebase?: FirebaseCompat;
    }
}

let sdkPromise: Promise<FirebaseCompat> | null = null;

function loadScript(src: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === 'true') {
                resolve();
                return;
            }
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('Failed to load Firebase')));
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = () => reject(new Error('Failed to load Firebase'));
        document.head.appendChild(script);
    });
}

/** Loads the SDK once per page load; concurrent callers share the one load. */
export function loadFirebaseSdk(): Promise<FirebaseCompat> {
    if (sdkPromise) return sdkPromise;

    sdkPromise = (async () => {
        for (const src of FIREBASE_SCRIPTS) {
            await loadScript(src);
        }
        if (!window.firebase?.auth) {
            throw new Error('Failed to load Firebase');
        }
        return window.firebase;
    })().catch((err) => {
        // Don't cache the failure — a flaky network shouldn't disable mobile
        // sign-in for the rest of the session.
        sdkPromise = null;
        throw err;
    });

    return sdkPromise;
}

/**
 * Firebase throws if the same project is initialized twice, so an app that is
 * already there is reused. Only one Firebase project is ever in play here.
 */
function resolveAuth(firebase: FirebaseCompat, config: FirebaseWebConfig) {
    if (!firebase.apps?.length) {
        firebase.initializeApp({
            apiKey: config.api_key,
            authDomain: config.auth_domain,
            projectId: config.project_id,
        });
    }
    return firebase.auth();
}

/**
 * Sends an SMS one-time code to `phoneE164` and returns the handle that turns
 * the code the user types back into a Firebase ID token.
 *
 * `container` hosts the invisible reCAPTCHA that Firebase requires before it
 * will send an SMS — it stays empty in the normal case, and only paints a
 * challenge when Firebase decides the visitor needs one.
 */
export async function sendPhoneVerificationCode(
    config: FirebaseWebConfig,
    phoneE164: string,
    container: HTMLElement,
): Promise<PhoneConfirmation> {
    const firebase = await loadFirebaseSdk();
    const auth = resolveAuth(firebase, config);

    // A fresh verifier per attempt: a used or failed one cannot be replayed, and
    // reusing it is what produces Firebase's "reCAPTCHA has already been
    // rendered in this element" error on the second try.
    container.innerHTML = '';
    const verifier = new firebase.auth.RecaptchaVerifier(container, { size: 'invisible' });

    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        try {
            verifier.clear();
        } catch {
            // Already torn down by Firebase — nothing left to release.
        }
        container.innerHTML = '';
    };

    let confirmationResult: any;
    try {
        confirmationResult = await auth.signInWithPhoneNumber(phoneE164, verifier);
    } catch (err) {
        dispose();
        throw err;
    }

    return {
        confirm: async (code: string) => {
            const credential = await confirmationResult.confirm(code);
            const idToken: string = await credential.user.getIdToken();
            // The ERP71 session is the one that matters from here; leaving the
            // Firebase session signed in serves no purpose and would silently
            // re-authenticate the number on the next visit.
            await auth.signOut().catch(() => undefined);
            dispose();
            return idToken;
        },
        dispose,
    };
}

/** Maps Firebase's error codes onto something a shopkeeper can act on. */
export function describeFirebaseAuthError(error: unknown, fallback: string): string {
    const code = (error as { code?: string } | null)?.code ?? '';
    switch (code) {
        case 'auth/invalid-phone-number':
        case 'auth/missing-phone-number':
            return 'Please enter a valid mobile number.';
        case 'auth/invalid-verification-code':
            return 'That code is not correct. Please check the SMS and try again.';
        case 'auth/code-expired':
            return 'That code has expired. Please request a new one.';
        case 'auth/too-many-requests':
        case 'auth/quota-exceeded':
            return 'Too many attempts. Please wait a few minutes and try again.';
        case 'auth/captcha-check-failed':
            return 'Verification failed. Please reload the page and try again.';
        case 'auth/operation-not-allowed':
            return 'Mobile sign-in is not enabled for this app yet.';
        default:
            return (error as { message?: string } | null)?.message || fallback;
    }
}
