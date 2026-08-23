'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import Avatar from './Avatar';
import AvatarCropModal from './AvatarCropModal';

/** Matches the hint text and the backend's own base64 ceiling. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type PhotoValue = { url: string; storageKey: string };

type PhotoFieldProps = {
    value: PhotoValue;
    /** Drives the initials fallback, so the field reads as this person's. */
    name: string;
    onChange: (value: PhotoValue) => void;
    labels: {
        label: string;
        add: string;
        change: string;
        remove: string;
        hint: string;
        uploading: string;
        uploadFailed: string;
        tooLarge: string;
        notAnImage: string;
        cropTitle: string;
        cropConfirm: string;
    };
    cancelLabel: string;
};

function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

/**
 * Pick, crop and upload a lead's or contact's photo.
 *
 * The upload happens on crop-confirm rather than on form save, because on a
 * create form there is no record yet to hang the file off. The record then
 * carries the URL and the storage key through the ordinary create/update
 * payload, which keeps saving one-phase.
 */
export default function PhotoField({
    value,
    name,
    onChange,
    labels,
    cancelLabel,
}: Readonly<PhotoFieldProps>) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);

    const handleFilePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // Reset immediately so picking the same file twice in a row still fires.
        event.target.value = '';
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            toast.error(labels.notAnImage);
            return;
        }
        if (file.size > MAX_PHOTO_BYTES) {
            toast.error(labels.tooLarge);
            return;
        }

        setCropSrc(await readAsDataUrl(file));
    };

    const handleCropConfirm = async (file: File) => {
        setUploading(true);
        try {
            const imageBase64 = await readAsDataUrl(file);
            const result = await api.uploadCrmPhoto({
                imageBase64,
                mimeType: file.type,
                fileName: file.name,
            });
            onChange({ url: result.url, storageKey: result.storageKey });
        } catch (err: unknown) {
            // The rest of the form stays usable: a photo that will not upload
            // is not a reason to lose everything else the user has typed.
            toast.error(err instanceof Error ? err.message : labels.uploadFailed);
        } finally {
            setUploading(false);
            setCropSrc(null);
        }
    };

    return (
        <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
                <Avatar src={value.url} name={name} size="lg" />
                {uploading && (
                    <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                    </div>
                )}
            </div>

            <div className="space-y-1.5">
                <span className="block text-sm font-medium text-gray-700">{labels.label}</span>
                <div className="flex items-center gap-2">
                    <input
                        ref={inputRef}
                        data-testid="photo-field-input"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFilePick}
                    />
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={uploading}
                        className="min-h-touch inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-60"
                    >
                        <Camera className="w-4 h-4" />
                        {uploading ? labels.uploading : value.url ? labels.change : labels.add}
                    </button>
                    {value.url && !uploading && (
                        <button
                            type="button"
                            onClick={() => onChange({ url: '', storageKey: '' })}
                            className="min-h-touch rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:text-red-600 hover:bg-red-50"
                        >
                            {labels.remove}
                        </button>
                    )}
                </div>
                <p className="text-xs text-gray-400">{labels.hint}</p>
            </div>

            {cropSrc && (
                <AvatarCropModal
                    imageSrc={cropSrc}
                    open
                    title={labels.cropTitle}
                    confirmLabel={labels.cropConfirm}
                    cancelLabel={cancelLabel}
                    onClose={() => setCropSrc(null)}
                    onConfirm={handleCropConfirm}
                />
            )}
        </div>
    );
}
