'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Layers, Plus, Pencil, Trash2, Power, Upload, CheckCircle2, CircleOff, BadgeCheck, Users } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, Textarea, FormGrid, Alert, StatusBadge, ConfirmDialog } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { codeLabel, type Department } from '@/lib/org-structure';
import OrgImportDialog from '../OrgImportDialog';

const columnHelper = createColumnHelper<Department>();

interface FormState {
    code: string;
    name: string;
    description: string;
    reports_to: string;
}

const EMPTY_FORM: FormState = { code: '', name: '', description: '', reports_to: '' };
/** The reports-to chip's value for a department that names no one. */
const NONE = '__none__';

const statusOf = (row: { is_active?: boolean }) => (row.is_active === false ? 'inactive' : 'active');

/**
 * The department master. A department with employees or designations is
 * deactivated rather than deleted, so it stays on every record that names it.
 */
export default function DepartmentsPage() {
    const { t, fmt, locale } = useI18n();
    const o = t.orgStructure;
    const [departments, setDepartments] = useState<Department[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Department | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
    const [statusTarget, setStatusTarget] = useState<Department | null>(null);
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [reportsTo, setReportsTo] = useState<string[]>([]);
    const [employeeCount, setEmployeeCount] = useState<NumberCondition | null>(null);

    useEffect(() => {
        void load();
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getDepartments();
            setDepartments(Array.isArray(data) ? data : []);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t.departments.saveFailed);
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

    const openEdit = (dept: Department) => {
        setEditTarget(dept);
        setForm({
            code: dept.code ?? '',
            name: dept.name,
            description: dept.description ?? '',
            reports_to: dept.reports_to ?? '',
        });
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
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            setForm((prev) => ({ ...prev, [field]: e.target.value }));
            setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
        };

    const handleSave = async () => {
        const name = form.name.trim();
        const code = form.code.trim().toUpperCase();
        const errors: Partial<Record<keyof FormState, string>> = {};
        if (!name) errors.name = t.departments.nameRequired;
        if (code && departments.some((d) => d.code === code && d.id !== editTarget?.id)) {
            errors.code = t.departments.codeTaken;
        }
        if (Object.keys(errors).length) {
            setFieldErrors(errors);
            return;
        }
        const payload = {
            name,
            code: code || null,
            description: form.description.trim() || null,
            reports_to: form.reports_to.trim() || null,
        };
        setSaving(true);
        setError('');
        try {
            if (editTarget) await api.updateDepartment(editTarget.id, payload);
            else await api.createDepartment(payload);
            toast.success(o.saved);
            closeModal();
            void load();
        } catch (err) {
            setError((err instanceof Error && err.message) || t.departments.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async () => {
        if (!statusTarget) return;
        const activating = statusTarget.is_active === false;
        setBusy(true);
        try {
            await api.updateDepartment(statusTarget.id, { is_active: activating });
            toast.success(fmt(activating ? o.activated : o.deactivated, { name: statusTarget.name }));
            setStatusTarget(null);
            void load();
        } catch (err) {
            toast.error((err instanceof Error && err.message) || t.departments.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setBusy(true);
        try {
            await api.deleteDepartment(deleteTarget.id);
            toast.success(o.deleted);
            setDeleteTarget(null);
            void load();
        } catch (err) {
            toast.error((err instanceof Error && err.message) || t.departments.deleteFailed);
        } finally {
            setBusy(false);
        }
    };

    const reportsToOptions = useMemo(
        () => [...new Set(departments.map((d) => d.reports_to?.trim()).filter((v): v is string => Boolean(v)))]
            .sort((a, b) => a.localeCompare(b))
            .map((value) => ({ value, label: value })),
        [departments],
    );

    const filtered = useMemo(
        () => departments.filter((d) => {
            if (!matchesAnyOf(statusFilter, statusOf(d))) return false;
            if (!matchesAnyOf(reportsTo, d.reports_to?.trim() || NONE)) return false;
            if (!matchesNumberCondition(d._count?.employees ?? 0, employeeCount)) return false;
            return matchesSearch(search, d.code, d.name, d.description, d.reports_to);
        }),
        [departments, statusFilter, reportsTo, employeeCount, search],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'status',
            type: 'multi-select',
            label: o.status,
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
                { value: 'active', label: o.active },
                { value: 'inactive', label: o.inactive },
            ],
        },
        {
            id: 'reportsTo',
            type: 'multi-select',
            label: o.reportsTo,
            value: reportsTo,
            onChange: setReportsTo,
            options: [{ value: NONE, label: t.hr.reports.common.unassigned }, ...reportsToOptions],
        },
        {
            id: 'employees',
            type: 'number',
            label: o.employees,
            value: employeeCount,
            onChange: setEmployeeCount,
        },
    ], [o, t, statusFilter, reportsTo, reportsToOptions, employeeCount]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const inactive = filtered.filter((d) => statusOf(d) === 'inactive').length;
        const items: ListStat[] = [
            { id: 'count', icon: <Layers aria-hidden />, label: t.departments.title, value: n(filtered.length) },
            { id: 'active', icon: <CheckCircle2 aria-hidden />, label: o.active, value: n(filtered.length - inactive) },
            { id: 'inactive', icon: <CircleOff aria-hidden />, label: o.inactive, value: n(inactive) },
            {
                id: 'designations',
                icon: <BadgeCheck aria-hidden />,
                label: o.designations,
                value: n(filtered.reduce((sum, d) => sum + (d._count?.designations ?? 0), 0)),
            },
            {
                id: 'employees',
                icon: <Users aria-hidden />,
                label: o.employees,
                value: n(filtered.reduce((sum, d) => sum + (d._count?.employees ?? 0), 0)),
            },
        ];
        return { items, loading, label: t.hr.listUi.departmentsStats };
    }, [filtered, loading, locale, o, t]);

    const columns: ColumnDef<Department, any>[] = useMemo(
        () => [
            columnHelper.accessor((row) => row.code ?? '', {
                id: 'code',
                header: o.code,
                cell: (info) => info.getValue() || '—',
                size: 90,
            }),
            columnHelper.accessor('name', {
                header: t.departments.columns.name,
                cell: (info) => {
                    const d = info.row.original;
                    return (
                        <div className="min-w-0">
                            <span className="block">{d.name}</span>
                            {d.description && <span className="block text-gray-500 truncate">{d.description}</span>}
                        </div>
                    );
                },
                size: 280,
            }),
            columnHelper.accessor((row) => row.reports_to ?? '', {
                id: 'reports_to',
                header: o.reportsTo,
                cell: (info) => info.getValue() || '—',
                size: 160,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row._count?.designations ?? 0, {
                id: 'designations',
                header: o.designations,
                cell: (info) => info.getValue(),
                size: 110,
                meta: { hideOnMobile: true, align: 'end' },
            }),
            columnHelper.accessor((row) => row._count?.employees ?? 0, {
                id: 'employees',
                header: o.employees,
                cell: (info) => info.getValue(),
                size: 100,
                meta: { hideOnMobile: true, align: 'end' },
            }),
            columnHelper.accessor(statusOf, {
                id: 'status',
                header: o.status,
                cell: (info) => info.getValue() === 'active'
                    ? <StatusBadge tone="success">{o.active}</StatusBadge>
                    : <StatusBadge tone="neutral">{o.inactive}</StatusBadge>,
                size: 110,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => {
                    const d = info.row.original;
                    const inUse = (d._count?.employees ?? 0) > 0 || (d._count?.designations ?? 0) > 0;
                    const active = d.is_active !== false;
                    return (
                        <RowActions>
                            <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openEdit(d)} />
                            <RowActionButton
                                icon={<Power />}
                                label={active ? o.deactivate : o.activate}
                                intent={active ? 'warning' : 'success'}
                                onClick={() => setStatusTarget(d)}
                            />
                            <RowActionButton
                                icon={<Trash2 />}
                                label={inUse ? o.inUse : t.common.delete}
                                intent="danger"
                                disabled={inUse}
                                onClick={() => setDeleteTarget(d)}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 120,
            }),
        ],
        [t, o],
    );

    const activating = statusTarget?.is_active === false;

    return (
        <PageShell>
            <PageHeader
                title={t.departments.title}
                subtitle={t.departments.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    t.departments.title,
                    'hr',
                )}
                actions={(
                    <>
                        <Button variant="secondary" icon={<Upload className="w-4 h-4" />} onClick={() => setImportOpen(true)}>
                            {o.importButton}
                        </Button>
                        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                            {t.departments.newDepartment}
                        </Button>
                    </>
                )}
            />

            <DataTable<Department>
                tableId="departments"
                columns={columns}
                data={filtered}
                title={t.departments.title}
                isLoading={loading}
                emptyMessage={t.departments.emptyMessage}
                emptyIcon={<Layers className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={t.departments.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />

            {modalOpen && (
                <ModalShell size="md" onBackdropClick={closeModal}>
                    <ModalHeader
                        title={editTarget ? t.departments.editDepartment : t.departments.newDepartment}
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
                                    placeholder="IMP"
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
                                    placeholder={t.departments.placeholders.name}
                                    error={!!fieldErrors.name}
                                    autoFocus
                                />
                            </Field>
                            <FormGrid.Full>
                                <Field label={o.reportsTo}>
                                    <Input type="text" value={form.reports_to} onChange={set('reports_to')} placeholder="CEO" />
                                </Field>
                            </FormGrid.Full>
                            <FormGrid.Full>
                                <Field label={o.description}>
                                    <Textarea rows={2} value={form.description} onChange={set('description')} />
                                </Field>
                            </FormGrid.Full>
                        </FormGrid>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={closeModal}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="primary" onClick={handleSave} loading={saving}>
                            {saving ? t.departments.saving : editTarget ? t.common.saveChanges : t.common.create}
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
                title={t.departments.deleteTitle}
                prompt={t.departments.deleteDescription}
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
