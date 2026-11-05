'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { BadgeCheck, Plus, Pencil, Trash2, Upload, Power } from 'lucide-react';
import { DataTable, type ListFilter } from '@/components/data-table';
import { api, type DesignationInput } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, Select, Textarea, FormGrid, Alert, StatusBadge, ConfirmDialog } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import {
    codeLabel, levelLabel, pickable, reportsToLabel,
    type Department, type Designation, type DesignationLevel,
} from '@/lib/org-structure';
import OrgImportDialog from '../OrgImportDialog';

const columnHelper = createColumnHelper<Designation>();

interface FormState {
    code: string;
    name: string;
    department_id: string;
    level_id: string;
    reports_to_id: string;
    reports_to_note: string;
    remarks: string;
}

const EMPTY_FORM: FormState = {
    code: '', name: '', department_id: '', level_id: '', reports_to_id: '', reports_to_note: '', remarks: '',
};

function formFor(d: Designation): FormState {
    return {
        code: d.code ?? '',
        name: d.name,
        department_id: d.department_id ?? '',
        level_id: d.level_id ?? '',
        reports_to_id: d.reports_to_id ?? '',
        reports_to_note: d.reports_to_note ?? '',
        remarks: d.remarks ?? '',
    };
}

/**
 * The designation master: every designation with its code, department, level
 * and who it reports to. Filters by department, level and status; a
 * designation in use is deactivated rather than deleted, so nothing that
 * already names it changes.
 */
