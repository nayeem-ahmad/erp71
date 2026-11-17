'use client';

import { useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { directUploader, MAX_DIRECT_UPLOAD_BYTES, withServerFallback } from '@/lib/uploads/direct-upload';
import type { PastedImage } from '@/components/ui/LazyRichTextEditor';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

/**
 * Keeps a picture pasted, dropped or picked into a note, and says where it
 * landed so the editor can leave a markdown image behind.
 *
 * Straight to Cloudinary when it can (`note-image`), through
 * `POST /notes/images` when it cannot. Reports its own failures — the editor
 * just takes the placeholder back out on a null.
 */
export function useNoteImageUpload(): (file: File) => Promise<PastedImage | null> {
    const { t } = useI18n();
    const m = t.notes;
    // One signature for every picture this page uploads.
    const direct = useMemo(() => directUploader('note-image'), []);

    return useCallback(
        async (file: File) => {
            if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
                toast.error(m.imageUnsupported);
                return null;
            }
            if (file.size > MAX_DIRECT_UPLOAD_BYTES) {
                toast.error(m.imageTooLarge);
                return null;
            }
            try {
                const url = await withServerFallback(
                    async () => (await direct(file)).secure_url,
                    async () =>
                        (
                            await api.uploadNoteImage({
                                imageBase64: await readAsDataUrl(file),
                                mimeType: file.type,
                                fileName: file.name || 'image',
                            })
                        ).url,
                );
                return { url, name: file.name.replace(/\.[^.]+$/, '') || 'image' };
            } catch (error) {
                toast.error(error instanceof Error && error.message ? error.message : m.imageUploadFailed);
                return null;
            }
        },
        [direct, m],
    );
}
