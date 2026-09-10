'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import type { Area } from 'react-easy-crop';
import ModalShell, { ModalFooter, ModalHeader } from './ModalShell';
import Button from './ui/compact/Button';
import { getCroppedImageBlob } from '@/lib/crop-image';

type SimpleCropperProps = {
    image: string;
    crop: { x: number; y: number };
    zoom: number;
    aspect: number;
    cropShape: 'rect' | 'round';
    showGrid?: boolean;
    onCropChange: (point: { x: number; y: number }) => void;
    onZoomChange: (zoom: number) => void;
    onCropComplete: (area: Area, pixels: Area) => void;
};

const Cropper = dynamic(
    () =>
        import('react-easy-crop').then((mod) => ({
            default: mod.default as unknown as ComponentType<SimpleCropperProps>,
        })),
    { ssr: false },
);

/**
 * One selectable crop ratio. `ratio: null` means "whatever the picture already
 * is" — the frame then only zooms and pans, which is what someone uploading a
 * wordmark almost always wants.
 */
export type CropRatioOption = { key: string; label: string; ratio: number | null };

type ImageCropModalProps = {
    /** Object or data URL of the picked file. */
    imageSrc: string;
    title: string;
    /** Fixed ratio, used when `ratioOptions` is not given. */
    aspect?: number;
    /** Offer a choice of ratios; a single option renders no picker. */
    ratioOptions?: CropRatioOption[];
    cropShape?: 'rect' | 'round';
    confirmLabel: string;
    cancelLabel: string;
    zoomLabel: string;
    /** Name for the produced file — the extension is always `.jpg`. */
    fileName?: string;
    /** Longest-edge ceiling for the uploaded result, in pixels. */
    maxOutputEdge?: number;
    onClose: () => void;
    onConfirm: (file: File) => Promise<void>;
};

/**
 * Pick the visible part of an image before it is uploaded.
 *
 * Cropping happens in the browser and only the result is sent, so a 4 MB phone
 * photo does not become a 4 MB hero image that every shopper downloads. The
 * cropper itself is loaded lazily: `react-easy-crop` measures the DOM and
 * cannot render on the server, and no page should pay for it until someone
 * actually picks a file.
 */
export default function ImageCropModal({
    imageSrc,
    title,
    aspect = 1,
    ratioOptions,
    cropShape = 'rect',
    confirmLabel,
    cancelLabel,
    zoomLabel,
    fileName = 'image.jpg',
    maxOutputEdge,
    onClose,
    onConfirm,
}: Readonly<ImageCropModalProps>) {
    const options = useMemo<CropRatioOption[]>(
        () => ratioOptions ?? [{ key: 'fixed', label: '', ratio: aspect }],
        [ratioOptions, aspect],
    );
    const [activeKey, setActiveKey] = useState(options[0].key);
    const [naturalAspect, setNaturalAspect] = useState<number | null>(null);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
    const [saving, setSaving] = useState(false);

    // Needed only for a `ratio: null` option, but measured either way: the image
    // is already decoded by then, so this costs nothing and keeps the effect
    // free of conditions that would make it re-run on every option change.
    useEffect(() => {
        let cancelled = false;
        const probe = new Image();
        probe.onload = () => {
            if (!cancelled && probe.naturalHeight > 0) {
                setNaturalAspect(probe.naturalWidth / probe.naturalHeight);
            }
        };
        probe.src = imageSrc;
        return () => {
            cancelled = true;
        };
    }, [imageSrc]);

    const active = options.find((option) => option.key === activeKey) ?? options[0];
    // `naturalAspect` lands one paint after the modal opens; 1 is the harmless
    // placeholder until it does, and the frame re-fits the moment it arrives.
    const activeAspect = active.ratio ?? naturalAspect ?? 1;

    const onCropComplete = useCallback((_: Area, pixels: Area) => {
        setCroppedAreaPixels(pixels);
    }, []);

    const handleConfirm = async () => {
        if (!croppedAreaPixels) return;
        setSaving(true);
        try {
            const blob = await getCroppedImageBlob(
                imageSrc,
                croppedAreaPixels,
                'image/jpeg',
                maxOutputEdge,
            );
            await onConfirm(new File([blob], fileName, { type: 'image/jpeg' }));
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="md" onBackdropClick={saving ? undefined : onClose}>
            <ModalHeader title={title} onClose={onClose} closeLabel={cancelLabel} />

            <div className="relative h-64 sm:h-80 bg-gray-900 flex-shrink-0">
                <Cropper
                    image={imageSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={activeAspect}
                    cropShape={cropShape}
                    showGrid={cropShape === 'rect'}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={onCropComplete}
                />
            </div>

            <div className="px-4 py-3 space-y-3 overflow-y-auto">
                {options.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                        {options.map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                onClick={() => {
                                    setActiveKey(option.key);
                                    setCrop({ x: 0, y: 0 });
                                    setZoom(1);
                                }}
                                aria-pressed={option.key === activeKey}
                                className={`min-h-touch rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                    option.key === activeKey
                                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                )}

                <label className="block text-xs font-medium text-gray-500">
                    {zoomLabel}
                    <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.05}
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        className="mt-1.5 w-full accent-blue-600"
                    />
                </label>
            </div>

            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>
                    {cancelLabel}
                </Button>
                <Button
                    size="md"
                    onClick={handleConfirm}
                    loading={saving}
                    disabled={!croppedAreaPixels}
                >
                    {confirmLabel}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
