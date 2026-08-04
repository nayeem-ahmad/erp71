/**
 * Referral attribution across visits.
 *
 * Someone clicks a partner's link today and signs up on Thursday. Without this,
 * that signup is attributed to nobody and the partner is not paid — which was the
 * behaviour until now, since the code only ever survived as a query parameter.
 *
 * Deliberately localStorage rather than a cookie: the tracking link, the signup
 * page and the API are not guaranteed to share a registrable domain across
 * environments, and a first-party cookie set by the API host would not be visible
 * to the app. The trade-off is that attribution is per-browser and disappears with
 * cleared site data — acceptable, because the failure mode is "falls back to the
 * un-attributed behaviour we already had", never a wrong attribution.
 *
 * Last click wins: a fresh link overwrites an earlier one, matching how every
 * affiliate network people are used to behaves.
 */

const STORAGE_KEY = 'erp71.referral';
export const ATTRIBUTION_WINDOW_DAYS = 30;

const WINDOW_MS = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

type StoredReferral = { code: string; at: number };

function read(): StoredReferral | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<StoredReferral>;
        if (typeof parsed?.code !== 'string' || typeof parsed?.at !== 'number') return null;
        return { code: parsed.code, at: parsed.at };
    } catch {
        // Unparseable, or storage blocked (private mode, embedded webview).
        return null;
    }
}

/** Persist a code seen in the URL. Silently no-ops where storage is unavailable. */
export function rememberReferralCode(code: string, now: number = Date.now()): void {
    const normalized = code.trim().toUpperCase();
    if (!normalized || typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ code: normalized, at: now } satisfies StoredReferral),
        );
    } catch {
        // Storage disabled — attribution degrades to URL-only, which is the old behaviour.
    }
}

/** The remembered code, or null if absent or older than the attribution window. */
export function recallReferralCode(now: number = Date.now()): string | null {
    const stored = read();
    if (!stored) return null;
    if (now - stored.at > WINDOW_MS) {
        clearReferralCode();
        return null;
    }
    return stored.code;
}

export function clearReferralCode(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Nothing to do.
    }
}
