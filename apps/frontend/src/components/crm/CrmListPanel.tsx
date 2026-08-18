'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, EyeOff, Eye } from 'lucide-react';
import { Button, Input, Field, Select, StatusBadge } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import type { LeadTaxonomyKind, LeadTaxonomyOption } from '@/lib/use-lead-taxonomy';

type EditorState = {
    id?: string;
    name: string;
    score_weight: string;
    icon: string;
};

const MAX_SCORE_WEIGHT = 25;

/**
 * One tenant-managed CRM lookup list — sources, categories or conversation
 * channels — rendered as a tab body inside CRM Setup.
 *
 * All three are the same CRUD surface over `/crm/lead-taxonomy/:kind`; the only
 * per-list differences are the two optional columns (`score_weight` on sources,
 * `icon` on channels) and the noun used in the delete dialog. Keeping them in one
 * component is what stops the three tabs drifting apart in behaviour.
 */
export default function CrmListPanel({
    kind,
    canManage,
}: Readonly<{ kind: LeadTaxonomyKind; canManage: boolean }>) {
    const { t } = useI18n();
    const m = t.crm.leadTaxonomy;

    const [rows, setRows] = useState<LeadTaxonomyOption[]>([]);
    const [usage, setUsage] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);

    const [editor, setEditor] = useState<EditorState | null>(null);
    const [nameError, setNameError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [deleting, setDeleting] = useState<LeadTaxonomyOption | null>(null);
    const [reassignTo, setReassignTo] = useState('');
    const [removing, setRemoving] = useState(false);

    const isSources = kind === 'sources';
    const isChannels = kind === 'channels';
    const isPurposes = kind === 'purposes';
    // Channels and purposes both carry an emoji; the two lead lists do not.
    const hasIcon = isChannels || isPurposes;
    const addLabel = isSources
        ? m.addSource
        : isChannels
            ? m.addChannel
            : isPurposes
                ? m.addPurpose
                : m.addCategory;
    // Channels and purposes are counted against activities, the two lead lists
    // against leads.
    const usageTemplate = hasIcon ? m.activitiesUsing : m.leadsUsing;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const list = await api.getLeadTaxonomy(kind, true);
            setRows(Array.isArray(list) ? list : []);
        } catch {
            setRows([]);
        } finally {
            setLoading(false);
        }
        // Usage needs MANAGE_CRM_SETTINGS; a read-only viewer simply sees no counts.
        try {
            setUsage(await api.getLeadTaxonomyUsage(kind));
        } catch {
            setUsage({});
        }
    }, [kind]);

    useEffect(() => {
        load();
    }, [load]);

    const inUseCount = deleting ? (usage[deleting.id] ?? 0) : 0;
    const reassignTargets = useMemo(
        () => rows.filter((r) => r.id !== deleting?.id && r.is_active),
        [rows, deleting],
    );

    const openCreate = () => {
        setNameError(null);
        setEditor({ name: '', score_weight: '5', icon: '' });
    };
    const openEdit = (row: LeadTaxonomyOption) => {
        setNameError(null);
        setEditor({
            id: row.id,
            name: row.name,
            score_weight: String(row.score_weight ?? 5),
            icon: row.icon ?? '',
        });
    };

    const save = async () => {
        if (!editor) return;
        const name = editor.name.trim();
        if (!name) {
            setNameError(m.validation.nameRequired);
            return;
        }
        const weight = Number(editor.score_weight);
        if (isSources && (!Number.isInteger(weight) || weight < 0 || weight > MAX_SCORE_WEIGHT)) {
            setNameError(null);
            toast.error(m.validation.weightRange);
            return;
        }

        setSaving(true);
        try {
            const payload = {
                name,
                ...(isSources ? { score_weight: weight } : {}),
                ...(hasIcon ? { icon: editor.icon.trim() } : {}),
            };
            if (editor.id) {
                await api.updateLeadTaxonomy(kind, editor.id, payload);
            } else {
                await api.createLeadTaxonomy(kind, payload);
            }
            setEditor(null);
            toast.success(m.saved);
            await load();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : m.saveFailed;
            // Duplicate names are the one failure a user can fix in the field
            // they are looking at, so they belong inline rather than in a toast.
            if (/already exists/i.test(message)) setNameError(message);
            else toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (row: LeadTaxonomyOption) => {
        try {
            await api.updateLeadTaxonomy(kind, row.id, { is_active: !row.is_active });
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.saveFailed);
        }
    };

    const confirmDelete = async () => {
        if (!deleting) return;
        if (inUseCount > 0 && !reassignTo) {
            toast.error(m.delete.pickReplacement);
            return;
        }
        setRemoving(true);
        try {
            await api.deleteLeadTaxonomy(kind, deleting.id, inUseCount > 0 ? reassignTo : undefined);
            setDeleting(null);
            setReassignTo('');
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
            {canManage && (
                <div className="flex justify-end">
                    <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />}>
                        {addLabel}
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
                            <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        {hasIcon && (
                                            <span aria-hidden="true" className="text-base">
                                                {row.icon || (isPurposes ? '📌' : '💬')}
                                            </span>
                                        )}
                                        <span className="truncate text-sm font-medium text-gray-800">
                                            {row.name}
                                        </span>
                                        {!row.is_active && (
                                            <StatusBadge tone="neutral">{m.inactive}</StatusBadge>
                                        )}
                                    </div>
                                    <p className="mt-0.5 text-xs text-gray-400">
                                        {isSources && `${m.weight}: ${row.score_weight ?? 0} · `}
                                        {usageTemplate.replace('{count}', String(usage[row.id] ?? 0))}
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
                                            onClick={() => { setDeleting(row); setReassignTo(''); }}
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
                        title={editor.id ? m.editTitle : addLabel}
                        onClose={() => setEditor(null)}
                    />
                    <div className="space-y-3 p-4">
                        <Field label={m.fields.name} required error={nameError ?? undefined}>
                            <Input
                                value={editor.name}
                                onChange={(e) => { setEditor({ ...editor, name: e.target.value }); setNameError(null); }}
                                maxLength={60}
                                error={Boolean(nameError)}
                                autoFocus
                            />
                        </Field>
                        {isSources && (
                            <Field label={m.fields.weight} hint={m.fields.weightHint}>
                                <Input
                                    type="number"
                                    min={0}
                                    max={MAX_SCORE_WEIGHT}
                                    value={editor.score_weight}
                                    onChange={(e) => setEditor({ ...editor, score_weight: e.target.value })}
                                />
                            </Field>
                        )}
                        {hasIcon && (
                            <Field label={m.fields.icon} hint={m.fields.iconHint}>
                                <Input
                                    value={editor.icon}
                                    onChange={(e) => setEditor({ ...editor, icon: e.target.value })}
                                    maxLength={8}
                                />
                            </Field>
                        )}
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
                        {inUseCount > 0 && (
                            <>
                                <p className="text-sm text-gray-700">
                                    {(hasIcon ? m.delete.inUseActivities : m.delete.inUse)
                                        .replace('{count}', String(inUseCount))}
                                </p>
                                <Field label={m.delete.reassignLabel} required>
                                    <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                                        <option value="">{m.delete.pickReplacement}</option>
                                        {reassignTargets.map((r) => (
                                            <option key={r.id} value={r.id}>{r.name}</option>
                                        ))}
                                    </Select>
                                </Field>
                            </>
                        )}
                        {deleting.is_system && (
                            <p className="text-xs text-gray-400">{m.delete.systemNote}</p>
                        )}
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
