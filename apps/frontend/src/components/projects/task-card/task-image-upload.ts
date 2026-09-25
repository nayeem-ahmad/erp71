'use client';

import { useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import type { Attachment } from './model';

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
/** Wide enough for a tile on a desktop grid, small enough not to ship the original. */
export const THUMBNAIL_WIDTH = 320;
/** Matches the server's cap; checked here too so a 5 MB upload is not started. */
export const MAX_BYTES = 5 * 1024 * 1024;

export const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
    });

/** The half of `ACCEPTED_TYPES` a clipboard can produce. */
export const ACCEPTED_IMAGE_TYPES = ACCEPTED_TYPES.filter((type) => type.startsWith('image/'));

/**
 * Keeps an image pasted into the description or a comment, and says where it
 * landed so the editor can link to it.
 *
 * Through the attachment endpoint rather than anywhere new: a pasted screenshot
 * *is* an attachment that happens to be referenced from the text, so it is
 * listed with the rest, held to the same 5 MB cap, and swept up with the task
 * when it goes. The alternative — a second upload path with no row behind it —
 * is how you end up paying Cloudinary for files nothing can find.
 *
 * Reports its own failures: the editor hands back a null and takes the
 * placeholder out of the text, and the reason has to come from whoever knows
 * the limits.
 */
export function useTaskImageUpload(taskId: string) {
    const { t } = useI18n();
    const m = t.projects.attachments;

    return useCallback(
        async (file: File) => {
            // Checked before reading, as in the attachments list: no point
            // turning 20 MB into base64 to be told no.
            if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
                toast.error(m.unsupported);
                return null;
            }
            if (file.size > MAX_BYTES) {
                toast.error(m.tooLarge);
                return null;
            }
            try {
                const created = (await api.addTaskAttachment(taskId, {
                    fileBase64: await readAsDataUrl(file),
                    // A screenshot off the clipboard arrives nameless.
                    fileName: file.name || 'pasted-image',
                    mimeType: file.type,
                })) as Attachment;
                return { url: created.file_url, name: created.file_name };
            } catch (error) {
                toast.error(error instanceof Error ? error.message : m.uploadFailed);
                return null;
            }
        },
        [taskId, m],
    );
}
