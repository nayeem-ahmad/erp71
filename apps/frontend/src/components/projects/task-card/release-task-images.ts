import { api } from '@/lib/api';
import type { Attachment } from './model';
import { imageKey, unreferencedImages } from './task-image-refs';

type CommentRow = { body?: string | null };

/**
 * Deletes image attachments this edit stopped showing, when nothing else on
 * the task still shows them.
 *
 * `description` is the description as it now stands. `extraReferenced` is text
 * the caller just saved that the comment list may not contain yet — the
 * comment body posted a moment ago. A candidate with no id is matched to the
 * attachment row by url.
 *
 * Refuses to delete anything when the comment list cannot be read: a file
 * still shown in a comment must not be removed because the check failed.
 */
export async function releaseUnusedImages(
    taskId: string,
    description: string,
    candidates: { id?: string; url: string }[],
    extraReferenced: string[] = [],
): Promise<number> {
    if (candidates.length === 0) return 0;

    const rows = await api.getTaskComments(taskId);
    const comments: CommentRow[] = Array.isArray(rows) ? rows : [];
    const doomed = unreferencedImages(candidates, [
        description,
        ...extraReferenced,
        ...comments.map((comment) => comment.body ?? ''),
    ]);
    if (doomed.length === 0) return 0;

    let attachments: Attachment[] = [];
    if (doomed.some((item) => !item.id)) {
        const listed = await api.getTaskAttachments(taskId);
        attachments = Array.isArray(listed) ? listed : [];
    }

    let removed = 0;
    for (const item of doomed) {
        const id =
            item.id ??
            attachments.find((attachment) => imageKey(attachment.file_url) === imageKey(item.url))?.id;
        if (!id) continue;
        try {
            await api.deleteTaskAttachment(id);
            removed += 1;
        } catch {
            // Already gone, or it could not be removed. The count stays, so the
            // badge does not claim a file that is still there.
        }
    }
    return removed;
}
