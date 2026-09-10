'use client';

import { useRef, useState } from 'react';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import ImageCropModal, { type CropRatioOption } from '@/components/ImageCropModal';
import Button from '@/components/ui/compact/Button';
import { api } from '@/lib/api';

/** Matches the hint text and the backend's own base64 ceiling. */
export const MAX_STOREFRONT_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Longest edge of what is actually uploaded. The 5 MB check above is on the
 * file the shop owner picked; these bound what the crop re-encodes to, which
 * is what has to fit the API's 5 MB JSON body once base64 has inflated it —
 * and what every shopper then downloads. 2400px covers a full-bleed hero on a
 * retina desktop; a logo is never rendered above ~200px.
 */
const HERO_MAX_EDGE = 2400;
const LOGO_MAX_EDGE = 800;

export type StorefrontImageKind = 'hero' | 'logo';

export type StorefrontImageFieldLabels = {
    /** Field heading, e.g. "Hero Image". */
    label: string;
    hint: string;
    optional: string;
    cropTitle: string;
    upload: string;
    replace: string;
    remove: string;
    uploading: string;
    uploadFailed: string;
    tooLarge: string;
    notAnImage: string;
    fileHint: string;
    urlLabel: string;
    urlPlaceholder: string;
    cancel: string;
    cropConfirm: string;
    zoom: string;
    ratioOriginal: string;
    ratioSquare: string;
    ratioWide: string;
};

type StorefrontImageFieldProps = {
    kind: StorefrontImageKind;
    /** The stored URL, '' when there is none. */
    value: string;
    onChange: (url: string) => void;
    /** Prefix for the file input and URL input ids. */
    inputId: string;
    labels: StorefrontImageFieldLabels;
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
 * Pick, crop and upload one storefront image, or paste a URL for one hosted
 * elsewhere.
 *
 * The upload runs on crop-confirm rather than on form submit: the field has to
 * show what was actually cropped before the shop owner commits to it, and the
 * settings form saves several fields at once, so deferring would mean holding a
 * blob in memory for the whole edit. What the form eventually PATCHes is just
 * the URL, which is also why the paste-a-URL input survives — hero images set
 * that way before uploads existed must stay editable.
 */
export default function StorefrontImageField({
    kind,
    value,
    onChange,
    inputId,
    labels,
}: Readonly<StorefrontImageFieldProps>) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // A hero fills a wide band behind the headline, so it is cropped to one
    // shape and no other. A logo may be a square badge or a long wordmark, and
    // forcing either into the other's frame ruins it — hence the choice, with
    // "as it is" first because that is what most uploaded logos want.
    const ratioOptions: CropRatioOption[] | undefined =
        kind === 'logo'
            ? [
                  { key: 'original', label: labels.ratioOriginal, ratio: null },
                  { key: 'square', label: labels.ratioSquare, ratio: 1 },
                  { key: 'wide', label: labels.ratioWide, ratio: 3 },
              ]
            : undefined;

    const handleFilePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // Reset immediately so picking the same file twice in a row still fires.
        event.target.value = '';
        if (!file) return;

        setError(null);
        if (!file.type.startsWith('image/')) {
            setError(labels.notAnImage);
            return;
        }
        if (file.size > MAX_STOREFRONT_IMAGE_BYTES) {
            setError(labels.tooLarge);
            return;
        }

        setCropSrc(await readAsDataUrl(file));
    };

    const handleCropConfirm = async (file: File) => {
        setUploading(true);
        try {
            const imageBase64 = await readAsDataUrl(file);
            const result = await api.uploadStorefrontImage({
                imageBase64,
                mimeType: file.type,
                fileName: file.name,
                kind,
            });
            onChange(result.url);
            setError(null);
        } catch (err: unknown) {
            // Inline, not a toast: the rest of the form stays usable, and an
            // upload that failed belongs next to the field that failed it.
            setError(err instanceof Error ? err.message : labels.uploadFailed);
        } finally {
            setUploading(false);
            setCropSrc(null);
        }
    };

    const previewClass =
        kind === 'hero'
            ? 'aspect-video w-full max-w-md object-cover'
            : 'h-20 w-auto max-w-[200px] object-contain';

    return (
        <div>
            <span className="block text-sm font-semibold text-gray-700 mb-1.5">{labels.label}</span>

            <div className="flex flex-wrap items-start gap-3">
                <div
                    className={`relative flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 ${
                        kind === 'hero' ? 'w-full max-w-md' : 'min-h-20 px-3'
                    }`}
                >
                    {value ? (
                        <img src={value} alt="" className={`rounded-lg ${previewClass}`} />
                    ) : (
                        <span
                            className={`flex items-center justify-center text-gray-300 ${
                                kind === 'hero' ? 'aspect-video w-full' : 'h-20 w-20'
                            }`}
                        >
                            <ImageUp className="w-7 h-7" aria-hidden="true" />
                        </span>
                    )}
                    {uploading && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                            <Loader2 className="w-5 h-5 animate-spin text-white" />
                        </div>
                    )}
                </div>

                <div className="space-y-1.5">
                    <input
                        ref={fileRef}
                        data-testid={`${inputId}-file`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handleFilePick}
                    />
                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            size="md"
                            icon={<ImageUp className="w-4 h-4" />}
                            onClick={() => fileRef.current?.click()}
                            disabled={uploading}
                        >
                            {uploading ? labels.uploading : value ? labels.replace : labels.upload}
                        </Button>
                        {value && !uploading && (
                            <Button
                                variant="ghost"
                                size="md"
                                icon={<Trash2 className="w-4 h-4" />}
                                onClick={() => {
                                    onChange('');
                                    setError(null);
                                }}
                                className="hover:text-red-600"
                            >
                                {labels.remove}
                            </Button>
                        )}
                    </div>
                    <p className="text-xs text-gray-400">{labels.fileHint}</p>
                </div>
            </div>

            <label htmlFor={`${inputId}-url`} className="mt-3 block text-xs font-medium text-gray-500">
                {labels.urlLabel}
            </label>
            <input
                id={`${inputId}-url`}
                type="url"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={labels.urlPlaceholder}
                className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <p className="text-xs text-gray-400 mt-1">{labels.hint}</p>
            <p className="text-xs text-gray-400 mt-1">{labels.optional}</p>

            {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

            {cropSrc && (
                <ImageCropModal
                    imageSrc={cropSrc}
                    title={labels.cropTitle}
                    aspect={16 / 9}
                    ratioOptions={ratioOptions}
                    confirmLabel={labels.cropConfirm}
                    cancelLabel={labels.cancel}
                    zoomLabel={labels.zoom}
                    fileName={`${kind}.jpg`}
                    maxOutputEdge={kind === 'hero' ? HERO_MAX_EDGE : LOGO_MAX_EDGE}
                    onClose={() => setCropSrc(null)}
                    onConfirm={handleCropConfirm}
                />
            )}
        </div>
    );
}
