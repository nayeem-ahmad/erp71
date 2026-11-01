'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { mintMeet71SsoCode } from '@/lib/mint-meet71-sso';
import {
    meet71BounceAfterMint,
    meet71BounceWithoutSession,
    meet71PublicOrigin,
    type Meet71BounceDestination,
} from './meet71-return-url';

const STORAGE_KEY = 'meet71_sso_bounce';
const LOGIN_REDIRECT = '/login?redirect=/meet71/sso';

type BounceParams = {
    prompt: 'none' | 'login';
    state: string;
    challenge: string;
    returnUrl: string;
};

function parseParams(
    prompt: string | null | undefined,
    state: string | null | undefined,
    challenge: string | null | undefined,
    returnUrl: string | null | undefined,
): BounceParams | null {
    if (!state || !challenge || !returnUrl) return null;
    return {
        prompt: prompt === 'login' ? 'login' : 'none',
        state,
        challenge,
        returnUrl,
    };
}

function readBounceParams(searchParams: { get: (name: string) => string | null }): BounceParams | null {
    const fromQuery = parseParams(
        searchParams.get('prompt'),
        searchParams.get('state'),
        searchParams.get('challenge') ?? searchParams.get('code_challenge'),
        searchParams.get('return_url'),
    );
    if (fromQuery) {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fromQuery));
        } catch {
            // Private mode can throw; this request still has the query values.
        }
        return fromQuery;
    }
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<BounceParams>;
        return parseParams(parsed.prompt, parsed.state, parsed.challenge, parsed.returnUrl);
    } catch {
        return null;
    }
}

function applyDestination(dest: Meet71BounceDestination, goToLogin: () => void): void {
    if (dest.kind === 'login') {
        goToLogin();
        return;
    }
    window.location.replace(dest.url);
}

function Meet71SsoBounce() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const ran = useRef(false);

    useEffect(() => {
        if (ran.current) return;
        ran.current = true;

        const allowedOrigin = meet71PublicOrigin();
        const params = readBounceParams(searchParams);
        const prompt = params?.prompt ?? (searchParams.get('prompt') === 'login' ? 'login' : 'none');
        const goToLogin = () => {
            router.push(LOGIN_REDIRECT);
        };

        if (!params) {
            applyDestination(meet71BounceWithoutSession(prompt, allowedOrigin), goToLogin);
            return;
        }

        void (async () => {
            const result = await mintMeet71SsoCode({
                returnUrl: params.returnUrl,
                codeChallenge: params.challenge,
                state: params.state,
            });
            const dest = meet71BounceAfterMint({
                prompt: params.prompt,
                result,
                returnUrl: params.returnUrl,
                state: params.state,
                allowedOrigin,
            });
            if (result.ok) {
                try {
                    sessionStorage.removeItem(STORAGE_KEY);
                } catch {
                    // Ignore; the bounce is leaving this origin anyway.
                }
            }
            applyDestination(dest, goToLogin);
        })();
    }, [router, searchParams]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-canvas p-4">
            <p className="text-sm text-gray-600">Continuing to Meet71…</p>
        </div>
    );
}

function BounceFallback() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-canvas p-4">
            <p className="text-sm text-gray-600">Continuing to Meet71…</p>
        </div>
    );
}

export default function Meet71SsoPage() {
    return (
        <Suspense fallback={<BounceFallback />}>
            <Meet71SsoBounce />
        </Suspense>
    );
}
