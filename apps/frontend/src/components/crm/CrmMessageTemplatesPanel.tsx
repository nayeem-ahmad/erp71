'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Plus, Pencil, Trash2, EyeOff, Eye } from 'lucide-react';
import { Button, Input, Field, Select, StatusBadge, Textarea } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { useLeadTaxonomy } from '@/lib/use-lead-taxonomy';
import {
    TEMPLATE_TOKENS,
    type CrmMessageTemplate,
    type TemplateUsage,
} from '@/lib/crm-message-templates';

type EditorState = {
    id?: string;
    name: string;
    usage: TemplateUsage;
    channel_id: string;
    purpose_id: string;
    subject: string;
    body: string;
};

const USAGES: TemplateUsage[] = ['BOTH', 'LOG', 'SCHEDULE'];

const MAX_NAME = 60;
const MAX_SUBJECT = 300;
const MAX_BODY = 5000;

const emptyEditor: EditorState = {
    name: '',
    usage: 'BOTH',
    channel_id: '',
    purpose_id: '',
    subject: '',
    body: '',
};

/**
 * The tenant's canned messages, as a tab body inside CRM Setup.
 *
 * Unlike the lookup lists next door this is not a name-only row: a template
 * carries the words themselves, so the editor is a proper form rather than a
 * one-field dialog. Deleting is a hard delete because nothing points back at a
 * template once its text has been copied into an activity — a tenant who wants
 * the wording kept has Hide instead.
 */
