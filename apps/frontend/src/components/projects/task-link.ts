import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';

/** What a task link is built from: its id always, its key (`ERP-14`) once the task has loaded. */
export interface TaskLinkTarget {
    id: string;
    key?: string | null;
}

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
 * The short form: `https://app.erp71.com/t/ERP-14` instead of a 36-character
 * UUID. Short enough to read out or type, and it keeps working after the
 * project's code is changed — `/t/` resolves a retired code to the task too.
 */
export function shortTaskUrl(key: string, origin: string = window.location.origin): string {
    return `${origin}${routes.projects.taskShort(key)}`;
}

/** The link to hand out: the short one when the task has a key, the id-based one otherwise. */
export function taskShareUrl(task: TaskLinkTarget, origin: string = window.location.origin): string {
    return task.key ? shortTaskUrl(task.key, origin) : taskUrl(task.id, origin);
}

/** `https://app.erp71.com/t/ERP-14` → `app.erp71.com/t/ERP-14`, for a toast. */
const withoutScheme = (url: string) => url.replace(/^[a-z]+:\/\//i, '');

/**
 * Puts a task's link on the clipboard and says so, naming the link in the
 * toast so the person can see what they are about to paste. `navigator.clipboard`
 * is undefined in an insecure context and can be refused outright, so a failure
 * is surfaced — still with the link, which can then be typed — rather than
 * leaving the user believing they hold a link they don't.
 */
export async function copyTaskLink(
    task: TaskLinkTarget,
    messages: { linkCopied: string; copyLinkFailed: string },
): Promise<boolean> {
    const url = taskShareUrl(task);
    try {
        await navigator.clipboard.writeText(url);
    } catch {
        toast.error(`${messages.copyLinkFailed} · ${withoutScheme(url)}`);
        return false;
    }
    toast.success(`${messages.linkCopied} · ${withoutScheme(url)}`);
    return true;
}
