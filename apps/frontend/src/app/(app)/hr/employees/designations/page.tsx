'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { BadgeCheck, Plus, Pencil, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, Alert } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';

interface Designation {
    id: string;
    name: string;
    created_at: string;
}

const columnHelper = createColumnHelper<Designation>();

export default function DesignationsPage() {
    const { t } = useI18n();
    const [designations, setDesignations] = useState<Designation[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Designation | null>(null);
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
            const data = await api.getDesignations();
            setDesignations(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load designations', err);
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

    const openEdit = (desig: Designation) => {
        setEditTarget(desig);
        setName(desig.name);
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
            setError(t.designations.nameRequired);
            return;
        }
        setSaving(true);
        setError('');
        try {
            if (editTarget) {
                await api.updateDesignation(editTarget.id, { name: name.trim() });
            } else {
                await api.createDesignation({ name: name.trim() });
            }
            closeModal();
            void load();
        } catch (err: any) {
            setError(err.message || t.designations.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.deleteDesignation(id);
            void load();
        } catch (err: any) {
            console.error('Failed to delete designation', err);
            setError(err.message || t.designations.deleteFailed);
        } finally {
            setDeleteId(null);
        }
    };

    const columns: ColumnDef<Designation, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.designations.columns.name,
                cell: (info) => (
                    <span className="text-sm font-black text-gray-900">{info.getValue()}</span>
                ),
                size: 300,
            }),
            columnHelper.accessor('created_at', {
                header: t.designations.columns.created,
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
                    title={t.designations.title}
                    subtitle={t.designations.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.hr,
                        t.designations.title,
                        'hr',
                    )}
                    actions={(
                        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                            {t.designations.newDesignation}
                        </Button>
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
                />

            {modalOpen && (
                <ModalShell size="sm" onBackdropClick={closeModal}>
                    <ModalHeader
                        title={editTarget ? t.designations.editDesignation : t.designations.newDesignation}
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
                                placeholder={t.designations.placeholders.name}
                                autoFocus
                            />
                        </Field>
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

            {deleteId && (
                <ModalShell size="sm" onBackdropClick={() => setDeleteId(null)}>
                    <ModalHeader title={t.designations.deleteTitle} onClose={() => setDeleteId(null)} />
                    <div className="p-4">
                        <p className="text-sm text-gray-500">{t.designations.deleteDescription}</p>
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
