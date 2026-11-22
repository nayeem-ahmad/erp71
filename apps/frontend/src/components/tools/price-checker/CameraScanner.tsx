'use client';

import { useEffect, useRef, useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

/** The slice of the Shape Detection API this uses. Chrome on Android has it; Safari and Firefox do not yet. */
interface DetectedBarcode {
    rawValue: string;
}
interface BarcodeDetectorLike {
    detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/** The formats on shop shelves: EAN/UPC on packets, Code 128 on the shop's own labels, QR now and then. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

export function barcodeDetector(): BarcodeDetectorCtor | null {
    if (typeof window === 'undefined') return null;
    return ((window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null);
}

/**
 * Reads one barcode through the phone camera and hands its value back. Only
 * offered where the browser can detect barcodes itself — no library is
 * downloaded for it — and a USB or Bluetooth scanner works everywhere anyway.
 */
export function CameraScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
    const { t } = useI18n();
    const m = t.tools.priceChecker;
    const videoRef = useRef<HTMLVideoElement>(null);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        const Detector = barcodeDetector();
        if (!Detector || !navigator.mediaDevices?.getUserMedia) {
            setProblem(m.cameraUnsupported);
            return;
        }
        let stream: MediaStream | null = null;
        let frame = 0;
        let stopped = false;
        const detector = new Detector({ formats: FORMATS });

        const tick = async () => {
            if (stopped) return;
            const video = videoRef.current;
            if (video && video.readyState >= 2) {
                try {
                    const found = await detector.detect(video);
                    const value = found.find((code) => code.rawValue)?.rawValue;
                    if (value) {
                        stopped = true;
                        onDetected(value);
                        return;
                    }
                } catch {
                    /* a frame that could not be read; try the next */
                }
            }
            frame = window.setTimeout(() => void tick(), 200);
        };

        navigator.mediaDevices
            .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
            .then((media) => {
                if (stopped) {
                    media.getTracks().forEach((track) => track.stop());
                    return;
                }
                stream = media;
                if (videoRef.current) {
                    videoRef.current.srcObject = media;
                    void videoRef.current.play().catch(() => undefined);
                }
                void tick();
            })
            .catch(() => setProblem(m.cameraDenied));

        return () => {
            stopped = true;
            window.clearTimeout(frame);
            stream?.getTracks().forEach((track) => track.stop());
        };
    }, [onDetected, m.cameraDenied, m.cameraUnsupported]);

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={m.cameraTitle} onClose={onClose} closeLabel={m.close} />
            <div className="p-4">
                {problem ? (
                    <Alert tone="warning">{problem}</Alert>
                ) : (
                    <div className="relative overflow-hidden rounded-md bg-black">
                        <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
                        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" aria-hidden />
                    </div>
                )}
            </div>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {m.close}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
