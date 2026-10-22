'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { Button } from '@/components/ui';
import { RichTextEditor } from '@/components/ui/LazyRichTextEditor';
import {
    actorName,
    describeActivity,
    mergeFeed,
    type FeedEntry,
} from '@/components/projects/task-activity';
import { formatDateTime } from '@/lib/format';
import { api } from '@/lib/api';
import { fetchMe } from '@/hooks/use-me';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { Markdown } from './lazy-markdown';
import { relativeTime } from './model';
import { imageUrlsIn, urlsDropped } from './task-image-refs';
import { useTrackedTaskImages } from './use-tracked-task-images';

/**
 * When something happened: "2 hours ago", with the exact time on hover. A
 * feed read top to bottom is read in relative time; the timestamp is for the
 * reader who needs it.
 */
function When({ at, locale }: { at: string; locale: string }) {
    return (
        <time dateTime={at} title={formatDateTime(at)}>
            {relativeTime(at, locale)}
        </time>
    );
}

/**
 * A task's comments, or its change log, as one tab of the card's record.
 *
 * Loads independently of the card: the feed is the heaviest part of it and the
 * least urgent, and a failure here must not cost the hours form. It draws no
 * box or heading of its own — the tab it sits in already names it, and the box
 * it used to draw inside the tab panel was a box in a box, headed "Activity"
 * even on the Comments tab. Watching moved to the card's header with it: it is
 * the task that is watched, not its comments.
 */
