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