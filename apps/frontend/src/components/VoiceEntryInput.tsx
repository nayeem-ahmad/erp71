'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Mic, MicOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { VoiceEntryResult, VoiceEntryType } from '@/lib/voice-entry';

interface VoiceEntryInputProps {
    entryType: VoiceEntryType;
    onResult: (result: VoiceEntryResult) => void;
    inline?: boolean;
    children?: ReactNode;
    disabled?: boolean;
}

const MAX_RECORDING_MS = 30_000;

function pickRecorderMimeType(): string {
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
    ];
    for (const type of candidates) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    return 'audio/webm';
}

function mimeToFormat(mimeType: string): string {
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mp4')) return 'm4a';
    if (mimeType.includes('wav')) return 'wav';
    return 'webm';
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result;
            if (typeof result !== 'string') {
                reject(new Error('Failed to read audio'));
                return;
            }
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read audio'));
        reader.readAsDataURL(blob);
    });
}

export default function VoiceEntryInput({
    entryType,
    onResult,
    inline,
    children,
    disabled = false,
}: VoiceEntryInputProps) {
    const { locale } = useI18n();
    const [supported, setSupported] = useState(false);
    const [recording, setRecording] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<BlobPart[]>([]);
    const mimeTypeRef = useRef('audio/webm');
    const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        setSupported(
            typeof window !== 'undefined'
            && !!navigator.mediaDevices?.getUserMedia
            && typeof MediaRecorder !== 'undefined',
        );
    }, []);

    const cleanupStream = useCallback(() => {
        if (stopTimerRef.current) {
            clearTimeout(stopTimerRef.current);
            stopTimerRef.current = null;
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
    }, []);

    useEffect(() => () => cleanupStream(), [cleanupStream]);

    const processAudio = useCallback(async (blob: Blob) => {
        if (blob.size < 1000) {
            setError('Recording too short. Hold the button and speak your items.');
            return;
        }

        setProcessing(true);
        setError(null);
        setStatus('Transcribing…');

        try {
            const audioBase64 = await blobToBase64(blob);
            const result = (await api.aiParseVoiceEntry({
                entryType,
                audioBase64,
                audioFormat: mimeToFormat(mimeTypeRef.current),
                locale: locale === 'bn' ? 'bn' : 'en',
            })) as VoiceEntryResult;

            if (result.transcript) {
                setStatus(`"${result.transcript}"`);
            }

            if (result.items.length === 0) {
                setError('Could not understand any products. Try speaking more clearly.');
                return;
            }

            onResult(result);
            setStatus(null);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to parse voice entry';
            setError(message);
            setStatus(null);
        } finally {
            setProcessing(false);
        }
    }, [entryType, locale, onResult]);

    const stopRecording = useCallback(() => {
        const recorder = recorderRef.current;
        if (!recorder || recorder.state === 'inactive') {
            setRecording(false);
            cleanupStream();
            return;
        }
        recorder.stop();
        setRecording(false);
        setStatus('Processing…');
    }, [cleanupStream]);

    const startRecording = useCallback(async () => {
        setError(null);
        setStatus(null);
        chunksRef.current = [];

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const mimeType = pickRecorderMimeType();
            mimeTypeRef.current = mimeType;
            const recorder = new MediaRecorder(stream, { mimeType });
            recorderRef.current = recorder;

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            recorder.onerror = () => {
                setError('Recording failed. Please try again.');
                setRecording(false);
                cleanupStream();
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
                cleanupStream();
                void processAudio(blob);
            };

            recorder.start(250);
            setRecording(true);
            setStatus('Recording… speak your items, then tap Stop');

            stopTimerRef.current = setTimeout(() => {
                stopRecording();
            }, MAX_RECORDING_MS);
        } catch (err: unknown) {
            cleanupStream();
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
                setError('Microphone permission denied. Allow mic access in your browser settings.');
            } else {
                setError('Could not access microphone. Check browser permissions.');
            }
        }
    }, [cleanupStream, processAudio, stopRecording]);

    const handleToggle = () => {
        if (processing || disabled) return;
        if (recording) {
            stopRecording();
            return;
        }
        void startRecording();
    };

    if (!supported) {
        return null;
    }

    const voiceButton = (
        <button
            type="button"
            onClick={handleToggle}
            disabled={processing || disabled}
            title={recording ? 'Stop and add items' : 'Record items by voice'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-sm font-medium transition-colors disabled:opacity-50 flex-shrink-0 ${
                recording
                    ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'
                    : 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'
            }`}
        >
            {processing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
            ) : recording ? (
                <MicOff className="w-4 h-4" />
            ) : (
                <Mic className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">{processing ? 'Parsing…' : recording ? 'Stop' : 'Voice'}</span>
        </button>
    );

    const statusLine = (status || error) ? (
        <div className="text-xs text-gray-600 bg-gray-50 border rounded px-2 py-1.5">
            {error ? (
                <span className="text-red-600">{error}</span>
            ) : (
                <span className="italic">{status}</span>
            )}
        </div>
    ) : null;

    if (inline) {
        return (
            <div className="flex flex-col gap-1 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">{children}</div>
                    {voiceButton}
                </div>
                {recording && (
                    <span className="text-[11px] text-red-600 animate-pulse px-0.5">Recording…</span>
                )}
                {statusLine}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                {voiceButton}
                {recording && (
                    <span className="text-xs text-red-600 animate-pulse">Recording…</span>
                )}
            </div>
            {statusLine}
        </div>
    );
}