export default function ActivitySection({
    taskId,
    description = '',
    onChanged,
    show = 'all',
}: {
    taskId: string;
    /** The saved description, so an image it still shows is not removed with a comment. */
    description?: string;
    onChanged?: () => void;
    /**
     * Which half of the feed to draw. Comments and the activity log answer
     * different questions — "what did someone say" and "what happened to this
     * task" — and interleaving them buried a two-line reply between six status
     * moves. They are two tabs now, but one fetch: `load()` already pulls both
     * and `mergeFeed` already tags each entry with its `kind`, so the split is
     * a filter rather than a second request.
     *
     * The comment box belongs to `comments` only; there is nothing to write on
     * an activity log.
     */
    show?: 'all' | 'comments' | 'activity';
}) {
    const { t, localeInfo } = useI18n();
    const m = t.projects.activity;
    const locale = localeInfo.dateLocale;

    const [feed, setFeed] = useState<FeedEntry[]>([]);
    const [me, setMe] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editBody, setEditBody] = useState('');
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    // Separate sessions: posting the draft must not release an image that is
    // still sitting, unsent, in a comment being edited, or the other way round.
    const draftImages = useTrackedTaskImages(taskId, description);
    const editImages = useTrackedTaskImages(taskId, description);

    /* One fetch, two tabs: `mergeFeed` already tags every entry with its kind,
       so each tab is a filter over the same feed rather than a second request.

       The two vocabularies do not match and must be mapped rather than
       compared: the tab is `comments` (it holds many) while the entry kind is
       `comment` (it is one). Comparing them directly type-checks — both are
       string-literal unions, they simply never overlap on that member — and
       silently empties the tab. */
    const wantedKind = show === 'comments' ? 'comment' : 'activity';
    const shown = show === 'all' ? feed : feed.filter((entry) => entry.kind === wantedKind);

    const load = useCallback(async () => {
        try {
            // The watcher list is no longer read here: whether the viewer
            // watches the task comes with the task itself now.
            const [comments, activity, user] = await Promise.all([
                api.getTaskComments(taskId),
                api.getTaskActivity(taskId),
                fetchMe(),
            ]);
            setMe((user as { id?: string } | null)?.id ?? null);
            setFeed(
                mergeFeed(
                    Array.isArray(comments) ? comments : [],
                    Array.isArray(activity) ? activity : [],
                ),
            );
            setFailed(false);
        } catch {
            // An empty timeline and a broken one look identical otherwise —
            // the trap logged against useServerList, in miniature.
            setFailed(true);
        }
    }, [taskId]);

    useEffect(() => {
        load();
    }, [load]);

    const run = async (action: () => Promise<unknown>) => {
        setSaving(true);
        try {
            await action();
            await load();
            onChanged?.();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    /* Split from `submit` so Ctrl/⌘+Enter inside the editor and the Comment
       button post the same way — the editor has no form event to hand over. */
    const post = () => {
        const body = draft.trim();
        if (!body) return;
        const { shown, abandoned } = draftImages.consume(body);
        return run(async () => {
            try {
                await api.addTaskComment(taskId, body);
            } catch (error) {
                draftImages.restore([...shown, ...abandoned]);
                throw error;
            }
            // The body is passed in because the comment list this reads may
            // still be the one from before the post. An image the draft no
            // longer shows is removed unless the description or another
            // comment still shows it.
            await draftImages.release(description, abandoned, [body]);
            setDraft('');
        });
    };

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        return post();
    };

    const commitEdit = (comment: FeedEntry & { kind: 'comment' }) => {
        const body = editBody.trim();
        const previous = comment.body;
        setEditingId(null);
        const { shown, abandoned } = editImages.consume(body);
        if (!body || body === previous) {
            // Nothing was saved, so a paste that did not stay in the text
            // must not stay in Attachments either.
            void editImages.release(description, abandoned);
            return;
        }
        return run(async () => {
            try {
                await api.updateTaskComment(comment.id, body);
            } catch (error) {
                editImages.restore([...shown, ...abandoned]);
                throw error;
            }
            await editImages.release(
                description,
                [...abandoned, ...urlsDropped(previous, body).map((url) => ({ url }))],
                [body],
            );
        });
    };

    return (
        <div>
            {/* Nothing to write on an activity log — it records what the
                system saw, not what anyone wants to say about it. */}
            {show !== 'activity' && (
                <form onSubmit={submit} className="space-y-2">
                    {/* The same editor the description uses, for the same
                        reason: a screenshot is half of what anyone wants to say
                        about a bug, and describing one in words is the long way
                        round. `hideHint` because the formatting line is three
                        times the height of the box it would sit under. */}
                    <RichTextEditor
                        rows={2}
                        hideHint
                        value={draft}
                        disabled={saving}
                        ariaLabel={m.commentPlaceholder}
                        placeholder={m.commentPlaceholder}
                        onChange={setDraft}
                        onSubmit={post}
                        uploadImage={draftImages.uploadImage}
                        onImageDiscarded={draftImages.discard}
                    />
                    <div className="flex justify-end">
                        <Button type="submit" disabled={saving || draft.trim() === ''}>
                            {m.comment}
                        </Button>
                    </div>
                </form>
            )}

            {failed ? (
                <p className="mt-3 text-sm text-danger">{m.loadFailed}</p>
            ) : shown.length === 0 ? (
                <div className="mt-4 flex flex-col items-center gap-1 py-4 text-center">
                    <MessageSquare className="h-6 w-6 text-gray-300" aria-hidden />
                    <p className="text-sm text-gray-500">{m.empty}</p>
                </div>
            ) : show === 'activity' ? (
                /* The log as a thin timeline: who, what, when, one line each.
                   A status move is not worth a card of its own. */
                <ol className="mt-1 space-y-2.5 border-s border-gray-200 ps-4">
                    {shown.map((entry) => (
                        <li key={`${entry.kind}-${entry.id}`} className="relative text-sm">
                            <span
                                aria-hidden
                                className="absolute -start-[1.3125rem] top-1.5 h-2 w-2 rounded-full border-2 border-white bg-gray-300"
                            />
                            <span className="font-medium text-gray-900">
                                {actorName(entry.kind === 'activity' ? entry.actor : entry.user) ?? m.someone}
                            </span>{' '}
                            <span className="text-gray-600">
                                {entry.kind === 'activity'
                                    ? describeActivity(entry, m.types as Record<string, string>)
                                    : entry.body}
                            </span>
                            <span className="ms-1.5 text-xs text-gray-400">
                                <When at={entry.created_at} locale={locale} />
                            </span>
                        </li>
                    ))}
                </ol>
            ) : (
                <ul className="mt-4 space-y-4">
                    {shown.map((entry) =>
                        entry.kind === 'comment' ? (
                            <li key={`${entry.kind}-${entry.id}`} className="flex gap-2.5 text-sm">
                                <Avatar name={actorName(entry.user) ?? m.someone} size="md" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs text-gray-500">
                                        <span className="font-semibold text-gray-900">
                                            {actorName(entry.user) ?? m.someone}
                                        </span>{' '}
                                        · <When at={entry.created_at} locale={locale} />
                                    </p>
                                    {editingId === entry.id ? (
                                        /* The tick and cross the description
                                           has, in place of a Save and Cancel
                                           pair of its own: one editor, one
                                           way out of it. */
                                        <div className="mt-1">
                                            <RichTextEditor
                                                rows={2}
                                                hideHint
                                                autoFocus
                                                value={editBody}
                                                disabled={saving}
                                                ariaLabel={m.editComment}
                                                onChange={setEditBody}
                                                onSubmit={() => commitEdit(entry)}
                                                onCancel={() => {
                                                    const { abandoned } = editImages.consume(entry.body);
                                                    setEditingId(null);
                                                    void editImages.release(description, abandoned);
                                                }}
                                                showActions
                                                uploadImage={editImages.uploadImage}
                                                onImageDiscarded={editImages.discard}
                                            />
                                        </div>
                                    ) : (
                                        /* Markdown, like the description: the
                                           box writes it, and a pasted image is
                                           a markdown image — rendered as the
                                           literal `![…](…)` it would be the one
                                           part of a comment nobody can read. */
                                        <div className="mt-0.5 leading-relaxed text-gray-700">
                                            <Suspense
                                                fallback={
                                                    <p className="whitespace-pre-wrap">{entry.body}</p>
                                                }
                                            >
                                                <Markdown content={entry.body} allowImages />
                                            </Suspense>
                                        </div>
                                    )}

                                    {/* Only your own — an audit trail nobody
                                        else can rewrite. */}
                                    {me && entry.user?.id === me && editingId !== entry.id && (
                                        <div className="mt-1 flex gap-3 text-xs">
                                            <button
                                                type="button"
                                                className="max-md:min-h-touch text-blue-600 hover:underline"
                                                onClick={() => {
                                                    setEditingId(entry.id);
                                                    setEditBody(entry.body);
                                                }}
                                            >
                                                {t.common.edit}
                                            </button>
                                            <button
                                                type="button"
                                                className="max-md:min-h-touch text-red-600 hover:underline"
                                                disabled={saving}
                                                onClick={() =>
                                                    run(async () => {
                                                        await api.deleteTaskComment(entry.id);
                                                        // The comment is gone, so an image only it
                                                        // showed goes with it. One the description
                                                        // still shows stays.
                                                        const removed = imageUrlsIn(entry.body).map((url) => ({ url }));
                                                        await editImages.release(description, removed);
                                                    })
                                                }
                                            >
                                                {t.common.delete}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </li>
                        ) : (
                            <li key={`${entry.kind}-${entry.id}`} className="text-sm text-gray-600">
                                <span className="text-gray-900">{actorName(entry.actor) ?? m.someone}</span>{' '}
                                {describeActivity(entry, m.types as Record<string, string>)}
                                <span className="ms-1 text-xs text-gray-400">
                                    <When at={entry.created_at} locale={locale} />
                                </span>
                            </li>
                        ),
                    )}
                </ul>
            )}
        </div>
    );
}
