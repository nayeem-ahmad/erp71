'use client';

import { useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Checkbox, Field, Input, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { SOCIAL_NETWORKS, type SocialPost } from './social-post';

type Props = {
    post: SocialPost | null;
    onClose: () => void;
    onSaved: (post: SocialPost) => void;
};

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time, not an ISO string. */
function toLocalInput(iso: string | null): string {
    if (!iso) return '';
    const date = new Date(iso);
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function SocialPostFormModal({ post, onClose, onSaved }: Props) {
    const { t } = useI18n();
    const m = t.admin.socialMedia;
    const e = m.editor;

    const [title, setTitle] = useState(post?.title ?? '');
    const [content, setContent] = useState(post?.content ?? '');
    const [linkUrl, setLinkUrl] = useState(post?.link_url ?? '');
    const [imageUrl, setImageUrl] = useState(post?.image_url ?? '');
    const [networks, setNetworks] = useState<string[]>(post?.networks ?? ['facebook']);
    const [scheduledFor, setScheduledFor] = useState(toLocalInput(post?.scheduled_for ?? null));
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    function toggleNetwork(network: string) {
        setNetworks((current) =>
            current.includes(network) ? current.filter((n) => n !== network) : [...current, network],
        );
    }

    async function handleSave() {
        if (!content.trim()) {
            setError(e.contentRequired);
            return;
        }
        setError('');
        setSaving(true);
        try {
            const payload = {
                title: title.trim() || undefined,
                content: content.trim(),
                link_url: linkUrl.trim() || null,
                image_url: imageUrl.trim() || null,
                networks,
                scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
            };
            const saved = post
                ? await api.updateAdminSocialPost(post.id, payload)
                : await api.createAdminSocialPost(payload);
            toast.success(e.saved);
            onSaved(saved);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader title={post ? e.editTitle : e.newTitle} onClose={onClose} />

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <Field label={e.label} hint={e.labelHint}>
                    <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
                </Field>

                <Field
                    label={e.content}
                    required
                    error={error || undefined}
                    hint={`${e.contentHint} · ${e.charCount.replace('{count}', String(content.length))}`}
                >
                    <Textarea
                        value={content}
                        onChange={(event) => setContent(event.target.value)}
                        rows={6}
                        maxLength={5000}
                    />
                </Field>

                <Field label={e.link} hint={e.linkHint}>
                    <Input
                        value={linkUrl}
                        onChange={(event) => setLinkUrl(event.target.value)}
                        placeholder="https://erp71.com/blog/…"
                    />
                </Field>

                <Field label={e.image} hint={e.imageHint}>
                    <Input
                        value={imageUrl}
                        onChange={(event) => setImageUrl(event.target.value)}
                        placeholder="https://…/cover.png"
                    />
                </Field>

                <div>
                    <span className="text-xs font-medium text-gray-600">{e.networksLabel}</span>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                        {SOCIAL_NETWORKS.map((network) => (
                            <label key={network} className="flex items-center gap-2 text-sm text-gray-700">
                                <Checkbox
                                    checked={networks.includes(network)}
                                    onChange={() => toggleNetwork(network)}
                                />
                                {m.networkNames[network]}
                            </label>
                        ))}
                    </div>
                </div>

                <Field label={e.schedule} hint={e.scheduleHint}>
                    <Input
                        type="datetime-local"
                        value={scheduledFor}
                        onChange={(event) => setScheduledFor(event.target.value)}
                    />
                </Field>
            </div>

            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {e.cancel}
                </Button>
                <Button onClick={handleSave} loading={saving}>
                    {e.save}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
