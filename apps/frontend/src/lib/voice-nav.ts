import { VOICE_NAV_ROUTES, type VoiceNavRoute, type VoiceNavTargetId } from './voice-nav-routes';

export interface VoiceNavMatch {
    route: VoiceNavRoute;
    matchedAlias: string;
}

export function normalizeVoicePhrase(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function aliasMatchScore(transcript: string, alias: string): number {
    const normalizedAlias = normalizeVoicePhrase(alias);
    if (!normalizedAlias || normalizedAlias.length < 2) return 0;

    if (transcript === normalizedAlias) {
        return 10_000 + normalizedAlias.length;
    }

    if (transcript.includes(normalizedAlias)) {
        return 5_000 + normalizedAlias.length;
    }

    if (normalizedAlias.includes(transcript) && transcript.length >= 3) {
        return 2_000 + transcript.length;
    }

    const transcriptWords = new Set(transcript.split(' ').filter(Boolean));
    const aliasWords = normalizedAlias.split(' ').filter(Boolean);
    if (aliasWords.length === 0) return 0;

    const overlap = aliasWords.filter((word) => transcriptWords.has(word)).length;
    if (overlap === 0) return 0;

    return overlap * 100 + overlap / aliasWords.length;
}

/** Match a spoken phrase to a navigation route. Longer / more specific aliases win ties. */
export function matchVoiceNav(transcript: string): VoiceNavMatch | null {
    const normalized = normalizeVoicePhrase(transcript);
    if (!normalized) return null;

    let best: VoiceNavMatch | null = null;
    let bestScore = 0;

    for (const route of VOICE_NAV_ROUTES) {
        for (const alias of route.aliases) {
            const score = aliasMatchScore(normalized, alias);
            if (score > bestScore) {
                bestScore = score;
                best = { route, matchedAlias: alias };
            }
        }
    }

    return bestScore >= 200 ? best : null;
}

export function getVoiceNavHintIds(): VoiceNavTargetId[] {
    return [
        'sales-entry',
        'pos',
        'customer-payment',
        'expense-entry',
        'purchase-entry',
        'voucher-entry',
    ];
}

export interface BrowserSpeechRecognition {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
}

export interface SpeechRecognitionEvent {
    results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionResultList {
    readonly length: number;
    [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionResult {
    readonly length: number;
    readonly isFinal: boolean;
    [index: number]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

export interface SpeechRecognitionErrorEvent {
    error: string;
    message?: string;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
    if (typeof window === 'undefined') return null;
    const win = window as Window & {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

/** Web Speech API only works in secure contexts (HTTPS or localhost). */
export function isSpeechRecognitionSupported(): boolean {
    return typeof window !== 'undefined'
        && window.isSecureContext
        && getSpeechRecognitionCtor() !== null;
}

export type MicPermissionResult =
    | { ok: true }
    | { ok: false; reason: 'denied' | 'unavailable' | 'insecure' };

/** Prime microphone access before starting browser speech recognition. */
export async function requestMicrophoneAccess(): Promise<MicPermissionResult> {
    if (typeof window === 'undefined' || !window.isSecureContext) {
        return { ok: false, reason: 'insecure' };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
        return { ok: false, reason: 'unavailable' };
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        return { ok: true };
    } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
            return { ok: false, reason: 'denied' };
        }
        return { ok: false, reason: 'unavailable' };
    }
}

/**
 * A `network` speech error does NOT mean the device is offline: the browser streams audio to a
 * remote speech backend (Google's for Chromium, Apple's for Safari), which a VPN, ad blocker,
 * firewall, or a Chromium build shipped without speech API keys can block on its own.
 */
export function isBrowserOffline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export type SpeechRecognitionErrorCode =
    | 'not-allowed'
    | 'aborted'
    | 'no-speech'
    | 'network'
    | 'audio-capture'
    | 'language-not-supported'
    | 'service-not-allowed'
    | 'other';

export function classifySpeechRecognitionError(error: string): SpeechRecognitionErrorCode {
    switch (error) {
        case 'not-allowed':
            return 'not-allowed';
        case 'aborted':
            return 'aborted';
        case 'no-speech':
            return 'no-speech';
        case 'network':
            return 'network';
        case 'audio-capture':
            return 'audio-capture';
        case 'language-not-supported':
            return 'language-not-supported';
        case 'service-not-allowed':
            return 'service-not-allowed';
        default:
            return 'other';
    }
}

export function speechLocaleFallbackChain(locale: string): string[] {
    const primary = speechLocaleToBcp47(locale);
    return primary === 'en-US' ? [primary] : [primary, 'en-US'];
}

export function speechLocaleToBcp47(locale: string): string {
    if (locale === 'bn') return 'bn-BD';
    if (locale === 'ms') return 'ms-MY';
    return 'en-US';
}

export function extractBestTranscript(event: SpeechRecognitionEvent): string {
    let best = '';
    for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript?.trim() ?? '';
        if (transcript.length > best.length) {
            best = transcript;
        }
    }
    return best;
}