'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, ScanLine, Sparkles } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { ContactFormState } from './contact-form-fields';

export type ScannedCard = Partial<Record<keyof ContactFormState, string>> & { raw_text?: string };

/** Longest edge of the image actually sent. Card text stays legible well below this. */
const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.85;
/** Below this a re-encode buys nothing worth the decode. */
const SKIP_RESIZE_BYTES = 400 * 1024;

/**
 * Shrink and re-encode a photo before it goes over the wire.
 *
 * Phone cameras produce 4–12 MB frames, and a card only needs enough resolution
 * for its smallest line of text. Re-encoding also normalises the format, which
 * is what makes an iPhone HEIC pick work: the browser decodes it and the canvas
 * hands back JPEG.
 *
 * Decoding goes through `createImageBitmap` rather than an `Image` element on
 * purpose — it rejects on a format the browser cannot read, where `img.onerror`
 * may simply never fire and leave the scan hanging with no way out. Any failure
 * here falls back to the original bytes, so the server still gets its chance.
 */
async function toScannablePayload(file: File): Promise<{ dataUrl: string; mimeType: string }> {
    const original = async () => ({
        dataUrl: await readAsDataUrl(file),
        mimeType: file.type || 'image/jpeg',
    });

    if (typeof createImageBitmap !== 'function') return original();
    if (file.type === 'image/jpeg' && file.size <= SKIP_RESIZE_BYTES) return original();

    let bitmap: ImageBitmap | undefined;
    try {
        bitmap = await createImageBitmap(file);
        const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas context');
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), mimeType: 'image/jpeg' };
    } catch {
        return original();
    } finally {
        bitmap?.close?.();
    }
}

function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

type BusinessCardScannerProps = {
    open: boolean;
    onClose: () => void;
    /** Receives the extracted fields; the caller decides what to do with them. */
    onApply: (fields: ScannedCard) => void;
};

export default function BusinessCardScanner({ open, onClose, onApply }: Readonly<BusinessCardScannerProps>) {
    const { t } = useI18n();
    const m = t.crm.contacts.scan;
    const c = t.common;
    const contactFields = t.crm.contacts.fields;

    const [preview, setPreview] = useState<string | null>(null);
    const [payload, setPayload] = useState<{ dataUrl: string; mimeType: string } | null>(null);
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ScannedCard | null>(null);
    const galleryInput = useRef<HTMLInputElement>(null);
    const cameraInput = useRef<HTMLInputElement>(null);

    const reset = useCallback(() => {
        setPreview(null);
        setPayload(null);
        setResult(null);
        setError(null);
        setScanning(false);
    }, []);

    useEffect(() => {
        if (!open) reset();
    }, [open, reset]);

    const pickFile = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setError(m.notAnImage);
            return;
        }
        setError(null);
        setResult(null);
        try {
            const prepared = await toScannablePayload(file);
            setPayload(prepared);
            setPreview(prepared.dataUrl);
        } catch {
            // An unreadable file leaves the picker where it was, with a reason.
            setError(m.failed);
        }
    };

    const scan = async () => {
        if (!payload) return;
        setScanning(true);
        setError(null);
        try {
            const response = await api.scanBusinessCard(payload.dataUrl, payload.mimeType);
            const fields = (response?.fields ?? {}) as ScannedCard;
            if (!Object.keys(fields).length) {
                setError(m.nothingFound);
                return;
            }
            setResult(fields);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.failed);
        } finally {
            setScanning(false);
        }
    };

    if (!open) return null;

    // `raw_text` is shown separately: it is context for the human, not a field
    // the form has anywhere to put.
    const previewRows = result
        ? (Object.entries(result).filter(([key, value]) => key !== 'raw_text' && value) as [string, string][])
        : [];

    const fieldLabel = (key: string): string => {
        const labels = contactFields as unknown as Record<string, string>;
        const camel = key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
        return labels[camel] ?? labels[key] ?? key;
    };

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader title={m.title} subtitle={m.subtitle} onClose={onClose} closeLabel={c.cancel} />

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <input
                    ref={galleryInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }}
                />
                <input
                    ref={cameraInput}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }}
                />

                {preview ? (
                    <div className="space-y-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={preview}
                            alt={m.title}
                            className="w-full max-h-64 object-contain rounded-lg border border-gray-200 bg-gray-50"
                        />
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="secondary"
                                onClick={() => galleryInput.current?.click()}
                                leftIcon={<ImagePlus className="w-4 h-4" />}
                            >
                                {m.changeImage}
                            </Button>
                            {!result && (
                                <Button
                                    onClick={scan}
                                    loading={scanning}
                                    leftIcon={<ScanLine className="w-4 h-4" />}
                                >
                                    {scanning ? m.scanning : m.scan}
                                </Button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center space-y-3">
                        <ScanLine className="w-8 h-8 mx-auto text-gray-300" />
                        <p className="text-sm text-gray-500">{m.noFile}</p>
                        <div className="flex flex-wrap gap-2 justify-center">
                            <Button
                                onClick={() => cameraInput.current?.click()}
                                leftIcon={<Camera className="w-4 h-4" />}
                            >
                                {m.takePhoto}
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => galleryInput.current?.click()}
                                leftIcon={<ImagePlus className="w-4 h-4" />}
                            >
                                {m.chooseFile}
                            </Button>
                        </div>
                        <p className="text-xs text-gray-400">{m.creditsHint}</p>
                    </div>
                )}

                {error && (
                    <p role="alert" className="text-xs text-danger">
                        {error}
                    </p>
                )}

                {result && (
                    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
                        <p className="text-xs font-semibold text-gray-500 inline-flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                            {m.reviewHint}
                        </p>
                        <dl className="grid gap-1.5 sm:grid-cols-2">
                            {previewRows.map(([key, value]) => (
                                <div key={key} className="text-sm">
                                    <dt className="text-xs text-gray-400">{fieldLabel(key)}</dt>
                                    <dd className="text-gray-800 break-words">{value}</dd>
                                </div>
                            ))}
                        </dl>
                        {result.raw_text && (
                            <details className="text-xs text-gray-500">
                                <summary className="cursor-pointer">{m.rawText}</summary>
                                <p className="mt-1 whitespace-pre-wrap text-gray-600">{result.raw_text}</p>
                            </details>
                        )}
                    </div>
                )}
            </div>

            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {c.cancel}
                </Button>
                <Button
                    onClick={() => {
                        if (result) onApply(result);
                    }}
                    disabled={!result}
                >
                    {m.apply}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
