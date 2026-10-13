'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Record a voice note in the browser and hand it back as a `File`.
 *
 * Unlike `VoiceEntryInput`, nothing is transcribed: the recording itself is
 * the deliverable, attached to whatever the caller is sending. Chrome and
 * Firefox record WebM/Ogg Opus, Safari records MP4 — the first supported type
 * wins, and the file's extension follows it so it plays back wherever it is
 * downloaded.
 */

/** Long enough to describe a problem, short enough to stay a few MB. */
export const MAX_VOICE_NOTE_MS = 5 * 60_000;

const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

export function pickVoiceNoteMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return 'audio/webm';
    return RECORDER_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export function voiceNoteExtension(mimeType: string): string {
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mp4')) return 'm4a';
    return 'webm';
}

export type VoiceRecorderError = 'unsupported' | 'denied' | 'failed';

export function useVoiceRecorder({
    onRecorded,
    maxMs = MAX_VOICE_NOTE_MS,
}: {
    onRecorded: (file: File) => void;
    maxMs?: number;
}) {
    const [supported, setSupported] = useState(false);
    const [recording, setRecording] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [error, setError] = useState<VoiceRecorderError | null>(null);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<BlobPart[]>([]);
    const startedAtRef = useRef(0);
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Set on unmount, so a recording stopped by leaving is thrown away rather than delivered. */
    const discardRef = useRef(false);
    const onRecordedRef = useRef(onRecorded);
    onRecordedRef.current = onRecorded;

    useEffect(() => {
        setSupported(
            typeof window !== 'undefined'
            && !!navigator.mediaDevices?.getUserMedia
            && typeof MediaRecorder !== 'undefined',
        );
    }, []);

    const release = useCallback(() => {
        if (tickRef.current) clearInterval(tickRef.current);
        if (capRef.current) clearTimeout(capRef.current);
        tickRef.current = null;
        capRef.current = null;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }, []);

    const stop = useCallback(() => {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
    }, []);

    const start = useCallback(async () => {
        if (recorderRef.current) return;
        setError(null);
        if (!supported) {
            setError('unsupported');
            return;
        }

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err: any) {
            setError(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'failed');
            return;
        }

        try {
            streamRef.current = stream;
            const mimeType = pickVoiceNoteMimeType();
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            recorderRef.current = recorder;
            chunksRef.current = [];

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) chunksRef.current.push(event.data);
            };
            recorder.onstop = () => {
                release();
                recorderRef.current = null;
                setRecording(false);
                if (discardRef.current) return;
                const type = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
                const blob = new Blob(chunksRef.current, { type });
                chunksRef.current = [];
                if (!blob.size) {
                    setError('failed');
                    return;
                }
                const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                onRecordedRef.current(
                    new File([blob], `voice-note-${stamp}.${voiceNoteExtension(type)}`, { type }),
                );
            };

            recorder.start();
            startedAtRef.current = Date.now();
            setElapsedMs(0);
            setRecording(true);
            tickRef.current = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250);
            capRef.current = setTimeout(stop, maxMs);
        } catch {
            release();
            recorderRef.current = null;
            setError('failed');
        }
    }, [maxMs, release, stop, supported]);

    useEffect(
        () => () => {
            discardRef.current = true;
            const recorder = recorderRef.current;
            if (recorder && recorder.state !== 'inactive') recorder.stop();
            release();
        },
        [release],
    );

    return { supported, recording, elapsedMs, error, start, stop };
}

/** `83_000` → `1:23`. */
export function formatRecordingTime(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
