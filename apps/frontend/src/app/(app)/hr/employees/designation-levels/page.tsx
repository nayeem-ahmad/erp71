'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { LayoutList, Plus, Pencil, Trash2, Power, Upload } from 'lucide-react';
import { DataTable, type ListFilter } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, FormGrid, Alert, StatusBadge, ConfirmDialog } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { levelLabel, type DesignationLevel } from '@/lib/org-structure';
import OrgImportDialog from '../OrgImportDialog';

const columnHelper = createColumnHelper<DesignationLevel>();

/**
 * The tenant's seniority scale — 1 is the most senior. Designations pick a
 * level from here, so the designation list can be filtered by it.
 */
export default function DesignationLevelsPage() {
    const { t, fmt } = useI18n();
    const o = t.orgStructure;
    const l = t.designationLevels;
    const [levels, setLevels] = useState<DesignationLevel[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<DesignationLevel | null>(null);
    const [number, setNumber] = useState('');
    const [name, setName] = useState('');
    const [fieldErrors, setFieldErrors] = useState<{ number?: string; name?: string }>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<DesignationLevel | null>(null);
    const [statusTarget, setStatusTarget] = useState<DesignationLevel | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        void load();
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getDesignationLevels();
            setLevels(Array.isArray(data) ? data : []);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : l.nameRequired);
        } finally {
            setLoading(false);
        }
    };

    const openCreate = () => {
        setEditTarget(null);
        // Suggest the next number down the scale.
        const next = levels.reduce((max, lvl) => Math.max(max, lvl.level), 0) + 1;
        setNumber(String(Math.min(next, 99)));
        setName('');
        setFieldErrors({});
        setError('');
        setModalOpen(true);
    };

    const openEdit = (lvl: DesignationLevel) => {
        setEditTarget(lvl);
        setNumber(String(lvl.level));
        setName(lvl.name);
        setFieldErrors({});
        setError('');
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setEditTarget(null);
        setError('');
    };

    const handleSave = async () => {
        const level = Number(number);
        const errors: { number?: string; name?: string } = {};
        if (!Number.isInteger(level) || level < 1 || level > 99) errors.number = l.numberRequired;
        if (!name.trim()) errors.name = l.nameRequired;
        if (Object.keys(errors).length) {
            setFieldErrors(errors);
            return;
        }
        setSaving(true);
        setError('');
        try {
            if (editTarget) await api.updateDesignationLevel(editTarget.id, { level, name: name.trim() });
            else await api.createDesignationLevel({ level, name: name.trim() });
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
            await api.updateDesignationLevel(statusTarget.id, { is_active: activating });
            toast.success(fmt(activating ? o.activated : o.deactivated, { name: levelLabel(statusTarget, o.levelWord) }));
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
            await api.deleteDesignationLevel(deleteTarget.id);
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
            id: 'status',
            type: 'select',
            label: o.status,
            columnId: 'status',
            options: [
                { value: 'active', label: o.active },
                { value: 'inactive', label: o.inactive },
            ],
        },
    ], [o]);

    const columns: ColumnDef<DesignationLevel, any>[] = useMemo(
        () => [
            columnHelper.accessor('level', {
                header: o.level,
                cell: (info) => <span className="text-sm font-medium text-gray-900 tabular-nums">{info.getValue()}</span>,
                size: 90,
            }),
            columnHelper.accessor('name', {
                header: l.name,
                cell: (info) => <span className="text-sm font-medium text-gray-900">{info.getValue()}</span>,
                size: 300,
            }),
            columnHelper.accessor((row) => row._count?.designations ?? 0, {
                id: 'designations',
                header: o.designations,
                cell: (info) => <span className="text-sm text-gray-700 tabular-nums">{info.getValue()}</span>,
                enableColumnFilter: false,
                size: 120,
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
                    const lvl = info.row.original;
                    const inUse = (lvl._count?.designations ?? 0) > 0;
                    const active = lvl.is_active !== false;
                    return (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => openEdit(lvl)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                title={t.common.edit}
                                aria-label={`${t.common.edit} ${lvl.name}`}
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setStatusTarget(lvl)}
                                className={`p-1.5 rounded-lg transition-colors ${active
                                    ? 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'
                                    : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                                title={active ? o.deactivate : o.activate}
                                aria-label={`${active ? o.deactivate : o.activate} ${lvl.name}`}
                            >
                                <Power className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setDeleteTarget(lvl)}
                                disabled={inUse}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                                title={inUse ? o.inUse : t.common.delete}
                                aria-label={`${t.common.delete} ${lvl.name}`}
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
        [t, o, l],
    );

    const activating = statusTarget?.is_active === false;
    const statusName = statusTarget ? levelLabel(statusTarget, o.levelWord) : '';

    return (
        <PageShell>
            <PageHeader
                title={l.title}
                subtitle={l.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    l.title,
                    'hr',
                )}
                actions={(
                    <>
                        <Button variant="secondary" icon={<Upload className="w-4 h-4" />} onClick={() => setImportOpen(true)}>
                            {o.importButton}
                        </Button>
                        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                            {l.newLevel}
                        </Button>
                    </>
                )}
            />

            <DataTable<DesignationLevel>
                tableId="designation-levels"
                columns={columns}
                data={levels}
                title={l.title}
                isLoading={loading}
                emptyMessage={l.emptyMessage}
                emptyIcon={<LayoutList className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={l.searchPlaceholder}
                filters={filters}
            />

            {modalOpen && (
                <ModalShell size="sm" onBackdropClick={closeModal}>
                    <ModalHeader title={editTarget ? l.editLevel : l.newLevel} onClose={closeModal} />
                    <div className="p-4 space-y-4">
                        {error && <Alert tone="danger">{error}</Alert>}
                        <FormGrid>
                            <Field label={l.levelNumber} hint={l.levelNumberHint} required error={fieldErrors.number}>
                                <Input
                                    type="number"
                                    min={1}
                                    max={99}
                                    step={1}
                                    value={number}
                                    onChange={(e) => { setNumber(e.target.value); setFieldErrors((p) => ({ ...p, number: undefined })); }}
                                    error={!!fieldErrors.number}
                                />
                            </Field>
                            <Field label={l.name} required error={fieldErrors.name}>
                                <Input
                                    type="text"
                                    value={name}
                                    onChange={(e) => { setName(e.target.value); setFieldErrors((p) => ({ ...p, name: undefined })); }}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                    placeholder={l.placeholders.name}
                                    error={!!fieldErrors.name}
                                    autoFocus
                                />
                            </Field>
                        </FormGrid>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={closeModal}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="primary" onClick={handleSave} loading={saving}>
                            {editTarget ? t.common.saveChanges : t.common.create}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

            <ConfirmDialog
                open={statusTarget !== null}
                title={fmt(activating ? o.activateTitle : o.deactivateTitle, { name: statusName })}
                prompt={activating ? o.activateBody : o.deactivateBody}
                confirmLabel={activating ? o.activate : o.deactivate}
                cancelLabel={t.common.cancel}
                loading={busy}
                onConfirm={() => void handleToggleActive()}
                onCancel={() => { if (!busy) setStatusTarget(null); }}
            />

            <ConfirmDialog
                open={deleteTarget !== null}
                title={l.deleteTitle}
                prompt={l.deleteDescription}
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
