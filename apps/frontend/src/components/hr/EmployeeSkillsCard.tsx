'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, X } from 'lucide-react';
import { Button, Select, Field, Textarea, ConfirmDialog } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { api, type PersonSkillAssignment, type SkillRecord } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { SKILL_PROFICIENCY_VALUES } from '@erp71/shared-types';

export default function EmployeeSkillsCard({
    employeeId,
    assignments,
    onChanged,
}: {
    employeeId: string;
    assignments: PersonSkillAssignment[];
    onChanged: () => void | Promise<void>;
}) {
    const { t } = useI18n();
    const copy = t.employees.detail.skills;
    const catalog = t.skills;

    const [open, setOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<PersonSkillAssignment | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<PersonSkillAssignment | null>(null);
    const [directory, setDirectory] = useState<SkillRecord[]>([]);
    const [skillId, setSkillId] = useState('');
    const [proficiency, setProficiency] = useState('INTERMEDIATE');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(false);

    const proficiencyLabel = (value: string) =>
        (catalog.proficiency as Record<string, string>)[value] ?? value;

    useEffect(() => {
        if (!open || editTarget) return;
        api.getSkills({ status: 'active' })
            .then((res) => setDirectory(Array.isArray(res) ? res : []))
            .catch(() => setDirectory([]));
    }, [open, editTarget]);

    const available = useMemo(() => {
        const taken = new Set(assignments.map((row) => row.skill.id));
        return directory.filter((skill) => !taken.has(skill.id));
    }, [directory, assignments]);

    const closeModal = () => {
        setOpen(false);
        setEditTarget(null);
        setSkillId('');
        setProficiency('INTERMEDIATE');
        setNotes('');
    };

    const openCreate = () => {
        setEditTarget(null);
        setSkillId('');
        setProficiency('INTERMEDIATE');
        setNotes('');
        setOpen(true);
    };

    const openEdit = (row: PersonSkillAssignment) => {
        setEditTarget(row);
        setSkillId(row.skill.id);
        setProficiency(row.proficiency);
        setNotes(row.notes ?? '');
        setOpen(true);
    };

    const save = async () => {
        if (!editTarget && !skillId) return;
        setSaving(true);
        try {
            if (editTarget) {
                await api.updatePersonSkill(editTarget.id, {
                    proficiency,
                    notes: notes.trim() || null,
                });
                toast.success(copy.updated);
            } else {
                await api.addPersonSkill({
                    employeeId,
                    skillId,
                    proficiency,
                    notes: notes.trim() || null,
                });
                toast.success(copy.added);
            }
            closeModal();
            await onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : (editTarget ? copy.updateFailed : copy.addFailed));
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!deleteTarget) return;
        setBusy(true);
        try {
            await api.removePersonSkill(deleteTarget.id);
            toast.success(copy.removed);
            setDeleteTarget(null);
            await onChanged();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : copy.removeFailed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">{copy.title}</h2>
                <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline min-h-touch"
                >
                    <Plus className="h-3.5 w-3.5" />
                    {copy.add}
                </button>
            </div>

            {assignments.length === 0 ? (
                <p className="text-sm text-gray-500">{copy.empty}</p>
            ) : (
                <ul className="space-y-1.5 text-sm">
                    {assignments.map((row) => (
                        <li key={row.id} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate">
                                {row.skill.name}
                                {row.notes ? <span className="ms-1 text-gray-500">· {row.notes}</span> : null}
                            </span>
                            <span className="shrink-0 text-xs text-gray-500">{proficiencyLabel(row.proficiency)}</span>
                            <button
                                type="button"
                                onClick={() => openEdit(row)}
                                title={t.common.edit}
                                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-blue-600 min-h-touch inline-flex items-center justify-center"
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setDeleteTarget(row)}
                                title={copy.remove}
                                className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 min-h-touch inline-flex items-center justify-center"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {open && (
                <ModalShell onBackdropClick={closeModal}>
                    <ModalHeader title={editTarget ? t.common.edit : copy.add} onClose={closeModal} />
                    <div className="space-y-3 p-4">
                        <Field label={copy.skill} required>
                            {editTarget ? (
                                <p className="text-sm font-medium text-gray-900">{editTarget.skill.name}</p>
                            ) : (
                                <Select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
                                    <option value="">—</option>
                                    {available.map((skill) => (
                                        <option key={skill.id} value={skill.id}>{skill.name}</option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                        <Field label={copy.proficiency}>
                            <Select value={proficiency} onChange={(e) => setProficiency(e.target.value)}>
                                {SKILL_PROFICIENCY_VALUES.map((value) => (
                                    <option key={value} value={value}>{proficiencyLabel(value)}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={copy.notes}>
                            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={closeModal}>
                            {t.common.cancel}
                        </Button>
                        <Button onClick={save} disabled={saving || (!editTarget && !skillId)}>
                            {t.common.save}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            <ConfirmDialog
                open={deleteTarget !== null}
                title={copy.remove}
                prompt={deleteTarget ? deleteTarget.skill.name : ''}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={() => void remove()}
                onCancel={() => { if (!busy) setDeleteTarget(null); }}
            />
        </div>
    );
}
