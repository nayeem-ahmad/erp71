'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, MicOff, X } from 'lucide-react';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import {
    extractBestTranscript,
    getSpeechRecognitionCtor,
    getVoiceNavHintIds,
    matchVoiceNav,
    speechLocaleToBcp47,
    type BrowserSpeechRecognition,
} from '@/lib/voice-nav';

const LISTEN_TIMEOUT_MS = 6_000;

export default function VoiceNavWidget() {
    const { t, locale } = useI18n();
    const m = t.components.voiceNavWidget;
    const router = useRouter();
    const [supported, setSupported] = useState(false);
    const [listening, setListening] = useState(false);
    const [hintOpen, setHintOpen] = useState(false);
    const [heard, setHeard] = useState<string | null>(null);
    const heardRef = useRef<string | null>(null);
    const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handledRef = useRef(false);

    useEffect(() => {
        setSupported(getSpeechRecognitionCtor() !== null);
    }, []);

    const clearListenTimeout = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, []);

    const stopListening = useCallback(() => {
        clearListenTimeout();
        recognitionRef.current?.stop();
        recognitionRef.current = null;
        setListening(false);
    }, [clearListenTimeout]);

    useEffect(() => () => {
        clearListenTimeout();
        recognitionRef.current?.abort();
    }, [clearListenTimeout]);

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
        setHintOpen(false);
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

    const startListening = useCallback(() => {
        const Ctor = getSpeechRecognitionCtor();
        if (!Ctor) {
            toast.error(m.unsupported);
            return;
        }

        handledRef.current = false;
        heardRef.current = null;
        setHeard(null);
        clearListenTimeout();

        const recognition = new Ctor();
        recognitionRef.current = recognition;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = speechLocaleToBcp47(locale);
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
            stopListening();
            if (event.error === 'not-allowed') {
                toast.error(m.micDenied);
                return;
            }
            if (event.error !== 'aborted' && event.error !== 'no-speech') {
                toast.error(m.listenError);
            }
        };

        recognition.onend = () => {
            clearListenTimeout();
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
                    recognition.stop();
                }
            }, LISTEN_TIMEOUT_MS);
        } catch {
            stopListening();
            toast.error(m.listenError);
        }
    }, [clearListenTimeout, handleTranscript, locale, m, stopListening]);

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

    return (
        <div className="flex flex-col items-end gap-2">
            {hintOpen && (
                <div className="w-72 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl animate-slide-up">
                    <style>{`
                        @keyframes slideUp {
                            from { opacity: 0; transform: translateY(12px); }
                            to   { opacity: 1; transform: translateY(0); }
                        }
                        @keyframes voiceGlow {
                            0%, 100% { box-shadow: 0 0 0 0 rgba(147, 51, 234, 0.35), 0 4px 14px rgba(147, 51, 234, 0.2); }
                            50% { box-shadow: 0 0 0 10px rgba(147, 51, 234, 0), 0 4px 18px rgba(147, 51, 234, 0.35); }
                        }
                        @keyframes voicePulse {
                            0%, 100% { transform: scale(1); }
                            50% { transform: scale(1.06); }
                        }
                        @keyframes recordRing {
                            0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
                            70% { box-shadow: 0 0 0 12px rgba(239, 68, 68, 0); }
                            100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                        }
                    `}</style>
                    <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-bold text-gray-800">{m.hintTitle}</p>
                        <button
                            type="button"
                            onClick={() => setHintOpen(false)}
                            className="text-gray-400 transition-colors hover:text-gray-600"
                            aria-label={m.closeAria}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <p className="mb-2 text-xs text-gray-500">{m.hintDescription}</p>
                    <ul className="flex flex-col gap-1.5">
                        {hintTargets.map((id) => (
                            <li
                                key={id}
                                className="rounded-lg bg-purple-50 px-2.5 py-1.5 text-xs font-medium text-purple-800"
                            >
                                “{m.examples[id]}”
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {listening && heard && (
                <div className="max-w-72 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs italic text-purple-800 shadow-sm">
                    {formatMessage(m.heard, { phrase: heard })}
                </div>
            )}

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setHintOpen((open) => !open)}
                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-gray-500 shadow-sm transition-colors hover:border-gray-300 hover:text-gray-700"
                    aria-label={m.hintAria}
                >
                    ?
                </button>

                <button
                    type="button"
                    onClick={handleMicClick}
                    disabled={!supported}
                    className={`relative flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-md transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                        listening
                            ? 'border-red-400 bg-red-50 text-red-600'
                            : 'border-purple-400 bg-purple-50 text-purple-700 hover:border-purple-500 hover:bg-purple-100'
                    }`}
                    style={{
                        animation: supported && !listening
                            ? 'voiceGlow 2.4s ease-in-out infinite'
                            : listening
                                ? 'recordRing 1.4s ease-out infinite, voicePulse 1.2s ease-in-out infinite'
                                : undefined,
                    }}
                    aria-label={listening ? m.stopAria : m.startAria}
                    title={!supported ? m.unsupported : listening ? m.listeningTitle : m.startTitle}
                >
                    {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    {listening && (
                        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white" />
                    )}
                </button>
            </div>
        </div>
    );
}