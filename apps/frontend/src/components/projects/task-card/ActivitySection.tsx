'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button, RichTextEditor } from '@/components/ui';
import {
    actorName,
    describeActivity,
    mergeFeed,
    type FeedEntry,
} from '@/components/projects/task-activity';
import { formatDateTime } from '@/lib/format';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { Markdown } from './lazy-markdown';
import { useTaskImageUpload } from './task-image-upload';

/**
 * Comments and the change log in one timeline, because "what happened to this
 * task" is one question. Loads independently of the panel: the feed is the
 * heaviest part of the card and the least urgent, and a failure here must not
 * cost you the hours form above it.
 */
export default function ActivitySection({
    taskId,
    onChanged,
    show = 'all',
}: {
    taskId: string;
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
    const { t } = useI18n();
    const m = t.projects.activity;

    const [feed, setFeed] = useState<FeedEntry[]>([]);
    const [watching, setWatching] = useState(false);
    const [me, setMe] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editBody, setEditBody] = useState('');
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const uploadImage = useTaskImageUpload(taskId);

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
            const [comments, activity, watchers, user] = await Promise.all([
                api.getTaskComments(taskId),
                api.getTaskActivity(taskId),
                api.getTaskWatchers(taskId),
                api.getMe(),
            ]);
            const userId = (user as { id?: string } | null)?.id ?? null;
            setMe(userId);
            setFeed(
                mergeFeed(
                    Array.isArray(comments) ? comments : [],
                    Array.isArray(activity) ? activity : [],
                ),
            );
            setWatching(
                Array.isArray(watchers) &&
                    watchers.some((w: { user_id?: string }) => w.user_id === userId),
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
        return run(async () => {
            await api.addTaskComment(taskId, body);
            setDraft('');
        });
    };

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        return post();
    };

    const commitEdit = (comment: FeedEntry & { kind: 'comment' }) => {
        const body = editBody.trim();
        setEditingId(null);
        if (!body || body === comment.body) return;
        return run(() => api.updateTaskComment(comment.id, body));
    };

    return (
        <section className="rounded-md border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{m.title}</h3>
                <Button
                    type="button"
                    variant={watching ? 'secondary' : 'ghost'}
                    className="max-md:min-h-touch"
                    disabled={saving}
                    aria-pressed={watching}
                    onClick={() =>
                        run(() => (watching ? api.unwatchTask(taskId) : api.watchTask(taskId)))
                    }
                >
                    {watching ? (
                        <Eye className="me-1 h-4 w-4" />
                    ) : (
                        <EyeOff className="me-1 h-4 w-4" />
                    )}
                    {watching ? m.watching : m.watch}
                </Button>
            </div>
            <p className="mt-0.5 text-xs text-gray-500">{m.watchHint}</p>

            {/* Nothing to write on an activity log — it records what the
                system saw, not what anyone wants to say about it. */}
            {show !== 'activity' && (
                <form onSubmit={submit} className="mt-2 space-y-2">
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
                        uploadImage={uploadImage}
                    />
                    <Button
                        type="submit"
                        className="max-md:min-h-touch"
                        disabled={saving || draft.trim() === ''}
                    >
                        {m.comment}
                    </Button>
                </form>
            )}

            {failed ? (
                <p className="mt-3 text-sm text-danger">{m.loadFailed}</p>
            ) : shown.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">{m.empty}</p>
            ) : (
                <ul className="mt-3 space-y-2">
                    {shown.map((entry) => (
                        <li key={`${entry.kind}-${entry.id}`} className="text-sm">
                            {entry.kind === 'comment' ? (
                                <div className="rounded-md bg-gray-50 p-2">
                                    <p className="text-xs text-gray-500">
                                        {actorName(entry.user) ?? m.someone} ·{' '}
                                        {formatDateTime(entry.created_at)}
                                    </p>
                                    {editingId === entry.id ? (
                                        <div className="mt-1 space-y-2">
                                            <RichTextEditor
                                                rows={2}
                                                hideHint
                                                autoFocus
                                                value={editBody}
                                                disabled={saving}
                                                ariaLabel={m.editComment}
                                                onChange={setEditBody}
                                                onSubmit={() => commitEdit(entry)}
                                                onCancel={() => setEditingId(null)}
                                                uploadImage={uploadImage}
                                            />
                                            <div className="flex gap-2">
                                                <Button
                                                    type="button"
                                                    className="max-md:min-h-touch"
                                                    disabled={saving}
                                                    onClick={() => commitEdit(entry)}
                                                >
                                                    {t.common.save}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="max-md:min-h-touch"
                                                    onClick={() => setEditingId(null)}
                                                >
                                                    {t.common.cancel}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        /* Markdown, like the description: the
                                           box writes it, and a pasted image is
                                           a markdown image — rendered as the
                                           literal `![…](…)` it would be the one
                                           part of a comment nobody can read. */
                                        <div className="mt-0.5">
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
                                        <div className="mt-1 flex gap-2 text-xs">
                                            <button
                                                type="button"
                                                className="max-md:min-h-touch text-blue-600"
                                                onClick={() => {
                                                    setEditingId(entry.id);
                                                    setEditBody(entry.body);
                                                }}
                                            >
                                                {t.common.edit}
                                            </button>
                                            <button
                                                type="button"
                                                className="max-md:min-h-touch text-red-600"
                                                disabled={saving}
                                                onClick={() =>
                                                    run(() => api.deleteTaskComment(entry.id))
                                                }
                                            >
                                                {t.common.delete}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <p className="text-gray-600">
                                    <span className="text-gray-900">
                                        {actorName(entry.actor) ?? m.someone}
                                    </span>{' '}
                                    {describeActivity(entry, m.types as Record<string, string>)}
                                    <span className="ms-1 text-xs text-gray-400">
                                        {formatDateTime(entry.created_at)}
                                    </span>
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
