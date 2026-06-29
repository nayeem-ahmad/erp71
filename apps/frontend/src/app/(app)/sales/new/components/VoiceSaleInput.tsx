'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}

type SpeechRecognitionInstance = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start: () => void;
    stop: () => void;
    abort: () => void;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: Event & { error: string }) => void) | null;
    onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

export interface VoiceSaleProduct {
    id: string;
    name: string;
    price: number;
    group?: { name: string };
    subgroup?: { name: string };
}

export interface VoiceSaleParsedItem {
    matched: boolean;
    productName: string;
    quantity: number;
    product?: VoiceSaleProduct;
}

export interface VoiceSaleResult {
    transcript: string;
    items: VoiceSaleParsedItem[];
    unmatched: string[];
    note?: string;
}

interface VoiceSaleInputProps {
    onResult: (result: VoiceSaleResult) => void;
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
    if (typeof window === 'undefined') return null;
    const w = window as Window & {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function VoiceSaleInput({ onResult }: VoiceSaleInputProps) {
    const { locale } = useI18n();
    const [supported, setSupported] = useState(false);
    const [listening, setListening] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [error, setError] = useState<string | null>(null);
    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const finalTranscriptRef = useRef('');

    useEffect(() => {
        setSupported(!!getSpeechRecognitionCtor());
    }, []);

    const stopRecognition = useCallback(() => {
        recognitionRef.current?.stop();
        recognitionRef.current = null;
        setListening(false);
    }, []);

    const processTranscript = useCallback(async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) {
            setError('No speech detected. Try again.');
            return;
        }

        setProcessing(true);
        setError(null);
        try {
            const result = (await api.aiParseVoiceSale({
                transcript: trimmed,
                locale: locale === 'bn' ? 'bn' : 'en',
            })) as VoiceSaleResult;

            if (result.items.length === 0) {
                setError('Could not understand any products. Try speaking more clearly.');
                return;
            }

            onResult(result);
            setTranscript('');
            finalTranscriptRef.current = '';
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to parse voice sale';
            setError(message);
        } finally {
            setProcessing(false);
        }
    }, [locale, onResult]);

    const startListening = useCallback(() => {
        const Ctor = getSpeechRecognitionCtor();
        if (!Ctor) {
            setError('Voice input is not supported in this browser. Try Chrome or Edge.');
            return;
        }

        setError(null);
        setTranscript('');
        finalTranscriptRef.current = '';

        const recognition = new Ctor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = locale === 'bn' ? 'bn-BD' : 'en-US';

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const chunk = event.results[i][0]?.transcript ?? '';
                if (event.results[i].isFinal) {
                    finalTranscriptRef.current += `${chunk} `;
                } else {
                    interim += chunk;
                }
            }
            setTranscript(`${finalTranscriptRef.current}${interim}`.trim());
        };

        recognition.onerror = (event) => {
            if (event.error !== 'aborted' && event.error !== 'no-speech') {
                setError(`Microphone error: ${event.error}`);
            }
            setListening(false);
        };

        recognition.onend = () => {
            setListening(false);
            recognitionRef.current = null;
        };

        recognitionRef.current = recognition;
        recognition.start();
        setListening(true);
    }, [locale]);

    const handleToggle = async () => {
        if (processing) return;

        if (listening) {
            stopRecognition();
            await processTranscript(transcript || finalTranscriptRef.current);
            return;
        }

        startListening();
    };

    if (!supported) {
        return null;
    }

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={handleToggle}
                    disabled={processing}
                    title={listening ? 'Stop and add items' : 'Speak sale items'}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-sm font-medium transition-colors disabled:opacity-50 ${
                        listening
                            ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'
                            : 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'
                    }`}
                >
                    {processing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : listening ? (
                        <MicOff className="w-4 h-4" />
                    ) : (
                        <Mic className="w-4 h-4" />
                    )}
                    <span>{processing ? 'Parsing…' : listening ? 'Stop' : 'Voice'}</span>
                </button>
                {listening && (
                    <span className="text-xs text-red-600 animate-pulse">Listening…</span>
                )}
            </div>

            {(transcript || error) && (
                <div className="text-xs text-gray-600 bg-gray-50 border rounded px-2 py-1.5 max-w-md">
                    {error ? (
                        <span className="text-red-600">{error}</span>
                    ) : (
                        <span className="italic">&ldquo;{transcript}&rdquo;</span>
                    )}
                </div>
            )}
        </div>
    );
}