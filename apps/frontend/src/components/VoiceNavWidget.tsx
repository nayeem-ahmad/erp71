'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, MicOff } from 'lucide-react';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import {
    classifySpeechRecognitionError,
    extractBestTranscript,
    getSpeechRecognitionCtor,
    getVoiceNavHintIds,
    isBrowserOffline,
    isSpeechRecognitionSupported,
    matchVoiceNav,
    requestMicrophoneAccess,
    speechLocaleFallbackChain,
    type BrowserSpeechRecognition,
    type SpeechRecognitionErrorCode,
} from '@/lib/voice-nav';

const LISTEN_TIMEOUT_MS = 6_000;
/** Chromium often reports a spurious `network` error on the first attempt; retry before giving up. */
const MAX_NETWORK_ATTEMPTS = 3;
const NETWORK_RETRY_DELAY_MS = 500;

export default function VoiceNavWidget() {
    const { t, locale } = useI18n();
    const m = t.components.voiceNavWidget;
    const router = useRouter();
    const [supported, setSupported] = useState(false);
    const [listening, setListening] = useState(false);
    const [heard, setHeard] = useState<string | null>(null);
    const heardRef = useRef<string | null>(null);
    const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const networkAttemptsRef = useRef(0);
    const handledRef = useRef(false);
    const startingRef = useRef(false);

    useEffect(() => {
        setSupported(isSpeechRecognitionSupported());
    }, []);

    const clearListenTimeout = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, []);

    const clearRetryTimer = useCallback(() => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, []);

    const stopListening = useCallback(() => {
        clearListenTimeout();
        clearRetryTimer();
        const recognition = recognitionRef.current;
        recognitionRef.current = null;
        if (recognition) {
            try {
                recognition.abort();
            } catch {
                try {
                    recognition.stop();
                } catch {
                    // Recognition may already be stopped or failed to start.
                }
            }
        }
        setListening(false);
    }, [clearListenTimeout, clearRetryTimer]);

    useEffect(() => () => {
        clearListenTimeout();
        clearRetryTimer();
        recognitionRef.current?.abort();
    }, [clearListenTimeout, clearRetryTimer]);

    const navigateToMatch = useCallback((transcript: string) => {
        const match = matchVoiceNav(transcript);
        if (!match) {
            const hints = getVoiceNavHintIds()
                .map((id) => m.targets[id])
                .join(', ');
            toast.error(formatMessage(m.notRecognized, { hints }));
            return;
        }

        const pageLabel = m.targets[match.route.id];
        toast.success(formatMessage(m.navigating, { page: pageLabel }));
        router.push(match.route.path);
    }, [m, router]);

    const handleTranscript = useCallback((transcript: string) => {
        const trimmed = transcript.trim();
        if (!trimmed || handledRef.current) return;
        handledRef.current = true;
        heardRef.current = trimmed;
        setHeard(trimmed);
        stopListening();
        navigateToMatch(trimmed);
    }, [navigateToMatch, stopListening]);

    const toastForSpeechError = useCallback((code: SpeechRecognitionErrorCode) => {
        switch (code) {
            case 'not-allowed':
                toast.error(m.micDenied);
                break;
            case 'network':
                // `network` covers both "device is offline" and "speech backend unreachable" —
                // the latter happens on perfectly good connections (VPN/ad blocker/Brave).
                toast.error(isBrowserOffline() ? m.networkError : m.serviceUnreachable);
                break;
            case 'audio-capture':
                toast.error(m.audioCaptureError);
                break;
            case 'service-not-allowed':
                toast.error(m.insecureContext);
                break;
            case 'aborted':
            case 'no-speech':
                break;
            default:
                toast.error(m.listenError);
        }
    }, [m]);

    const launchRecognition = useCallback((
        lang: string,
        langChain: string[],
        langIndex: number,
    ) => {
        const Ctor = getSpeechRecognitionCtor();
        if (!Ctor) {
            toast.error(m.unsupported);
            return;
        }

        if (recognitionRef.current) {
            try {
                recognitionRef.current.abort();
            } catch {
                // Ignore stale recognition instances.
            }
            recognitionRef.current = null;
        }

        handledRef.current = false;
        heardRef.current = null;
        setHeard(null);
        clearListenTimeout();

        const recognition = new Ctor();
        recognitionRef.current = recognition;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = lang;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
            const transcript = extractBestTranscript(event);
            if (transcript) {
                heardRef.current = transcript;
                setHeard(transcript);
            }
            const finalResult = Array.from({ length: event.results.length }, (_, i) => event.results[i])
                .find((result) => result.isFinal);
            if (finalResult?.[0]?.transcript) {
                handleTranscript(finalResult[0].transcript);
            }
        };

        recognition.onerror = (event) => {
            const code = classifySpeechRecognitionError(event.error);
            const canFallBackLang = langIndex + 1 < langChain.length;

            if (code === 'language-not-supported' && canFallBackLang) {
                recognitionRef.current = null;
                launchRecognition(langChain[langIndex + 1], langChain, langIndex + 1);
                return;
            }

            if (code === 'network' && !isBrowserOffline()) {
                networkAttemptsRef.current += 1;
                if (networkAttemptsRef.current < MAX_NETWORK_ATTEMPTS) {
                    // Some locales route to a backend the browser cannot reach; fall through to
                    // en-US first, then retry once more before surfacing an error.
                    const nextIndex = canFallBackLang ? langIndex + 1 : langIndex;
                    recognitionRef.current = null;
                    clearRetryTimer();
                    retryTimerRef.current = setTimeout(() => {
                        retryTimerRef.current = null;
                        launchRecognition(langChain[nextIndex], langChain, nextIndex);
                    }, NETWORK_RETRY_DELAY_MS);
                    return;
                }
            }

            stopListening();
            toastForSpeechError(code);
        };

        recognition.onend = () => {
            clearListenTimeout();
            if (retryTimerRef.current) return; // a retry is already queued; stay in listening state
            setListening(false);
            recognitionRef.current = null;
            if (!handledRef.current && heardRef.current) {
                handleTranscript(heardRef.current);
            }
        };

        try {
            recognition.start();
            setListening(true);
            timeoutRef.current = setTimeout(() => {
                if (!handledRef.current) {
                    try {
                        recognition.stop();
                    } catch {
                        stopListening();
                    }
                }
            }, LISTEN_TIMEOUT_MS);
        } catch {
            stopListening();
            toast.error(m.listenError);
        }
    }, [clearListenTimeout, clearRetryTimer, handleTranscript, m, stopListening, toastForSpeechError]);

    const startListening = useCallback(async () => {
        if (startingRef.current) return;
        startingRef.current = true;

        try {
            if (!isSpeechRecognitionSupported()) {
                toast.error(m.unsupported);
                return;
            }

            const mic = await requestMicrophoneAccess();
            if (mic.ok === false) {
                if (mic.reason === 'denied') {
                    toast.error(m.micDenied);
                } else if (mic.reason === 'insecure') {
                    toast.error(m.insecureContext);
                } else {
                    toast.error(m.audioCaptureError);
                }
                return;
            }

            networkAttemptsRef.current = 0;
            const langChain = speechLocaleFallbackChain(locale);
            launchRecognition(langChain[0], langChain, 0);
        } finally {
            startingRef.current = false;
        }
    }, [launchRecognition, locale, m]);

    const handleMicClick = () => {
        if (listening) {
            stopListening();
            if (heard) {
                handleTranscript(heard);
            }
            return;
        }
        void startListening();
    };

    const hintTargets = getVoiceNavHintIds();

    // One button. The examples used to sit behind a `?` of their own, which
    // read as the app's Help and cost the header a second icon; they now show
    // while the mic is listening, which is the moment they are needed.
    return (
        <div className="relative flex items-center">
            {listening && (
                <div
                    role="status"
                    // Full width under the header on a phone: the mic sits well left
                    // of the screen edge there, so an end-anchored card would run off.
                    className="fixed inset-x-3 top-16 z-50 rounded-xl border border-gray-200 bg-white p-3 shadow-xl md:absolute md:inset-x-auto md:end-0 md:top-full md:mt-2 md:w-72"
                >
                    <p className="text-sm font-semibold text-gray-800">{m.listeningTitle}</p>
                    {heard ? (
                        <p className="mt-1 truncate text-xs text-gray-600">{formatMessage(m.heard, { phrase: heard })}</p>
                    ) : null}
                    <p className="mb-1.5 mt-2 text-xs text-gray-500">{m.hintDescription}</p>
                    <ul className="flex flex-col gap-1">
                        {hintTargets.map((id) => (
                            <li key={id} className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">
                                “{m.examples[id]}”
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <button
                type="button"
                onClick={handleMicClick}
                disabled={!supported}
                className={`relative flex min-h-touch min-w-touch items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    listening
                        ? 'bg-red-50 text-red-600'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                }`}
                aria-label={listening ? m.stopAria : m.startAria}
                title={!supported ? m.unsupported : listening ? m.listeningTitle : m.startTitle}
            >
                {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                {listening && (
                    <span className="absolute end-2 top-2 h-2 w-2 animate-pulse rounded-full bg-red-500 ring-2 ring-white" />
                )}
            </button>
        </div>
    );
}