export default function DesignationsPage() {
    const { t, fmt } = useI18n();
    const o = t.orgStructure;
    const [designations, setDesignations] = useState<Designation[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [levels, setLevels] = useState<DesignationLevel[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Designation | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<Designation | null>(null);
    const [statusTarget, setStatusTarget] = useState<Designation | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        void load();
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const [desigs, depts, lvls] = await Promise.all([
                api.getDesignations(),
                api.getDepartments(),
                api.getDesignationLevels(),
            ]);
            setDesignations(Array.isArray(desigs) ? desigs : []);
            setDepartments(Array.isArray(depts) ? depts : []);
            setLevels(Array.isArray(lvls) ? lvls : []);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t.designations.saveFailed);
        } finally {
            setLoading(false);
        }
    };

    const openCreate = () => {
        setEditTarget(null);
        setForm(EMPTY_FORM);
        setFieldErrors({});
        setError('');
        setModalOpen(true);
    };

    const openEdit = (desig: Designation) => {
        setEditTarget(desig);
        setForm(formFor(desig));
        setFieldErrors({});
        setError('');
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setEditTarget(null);
        setError('');
    };

    const set = (field: keyof FormState) =>
        (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
            setForm((prev) => ({ ...prev, [field]: e.target.value }));
            setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
        };

    const handleSave = async () => {
        const name = form.name.trim();
        const code = form.code.trim().toUpperCase();
        const errors: Partial<Record<keyof FormState, string>> = {};
        if (!name) errors.name = t.designations.nameRequired;
        if (code && designations.some((d) => d.code === code && d.id !== editTarget?.id)) {
            errors.code = t.designations.codeTaken;
        }
        if (Object.keys(errors).length) {
            setFieldErrors(errors);
            return;
        }
        const payload: DesignationInput = {
            name,
            code: code || null,
            department_id: form.department_id || null,
            level_id: form.level_id || null,
            reports_to_id: form.reports_to_id || null,
            // A reporting designation makes the note redundant.
            reports_to_note: form.reports_to_id ? null : form.reports_to_note.trim() || null,
            remarks: form.remarks.trim() || null,
        };
        setSaving(true);
        setError('');
        try {
            if (editTarget) await api.updateDesignation(editTarget.id, payload);
            else await api.createDesignation(payload);
            toast.success(o.saved);
            closeModal();
            void load();
        } catch (err) {
            setError((err instanceof Error && err.message) || t.designations.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async () => {
        if (!statusTarget) return;
        const activating = statusTarget.is_active === false;
        setBusy(true);
        try {
            await api.updateDesignation(statusTarget.id, { is_active: activating });
            toast.success(fmt(activating ? o.activated : o.deactivated, { name: statusTarget.name }));
            setStatusTarget(null);
            void load();
        } catch (err) {
            toast.error((err instanceof Error && err.message) || t.designations.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setBusy(true);
        try {
            await api.deleteDesignation(deleteTarget.id);
            toast.success(o.deleted);
            setDeleteTarget(null);
            void load();
        } catch (err) {
            toast.error((err instanceof Error && err.message) || t.designations.deleteFailed);
        } finally {
            setBusy(false);
        }
    };

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'department',
            type: 'select',
            label: o.department,
            columnId: 'department',
            options: departments.map((d) => ({ value: d.id, label: codeLabel(d) })),
        },
        {
            id: 'level',
            type: 'select',
            label: o.level,
            columnId: 'level',
            options: levels.map((l) => ({ value: l.id, label: levelLabel(l, o.levelWord) })),
        },
        {
            id: 'status',
            type: 'select',
            label: o.status,
            columnId: 'status',
            options: [
                { value: 'active', label: o.active },
                { value: 'inactive', label: o.inactive },
            ],
        },
    ], [o, departments, levels]);

    const columns: ColumnDef<Designation, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.code ?? '', {
                id: 'code',
                header: o.code,
                cell: (info) => <span className="text-sm font-medium text-gray-900 whitespace-nowrap">{info.getValue() || '—'}</span>,
                size: 100,
            }),
            columnHelper.accessor('name', {
                header: t.designations.columns.name,
                cell: (info) => {
                    const d = info.row.original;
                    return (
                        <div className="min-w-0">
                            <span className="block text-sm font-medium text-gray-900">{d.name}</span>
                            {d.remarks && <span className="block text-xs text-gray-500 truncate">{d.remarks}</span>}
                        </div>
                    );
                },
                size: 240,
            }),
            // Filtered by id so two departments of the same name stay apart;
            // shown and sorted by label.
            columnHelper.accessor((row) => row.department_id ?? '', {
                id: 'department',
                header: o.department,
                cell: (info) => <span className="text-sm text-gray-700">{codeLabel(info.row.original.department) || '—'}</span>,
                filterFn: 'equalsString',
                sortingFn: (a, b) => codeLabel(a.original.department).localeCompare(codeLabel(b.original.department)),
                size: 200,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row.level_id ?? '', {
                id: 'level',
                header: o.level,
                cell: (info) => {
                    const level = info.row.original.level;
                    return level
                        ? <span className="text-sm text-gray-700"><span className="tabular-nums">{level.level}</span> · {level.name}</span>
                        : <span className="text-sm text-gray-400">—</span>;
                },
                filterFn: 'equalsString',
                sortingFn: (a, b) => (a.original.level?.level ?? 99) - (b.original.level?.level ?? 99),
                size: 200,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => reportsToLabel(row), {
                id: 'reports_to',
                header: o.reportsTo,
                cell: (info) => <span className="text-sm text-gray-700">{info.getValue() || '—'}</span>,
                size: 220,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row._count?.employees ?? 0, {
                id: 'employees',
                header: o.employees,
                cell: (info) => <span className="text-sm text-gray-700 tabular-nums">{info.getValue()}</span>,
                enableColumnFilter: false,
                size: 100,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => (row.is_active === false ? 'inactive' : 'active'), {
                id: 'status',
                header: o.status,
                cell: (info) => info.getValue() === 'active'
                    ? <StatusBadge tone="success">{o.active}</StatusBadge>
                    : <StatusBadge tone="neutral">{o.inactive}</StatusBadge>,
                filterFn: 'equalsString',
                size: 110,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => {
                    const d = info.row.original;
                    const inUse = (d._count?.employees ?? 0) > 0
                        || designations.some((other) => other.reports_to_id === d.id);
                    const active = d.is_active !== false;
                    return (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => openEdit(d)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                title={t.common.edit}
                                aria-label={`${t.common.edit} ${d.name}`}
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setStatusTarget(d)}
                                className={`p-1.5 rounded-lg transition-colors ${active
                                    ? 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'
                                    : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                                title={active ? o.deactivate : o.activate}
                                aria-label={`${active ? o.deactivate : o.activate} ${d.name}`}
                            >
                                <Power className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setDeleteTarget(d)}
                                disabled={inUse}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                                title={inUse ? o.inUse : t.common.delete}
                                aria-label={`${t.common.delete} ${d.name}`}
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    );
                },
                enableSorting: false,
                enableResizing: false,
                size: 120,
            }),
        ],
        [t, o, designations],
    );

    // Pickers offer active records, plus whatever this designation already has.
    const departmentOptions = pickable(departments, editTarget?.department_id);
    const levelOptions = pickable(levels, editTarget?.level_id);
    const reportsToOptions = pickable(designations, editTarget?.reports_to_id).filter((d) => d.id !== editTarget?.id);
    const inactive = (item: { is_active?: boolean }) => (item.is_active === false ? ` ${o.inactiveSuffix}` : '');
    const activating = statusTarget?.is_active === false;

    return (
        <PageShell>
            <PageHeader
                title={t.designations.title}
                subtitle={t.designations.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    t.designations.title,
                    'hr',
                )}
                actions={(
                    <>
                        <Button variant="secondary" icon={<Upload className="w-4 h-4" />} onClick={() => setImportOpen(true)}>
                            {o.importButton}
                        </Button>
                        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                            {t.designations.newDesignation}
                        </Button>
                    </>
                )}
            />

            <DataTable<Designation>
                tableId="designations"
                columns={columns}
                data={designations}
                title={t.designations.title}
                isLoading={loading}
                emptyMessage={t.designations.emptyMessage}
                emptyIcon={<BadgeCheck className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.designations.searchPlaceholder}
                filters={filters}
            />

            {modalOpen && (
                <ModalShell size="md" onBackdropClick={closeModal}>
                    <ModalHeader
                        title={editTarget ? t.designations.editDesignation : t.designations.newDesignation}
                        subtitle={editTarget ? codeLabel(editTarget) : undefined}
                        onClose={closeModal}
                    />
                    <div className="p-4 space-y-4 overflow-y-auto">
                        {error && <Alert tone="danger">{error}</Alert>}
                        <FormGrid>
                            <Field label={o.code} hint={o.codeHint} error={fieldErrors.code}>
                                <Input
                                    type="text"
                                    value={form.code}
                                    onChange={set('code')}
                                    placeholder="IMP-04"
                                    className="uppercase"
                                    error={!!fieldErrors.code}
                                    maxLength={30}
                                />
                            </Field>
                            <Field label={t.common.name} required error={fieldErrors.name}>
                                <Input
                                    type="text"
                                    value={form.name}
                                    onChange={set('name')}
                                    placeholder={t.designations.placeholders.name}
                                    error={!!fieldErrors.name}
                                    autoFocus
                                />
                            </Field>
                            <Field label={o.department}>
                                <Select value={form.department_id} onChange={set('department_id')} aria-label={o.department}>
                                    <option value="">{o.noDepartment}</option>
                                    {departmentOptions.map((d) => (
                                        <option key={d.id} value={d.id}>{codeLabel(d)}{inactive(d)}</option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={o.level}>
                                <Select value={form.level_id} onChange={set('level_id')} aria-label={o.level}>
                                    <option value="">{o.noLevel}</option>
                                    {levelOptions.map((l) => (
                                        <option key={l.id} value={l.id}>{levelLabel(l, o.levelWord)}{inactive(l)}</option>
                                    ))}
                                </Select>
                            </Field>
                            <FormGrid.Full>
                                <Field label={o.reportsTo}>
                                    <Select value={form.reports_to_id} onChange={set('reports_to_id')} aria-label={o.reportsTo}>
                                        <option value="">{o.nobody}</option>
                                        {reportsToOptions.map((d) => (
                                            <option key={d.id} value={d.id}>{codeLabel(d)}{inactive(d)}</option>
                                        ))}
                                    </Select>
                                </Field>
                            </FormGrid.Full>
                            {!form.reports_to_id && (
                                <FormGrid.Full>
                                    <Field label={o.reportsToNote} hint={o.reportsToNoteHint}>
                                        <Input type="text" value={form.reports_to_note} onChange={set('reports_to_note')} placeholder="Shareholders" />
                                    </Field>
                                </FormGrid.Full>
                            )}
                            <FormGrid.Full>
                                <Field label={o.remarks}>
                                    <Textarea rows={2} value={form.remarks} onChange={set('remarks')} />
                                </Field>
                            </FormGrid.Full>
                        </FormGrid>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={closeModal}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="primary" onClick={handleSave} loading={saving}>
                            {saving ? t.designations.saving : editTarget ? t.common.saveChanges : t.common.create}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            <ConfirmDialog
                open={statusTarget !== null}
                title={fmt(activating ? o.activateTitle : o.deactivateTitle, { name: statusTarget?.name ?? '' })}
                prompt={activating ? o.activateBody : o.deactivateBody}
                confirmLabel={activating ? o.activate : o.deactivate}
                cancelLabel={t.common.cancel}
                loading={busy}
                onConfirm={() => void handleToggleActive()}
                onCancel={() => { if (!busy) setStatusTarget(null); }}
            />

            <ConfirmDialog
                open={deleteTarget !== null}
                title={t.designations.deleteTitle}
                prompt={t.designations.deleteDescription}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={() => void handleDelete()}
                onCancel={() => { if (!busy) setDeleteTarget(null); }}
            />

            <OrgImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={() => void load()} />
        </PageShell>
    );
}
