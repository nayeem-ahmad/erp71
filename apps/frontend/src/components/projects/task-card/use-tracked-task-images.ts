'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { PastedImage } from '@/components/ui/RichTextEditor';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { releaseUnusedImages } from './release-task-images';
import { imageKey, imageUrlsIn, type UploadedImage } from './task-image-refs';
import { useTaskFiles } from './task-files';
import { useTaskImageUpload } from './task-image-upload';

/**
 * Images uploaded by one editor, and what happens to them when the edit ends.
 *
 * The upload is an attachment the moment it lands, which is what puts it in
 * the Attachments list while the text still shows it. This remembers the ones
 * this editor added, so an edit that is thrown away — Escape, a failed save,
 * leaving the card — does not leave the file behind, and one that is kept
 * does not delete it.
 *
 * `savedMarkdown` is the text already stored (the description, for a comment
 * box). A file this editor uploaded that the stored text does not show is
 * released when the editor goes away.
 */
export function useTrackedTaskImages(taskId: string, savedMarkdown: string) {
    const { t } = useI18n();
    const upload = useTaskImageUpload(taskId);
    const { bump } = useTaskFiles();
    const session = useRef<UploadedImage[]>([]);
    const savedRef = useRef(savedMarkdown);
    savedRef.current = savedMarkdown;
    // The unmount cleanup must not re-run when `bump` changes identity: that
    // would release a paste that is still in the draft.
    const bumpRef = useRef(bump);
    bumpRef.current = bump;

    const uploadImage = useCallback(
        async (file: File) => {
            const created = await upload(file);
            if (!created?.id) return created;
            session.current.push({ id: created.id, url: created.url });
            bump(1);
            return created;
        },
        [upload, bump],
    );

    /** The image was taken out of the text before its upload finished. */
    const discard = useCallback(
        async (image: PastedImage) => {
            if (!image.id) return;
            session.current = session.current.filter((item) => item.id !== image.id);
            try {
                await api.deleteTaskAttachment(image.id);
                bump(-1);
            } catch (error) {
                toast.error(error instanceof Error ? error.message : t.projects.attachments.removeFailed);
            }
        },
        [bump, t.projects.attachments.removeFailed],
    );

    /**
     * Splits the session on `markdown` and clears it.
     *
     * `shown` are still in that text. `abandoned` were uploaded here and are
     * not. Neither stays tracked: a shown image now belongs to the saved text,
     * and an abandoned one is about to be released.
     */
    const consume = useCallback((markdown: string) => {
        const shownKeys = new Set(imageUrlsIn(markdown).map(imageKey));
        const shown: UploadedImage[] = [];
        const abandoned: UploadedImage[] = [];
        for (const item of session.current) {
            (shownKeys.has(imageKey(item.url)) ? shown : abandoned).push(item);
        }
        session.current = [];
        return { shown, abandoned };
    }, []);

    const restore = useCallback((items: UploadedImage[]) => {
        const seen = new Set(session.current.map((item) => item.id));
        for (const item of items) {
            if (!seen.has(item.id)) session.current.push(item);
        }
    }, []);

    const release = useCallback(
        async (
            description: string,
            candidates: { id?: string; url: string }[],
            extraReferenced: string[] = [],
        ) => {
            try {
                const removed = await releaseUnusedImages(
                    taskId,
                    description,
                    candidates,
                    extraReferenced,
                );
                if (removed) bump(-removed);
                return removed;
            } catch (error) {
                toast.error(error instanceof Error ? error.message : t.projects.attachments.removeFailed);
                return 0;
            }
        },
        [taskId, bump, t.projects.attachments.removeFailed],
    );

    useEffect(() => {
        return () => {
            const pending = session.current.splice(0);
            const saved = savedRef.current;
            const shown = new Set(imageUrlsIn(saved).map(imageKey));
            const abandoned = pending.filter((item) => !shown.has(imageKey(item.url)));
            if (abandoned.length === 0) return;
            void releaseUnusedImages(taskId, saved, abandoned)
                .then((removed) => {
                    if (removed) bumpRef.current(-removed);
                })
                .catch(() => {
                    // The card is going away. The file stays in Attachments,
                    // where it can still be removed.
                });
        };
    }, [taskId]);

    return { uploadImage, discard, consume, restore, release };
}
