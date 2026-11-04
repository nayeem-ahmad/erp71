import { ApiError, api } from '@/lib/api';

export type Meet71CallMode = 'voice' | 'video';

export type Meet71DialerDirectoryEntry = {
    email: string;
    displayName: string | null;
};

/**
 * Public Meet71 origin for deep-link fallback when the internal startCall API
 * is unavailable (503) or the callee is busy (409).
 */
export function meet71PublicOrigin(): string {
    const configured = (process.env.NEXT_PUBLIC_MEET71_ORIGIN ?? '').trim().replace(/\/+$/, '');
    return configured || 'https://meet.erp71.com';
}

export function meet71DeepLink(to: string, mode: Meet71CallMode = 'voice'): string {
    const url = new URL('/call', meet71PublicOrigin());
    url.searchParams.set('to', to.trim().toLowerCase());
    url.searchParams.set('mode', mode);
    return url.toString();
}

/**
 * Prefer server-side `POST /meet71/calls` (rings on Meet71, returns callerUrl).
 * On 409/503 open the public deep link so the call can still be placed when
 * Meet71 is unreachable over Docker or the callee is busy.
 */
export async function placeMeet71Call(to: string, mode: Meet71CallMode = 'voice'): Promise<void> {
    const email = to.trim().toLowerCase();
    if (!email) return;

    try {
        const result = (await api.startMeet71Call({ to: email, mode })) as {
            callerUrl?: string;
        };
        if (result?.callerUrl) {
            window.open(result.callerUrl, '_blank', 'noopener,noreferrer');
            return;
        }
    } catch (error) {
        if (!(error instanceof ApiError) || (error.status !== 409 && error.status !== 503)) {
            throw error;
        }
    }

    window.open(meet71DeepLink(email, mode), '_blank', 'noopener,noreferrer');
}
