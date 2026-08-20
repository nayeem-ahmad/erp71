'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Send } from 'lucide-react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMessage, useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import {
    BUFFER_MODES,
    formatDateTime,
    type BufferChannel,
    type BufferMode,
    type SocialPost,
} from './social-post';

type Props = {
    post: SocialPost;
    defaultChannelId: string | null;
    onClose: () => void;
    onPushed: (post: SocialPost) => void;
};

function toLocalInput(iso: string | null): string {
    if (!iso) return '';
    const date = new Date(iso);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function PushToBufferModal({ post, defaultChannelId, onClose, onPushed }: Props) {
    const { t } = useI18n();
    const m = t.admin.socialMedia;
    const p = m.push;

    const [channels, setChannels] = useState<BufferChannel[]>([]);
    const [loadingChannels, setLoadingChannels] = useState(true);
    const [channelsError, setChannelsError] = useState('');
    const [selected, setSelected] = useState<string[]>(defaultChannelId ? [defaultChannelId] : []);
    const [mode, setMode] = useState<BufferMode>(post.scheduled_for ? 'customScheduled' : 'addToQueue');
    const [dueAt, setDueAt] = useState(toLocalInput(post.scheduled_for));
    const [error, setError] = useState('');
    const [pushing, setPushing] = useState(false);

    useEffect(() => {
        api.getBufferChannels()
            .then((rows: BufferChannel[]) => setChannels(rows ?? []))
            .catch((err) => setChannelsError((err as Error).message || p.channelsFailed))
            .finally(() => setLoadingChannels(false));
    }, []);

    function toggle(channelId: string) {
        setSelected((current) =>
            current.includes(channelId)
                ? current.filter((id) => id !== channelId)
                : [...current, channelId],
        );
    }

    async function handlePush() {
        if (selected.length === 0) {
            setError(p.selectChannel);
            return;
        }
        if (mode === 'customScheduled' && !dueAt) {
            setError(p.dueAtRequired);
            return;
        }
        setError('');
        setPushing(true);
        try {
            const result = await api.pushAdminSocialPost(post.id, {
                channel_ids: selected,
                mode,
                due_at: mode === 'customScheduled' && dueAt ? new Date(dueAt).toISOString() : null,
            });
            // A push can half-succeed, so the toast reports counts rather than a
            // flat "done" — the per-channel errors are in the history below.
            if (result.failed === 0) {
                toast.success(formatMessage(p.success, { count: result.sent }));
            } else if (result.sent > 0) {
                toast.error(formatMessage(p.partial, { sent: result.sent, failed: result.failed }));
            } else {
                toast.error(p.failed);
            }
            onPushed(result.post);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setPushing(false);
        }
    }

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader title={p.title} subtitle={p.subtitle} onClose={onClose} />

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="whitespace-pre-wrap text-sm text-gray-700">{post.content}</p>
                    {post.link_url && (
                        <p className="mt-2 break-all text-xs text-blue-600">{post.link_url}</p>
                    )}
                </div>

                <div>
                    <span className="text-xs font-medium text-gray-600">{p.channels}</span>
                    <div className="mt-1 space-y-2">
                        {loadingChannels ? (
                            <p className="text-xs text-gray-500">{p.channelsLoading}</p>
                        ) : channelsError ? (
                            <p className="text-xs text-danger">{channelsError}</p>
                        ) : channels.length === 0 ? (
                            <p className="text-xs text-gray-500">{p.channelsEmpty}</p>
                        ) : (
                            channels.map((channel) => (
                                <label
                                    key={channel.id}
                                    className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700"
                                >
                                    <Checkbox
                                        checked={selected.includes(channel.id)}
                                        onChange={() => toggle(channel.id)}
                                    />
                                    <span className="font-medium">{channel.name ?? channel.id}</span>
                                    {channel.service && (
                                        <span className="text-xs text-gray-400">{channel.service}</span>
                                    )}
                                    {channel.isQueuePaused && (
                                        <span className="ms-auto text-xs text-amber-600">paused</span>
                                    )}
                                </label>
                            ))
                        )}
                    </div>
                </div>

                <Field label={p.mode}>
                    <Select value={mode} onChange={(event) => setMode(event.target.value as BufferMode)}>
                        {BUFFER_MODES.map((value) => (
                            <option key={value} value={value}>
                                {p.modes[value]}
                            </option>
                        ))}
                    </Select>
                </Field>

                {mode === 'customScheduled' && (
                    <Field label={p.dueAt} required>
                        <Input
                            type="datetime-local"
                            value={dueAt}
                            onChange={(event) => setDueAt(event.target.value)}
                        />
                    </Field>
                )}

                {error && (
                    <p role="alert" className="text-xs text-danger">
                        {error}
                    </p>
                )}

                <div>
                    <span className="text-xs font-medium text-gray-600">{p.history}</span>
                    {post.pushes.length === 0 ? (
                        <p className="mt-1 text-xs text-gray-500">{p.historyEmpty}</p>
                    ) : (
                        <ul className="mt-1 space-y-2">
                            {post.pushes.map((push) => {
                                const channelLabel =
                                    push.channel_name ??
                                    formatMessage(p.unknownChannel, { id: push.channel_id });
                                const sent = push.status === 'SENT';
                                return (
                                    <li
                                        key={push.id}
                                        className="flex items-start gap-2 rounded-md border border-gray-100 px-3 py-2 text-xs"
                                    >
                                        {sent ? (
                                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                                        ) : (
                                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-danger" />
                                        )}
                                        <div className="min-w-0">
                                            <p className="font-medium text-gray-700">
                                                {formatMessage(sent ? p.sentTo : p.failedFor, {
                                                    channel: channelLabel,
                                                })}
                                            </p>
                                            <p className="text-gray-400">
                                                {formatDateTime(push.created_at)}
                                                {push.due_at ? ` · ${formatDateTime(push.due_at)}` : ''}
                                            </p>
                                            {push.error && <p className="mt-0.5 text-danger">{push.error}</p>}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>

            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {m.editor.cancel}
                </Button>
                <Button
                    onClick={handlePush}
                    loading={pushing}
                    disabled={loadingChannels || channels.length === 0}
                    icon={<Send className="h-4 w-4" />}
                >
                    {pushing ? p.pushing : p.submit}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
