import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';

/**
 * The absolute URL of a task's own page — the one link that opens the card for
 * anyone signed in to the workspace, whether it is pasted into a chat or kept
 * in a bookmark. Absolute because a bare path pasted outside the app goes
 * nowhere.
 */
export function taskUrl(taskId: string, origin: string = window.location.origin): string {
    return `${origin}${routes.projects.taskDetail(taskId)}`;
}

/**
 * Puts a task's link on the clipboard and says so. `navigator.clipboard` is
 * undefined in an insecure context and can be refused outright, so a failure
 * is surfaced rather than leaving the user believing they hold a link they
 * don't.
 */
export async function copyTaskLink(
    taskId: string,
    messages: { linkCopied: string; copyLinkFailed: string },
): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(taskUrl(taskId));
    } catch {
        toast.error(messages.copyLinkFailed);
        return false;
    }
    toast.success(messages.linkCopied);
    return true;
}
