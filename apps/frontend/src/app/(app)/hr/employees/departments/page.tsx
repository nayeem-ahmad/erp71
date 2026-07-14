'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Layers, Plus, Pencil, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, Alert } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';

interface Department {
    id: string;
    name: string;
    created_at: string;
}

const columnHelper = createColumnHelper<Department>();

export default function DepartmentsPage() {
    const { t } = useI18n();
    const [departments, setDepartments] = useState<Department[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Department | null>(null);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [deleteId, setDeleteId] = useState<string | null>(null);

    useEffect(() => {
        void load();
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getDepartments();
            setDepartments(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load departments', err);
        } finally {
            setLoading(false);
        }
    };

    const openCreate = () => {
        setEditTarget(null);
        setName('');
        setError('');
        setModalOpen(true);
    };

    const openEdit = (dept: Department) => {
        setEditTarget(dept);
        setName(dept.name);
        setError('');
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setEditTarget(null);
        setError('');
    };

    const handleSave = async () => {
        if (!name.trim()) {
            setError(t.departments.nameRequired);
            return;
        }
        setSaving(true);
        setError('');
        try {
            if (editTarget) {
                await api.updateDepartment(editTarget.id, { name: name.trim() });
            } else {
                await api.createDepartment({ name: name.trim() });
            }
            closeModal();
            void load();
        } catch (err: any) {
            setError(err.message || t.departments.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.deleteDepartment(id);
            void load();
        } catch (err: any) {
            console.error('Failed to delete department', err);
            setError(err.message || t.departments.deleteFailed);
        } finally {
            setDeleteId(null);
        }
    };

    const columns: ColumnDef<Department, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.departments.columns.name,
                cell: (info) => (
                    <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                ),
                size: 300,
            }),
            columnHelper.accessor('created_at', {
                header: t.departments.columns.created,
                cell: (info) => (
                    <span className="text-sm text-gray-500">{formatDate(info.getValue())}</span>
                ),
                size: 150,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => openEdit(info.row.original)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title={t.common.edit}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setDeleteId(info.row.original.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title={t.common.delete}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ),
                enableSorting: false,
                enableResizing: false,
                size: 90,
            }),
        ],
        [t],
    );

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
                        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                            {t.departments.newDepartment}
                        </Button>
                    )}
                />

                <DataTable<Department>
                    tableId="departments"
                    columns={columns}
                    data={departments}
                    title={t.departments.title}
                    isLoading={loading}
                    emptyMessage={t.departments.emptyMessage}
                    emptyIcon={<Layers className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.departments.searchPlaceholder}
                />

            {modalOpen && (
                <ModalShell size="sm" onBackdropClick={closeModal}>
                    <ModalHeader
                        title={editTarget ? t.departments.editDepartment : t.departments.newDepartment}
                        onClose={closeModal}
                    />
                    <div className="p-4 space-y-4">
                        {error && <Alert tone="danger">{error}</Alert>}
                        <Field label={t.common.name} required>
                            <Input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                                placeholder={t.departments.placeholders.name}
                                autoFocus
                            />
                        </Field>
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

            {deleteId && (
                <ModalShell size="sm" onBackdropClick={() => setDeleteId(null)}>
                    <ModalHeader title={t.departments.deleteTitle} onClose={() => setDeleteId(null)} />
                    <div className="p-4">
                        <p className="text-sm text-gray-500">{t.departments.deleteDescription}</p>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setDeleteId(null)}>
                            {t.common.cancel}
                        </Button>
                        <Button variant="danger" onClick={() => handleDelete(deleteId)}>
                            {t.common.delete}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}
