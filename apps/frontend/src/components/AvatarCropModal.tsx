'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState, type ComponentType } from 'react';
import type { Area } from 'react-easy-crop';
import { Loader2, X } from 'lucide-react';
import { getCroppedImageBlob } from '@/lib/crop-image';

type SimpleCropperProps = {
    image: string;
    crop: { x: number; y: number };
    zoom: number;
    aspect: number;
    cropShape: 'round';
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

type AvatarCropModalProps = {
    imageSrc: string;
    open: boolean;
    title: string;
    confirmLabel: string;
    cancelLabel: string;
    onClose: () => void;
    onConfirm: (file: File) => Promise<void>;
};

export default function AvatarCropModal({
    imageSrc,
    open,
    title,
    confirmLabel,
    cancelLabel,
    onClose,
    onConfirm,
}: AvatarCropModalProps) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
    const [saving, setSaving] = useState(false);

    const onCropComplete = useCallback((_: Area, pixels: Area) => {
        setCroppedAreaPixels(pixels);
    }, []);

    const handleConfirm = async () => {
        if (!croppedAreaPixels) return;
        setSaving(true);
        try {
            const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels);
            const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
            await onConfirm(file);
            onClose();
        } finally {
            setSaving(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                    <h2 className="text-lg font-black tracking-tight text-gray-900">{title}</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label={cancelLabel}
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="relative h-72 bg-gray-900">
                    <Cropper
                        image={imageSrc}
                        crop={crop}
                        zoom={zoom}
                        aspect={1}
                        cropShape="round"
                        showGrid={false}
                        onCropChange={setCrop}
                        onZoomChange={setZoom}
                        onCropComplete={onCropComplete}
                    />
                </div>

                <div className="px-5 py-4 border-t border-gray-100 space-y-4">
                    <label className="block text-xs font-bold uppercase tracking-widest text-gray-400">
                        Zoom
                        <input
                            type="range"
                            min={1}
                            max={3}
                            step={0.05}
                            value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="mt-2 w-full accent-blue-600"
                        />
                    </label>

                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                        >
                            {cancelLabel}
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={saving || !croppedAreaPixels}
                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}