export default function CrmMessageTemplatesPanel({ canManage }: Readonly<{ canManage: boolean }>) {
    const { t } = useI18n();
    const m = t.crm.messageTemplates;

    const { options: channels } = useLeadTaxonomy('channels');
    const { options: purposes } = useLeadTaxonomy('purposes');

    const [rows, setRows] = useState<CrmMessageTemplate[]>([]);
    const [loading, setLoading] = useState(true);

    const [editor, setEditor] = useState<EditorState | null>(null);
    const [nameError, setNameError] = useState<string | null>(null);
    const [bodyError, setBodyError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [deleting, setDeleting] = useState<CrmMessageTemplate | null>(null);
    const [removing, setRemoving] = useState(false);

    // `Field` only associates its label when it is given the control's id, and
    // an unlabelled <select> in a form of six is unusable with a screen reader.
    const nameId = useId();
    const usageId = useId();
    const channelId = useId();
    const purposeId = useId();
    const subjectId = useId();
    const bodyId = useId();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const list = await api.getCrmMessageTemplates({ includeInactive: true });
            setRows(Array.isArray(list) ? list : []);
        } catch {
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const openCreate = () => {
        setNameError(null);
        setBodyError(null);
        setEditor(emptyEditor);
    };

    const openEdit = (row: CrmMessageTemplate) => {
        setNameError(null);
        setBodyError(null);
        setEditor({
            id: row.id,
            name: row.name,
            usage: row.usage,
            channel_id: row.channel?.id ?? '',
            purpose_id: row.purpose?.id ?? '',
            subject: row.subject ?? '',
            body: row.body,
        });
    };

    const save = async () => {
        if (!editor) return;
        const name = editor.name.trim();
        const body = editor.body.trim();
        if (!name) {
            setNameError(m.validation.nameRequired);
            return;
        }
        if (!body) {
            setBodyError(m.validation.bodyRequired);
            return;
        }

        setSaving(true);
        try {
            const payload = {
                name,
                body,
                subject: editor.subject.trim(),
                usage: editor.usage,
                // Null, not omitted: "any channel" has to clear a link that was
                // set before, and an omitted key would leave the old one standing.
                channel_id: editor.channel_id || null,
                purpose_id: editor.purpose_id || null,
            };
            if (editor.id) {
                await api.updateCrmMessageTemplate(editor.id, payload);
            } else {
                await api.createCrmMessageTemplate(payload);
            }
            setEditor(null);
            toast.success(m.saved);
            await load();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : m.saveFailed;
            // A duplicate name is the one failure the user can fix in the field
            // they are looking at, so it belongs inline rather than in a toast.
            if (/already exists/i.test(message)) setNameError(message);
            else toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (row: CrmMessageTemplate) => {
        try {
            await api.updateCrmMessageTemplate(row.id, { is_active: !row.is_active });
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.saveFailed);
        }
    };

    const confirmDelete = async () => {
        if (!deleting) return;
        setRemoving(true);
        try {
            await api.deleteCrmMessageTemplate(deleting.id);
            setDeleting(null);
            toast.success(m.delete.done);
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.delete.failed);
        } finally {
            setRemoving(false);
        }
    };

    return (
        <div className="space-y-3">
            <p className="text-xs text-gray-400">
                {m.tokenHint.replace('{tokens}', TEMPLATE_TOKENS.map((k) => `{{${k}}}`).join(' '))}
            </p>

            {canManage && (
                <div className="flex justify-end">
                    <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />}>
                        {m.addTemplate}
                    </Button>
                </div>
            )}

            {loading ? (
                <p className="text-sm text-gray-500">{m.loading}</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-gray-400">{m.empty}</p>
            ) : (
                <div className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm">
                    <ul className="divide-y divide-gray-50">
                        {rows.map((row) => (
                            <li key={row.id} className="flex items-start justify-between gap-3 px-3 py-2">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="truncate text-sm font-medium text-gray-800">
                                            {row.name}
                                        </span>
                                        <StatusBadge tone="info">{m.usage[row.usage]}</StatusBadge>
                                        {row.channel && (
                                            <StatusBadge tone="neutral">
                                                {row.channel.icon ? `${row.channel.icon} ` : ''}
                                                {row.channel.name}
                                            </StatusBadge>
                                        )}
                                        {row.purpose && (
                                            <StatusBadge tone="neutral">
                                                {row.purpose.icon ? `${row.purpose.icon} ` : ''}
                                                {row.purpose.name}
                                            </StatusBadge>
                                        )}
                                        {!row.is_active && (
                                            <StatusBadge tone="neutral">{m.inactive}</StatusBadge>
                                        )}
                                    </div>
                                    {/* Whole body, wrapped: a template is judged by its wording,
                                        and a truncated one cannot be. */}
                                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-gray-500">
                                        {row.body}
                                    </p>
                                </div>
                                {canManage && (
                                    <div className="flex shrink-0 items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => openEdit(row)}
                                            aria-label={m.edit}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => toggleActive(row)}
                                            aria-label={row.is_active ? m.deactivate : m.activate}
                                        >
                                            {row.is_active
                                                ? <EyeOff className="h-4 w-4" />
                                                : <Eye className="h-4 w-4" />}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setDeleting(row)}
                                            aria-label={m.delete.action}
                                            className="text-danger"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {editor && (
                <ModalShell onBackdropClick={() => setEditor(null)}>
                    <ModalHeader
                        title={editor.id ? m.editTitle : m.addTemplate}
                        onClose={() => setEditor(null)}
                    />
                    <div className="space-y-3 overflow-y-auto p-4">
                        <Field label={m.fields.name} required error={nameError ?? undefined} htmlFor={nameId}>
                            <Input
                                id={nameId}
                                value={editor.name}
                                onChange={(e) => { setEditor({ ...editor, name: e.target.value }); setNameError(null); }}
                                maxLength={MAX_NAME}
                                error={Boolean(nameError)}
                                placeholder={m.fields.namePlaceholder}
                                autoFocus
                            />
                        </Field>
                        <Field label={m.fields.usage} hint={m.fields.usageHint} htmlFor={usageId}>
                            <Select
                                id={usageId}
                                value={editor.usage}
                                onChange={(e) =>
                                    setEditor({ ...editor, usage: e.target.value as TemplateUsage })}
                            >
                                {USAGES.map((u) => (
                                    <option key={u} value={u}>{m.usage[u]}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={m.fields.channel} hint={m.fields.channelHint} htmlFor={channelId}>
                            <Select
                                id={channelId}
                                value={editor.channel_id}
                                onChange={(e) => setEditor({ ...editor, channel_id: e.target.value })}
                            >
                                <option value="">{m.fields.anyChannel}</option>
                                {channels.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </Select>
                        </Field>
                        {/* Only meaningful on a plan — the log form has no purpose field. */}
                        {editor.usage !== 'LOG' && (
                            <>
                                <Field label={m.fields.purpose} hint={m.fields.purposeHint} htmlFor={purposeId}>
                                    <Select
                                        id={purposeId}
                                        value={editor.purpose_id}
                                        onChange={(e) => setEditor({ ...editor, purpose_id: e.target.value })}
                                    >
                                        <option value="">{m.fields.noPurpose}</option>
                                        {purposes.map((p) => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </Select>
                                </Field>
                                <Field label={m.fields.subject} hint={m.fields.subjectHint} htmlFor={subjectId}>
                                    <Input
                                        id={subjectId}
                                        value={editor.subject}
                                        onChange={(e) => setEditor({ ...editor, subject: e.target.value })}
                                        maxLength={MAX_SUBJECT}
                                        placeholder={m.fields.subjectPlaceholder}
                                    />
                                </Field>
                            </>
                        )}
                        <Field label={m.fields.body} required error={bodyError ?? undefined} htmlFor={bodyId}>
                            <Textarea
                                id={bodyId}
                                rows={5}
                                value={editor.body}
                                onChange={(e) => { setEditor({ ...editor, body: e.target.value }); setBodyError(null); }}
                                maxLength={MAX_BODY}
                                placeholder={m.fields.bodyPlaceholder}
                            />
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setEditor(null)}>{m.cancel}</Button>
                        <Button onClick={save} loading={saving}>{m.save}</Button>
                    </ModalFooter>
                </ModalShell>
            )}

            {deleting && (
                <ModalShell onBackdropClick={() => setDeleting(null)}>
                    <ModalHeader title={m.delete.title} onClose={() => setDeleting(null)} />
                    <div className="space-y-3 p-4">
                        <p className="text-sm text-gray-700">
                            {m.delete.body.replace('{name}', deleting.name)}
                        </p>
                        <p className="text-xs text-gray-400">{m.delete.note}</p>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setDeleting(null)}>{m.cancel}</Button>
                        <Button variant="danger" onClick={confirmDelete} loading={removing}>
                            {m.delete.action}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </div>
    );
}
