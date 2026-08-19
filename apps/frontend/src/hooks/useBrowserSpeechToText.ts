'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import {
    classifySpeechRecognitionError,
    extractBestTranscript,
    getSpeechRecognitionCtor,
    isBrowserOffline,
    isSpeechRecognitionSupported,
    requestMicrophoneAccess,
    speechLocaleFallbackChain,
    type BrowserSpeechRecognition,
    type SpeechRecognitionErrorCode,
} from '@/lib/voice-nav';

/** Questions are longer than a nav phrase; still cap so a forgotten session cannot run forever. */
const LISTEN_TIMEOUT_MS = 15_000;
/** Chromium often reports a spurious `network` error on the first attempt; retry before giving up. */
const MAX_NETWORK_ATTEMPTS = 3;
const NETWORK_RETRY_DELAY_MS = 500;

export type BrowserSpeechToTextMessages = {
    unsupported: string;
    micDenied: string;
    listenError: string;
    networkError: string;
    serviceUnreachable: string;
    audioCaptureError: string;
    insecureContext: string;
};

/**
 * Browser Web Speech → a transcript callback. Shared retry/locale-chain behaviour
 * with the header voice-nav mic, without the navigation matching.
 */
export function useBrowserSpeechToText({
    locale,
    onTranscript,
    messages,
    enabled = true,
}: {
    locale: string;
    onTranscript: (text: string) => void;
    messages: BrowserSpeechToTextMessages;
    enabled?: boolean;
}): {
    supported: boolean;
    listening: boolean;
    toggle: () => void;
} {
    const [supported, setSupported] = useState(false);
    const [listening, setListening] = useState(false);
    const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const networkAttemptsRef = useRef(0);
    const handledRef = useRef(false);
    const startingRef = useRef(false);
    const heardRef = useRef<string | null>(null);
    const onTranscriptRef = useRef(onTranscript);
    onTranscriptRef.current = onTranscript;
    const messagesRef = useRef(messages);
    messagesRef.current = messages;

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

    useEffect(() => {
        if (!enabled && listening) stopListening();
    }, [enabled, listening, stopListening]);

    const applyTranscript = useCallback((transcript: string) => {
        const trimmed = transcript.trim();
        if (!trimmed || handledRef.current) return;
        handledRef.current = true;
        heardRef.current = trimmed;
        stopListening();
        onTranscriptRef.current(trimmed);
    }, [stopListening]);

    const toastForSpeechError = useCallback((code: SpeechRecognitionErrorCode) => {
        const m = messagesRef.current;
        switch (code) {
            case 'not-allowed':
                toast.error(m.micDenied);
                break;
            case 'network':
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
    }, []);

    const launchRecognition = useCallback((
        lang: string,
        langChain: string[],
        langIndex: number,
    ) => {
        const Ctor = getSpeechRecognitionCtor();
        if (!Ctor) {
            toast.error(messagesRef.current.unsupported);
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
        clearListenTimeout();

        const recognition = new Ctor();
        recognitionRef.current = recognition;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = lang;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
            const transcript = extractBestTranscript(event);
            if (transcript) heardRef.current = transcript;
            const finalResult = Array.from({ length: event.results.length }, (_, i) => event.results[i])
                .find((result) => result.isFinal);
            if (finalResult?.[0]?.transcript) {
                applyTranscript(finalResult[0].transcript);
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
            if (retryTimerRef.current) return;
            setListening(false);
            recognitionRef.current = null;
            if (!handledRef.current && heardRef.current) {
                applyTranscript(heardRef.current);
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
            toast.error(messagesRef.current.listenError);
        }
    }, [applyTranscript, clearListenTimeout, clearRetryTimer, stopListening, toastForSpeechError]);

    const startListening = useCallback(async () => {
        if (startingRef.current) return;
        startingRef.current = true;
        const m = messagesRef.current;

        try {
            if (!isSpeechRecognitionSupported()) {
                toast.error(m.unsupported);
                return;
            }

            const mic = await requestMicrophoneAccess();
            if (mic.ok === false) {
                if (mic.reason === 'denied') toast.error(m.micDenied);
                else if (mic.reason === 'insecure') toast.error(m.insecureContext);
                else toast.error(m.audioCaptureError);
                return;
            }

            networkAttemptsRef.current = 0;
            const langChain = speechLocaleFallbackChain(locale);
            launchRecognition(langChain[0], langChain, 0);
        } finally {
            startingRef.current = false;
        }
    }, [launchRecognition, locale]);

    const toggle = useCallback(() => {
        if (!enabled) return;
        if (listening) {
            const heard = heardRef.current;
            stopListening();
            if (heard) applyTranscript(heard);
            return;
        }
        void startListening();
    }, [applyTranscript, enabled, listening, startListening, stopListening]);

    return { supported, listening, toggle };
}
