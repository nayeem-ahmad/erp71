'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { Sparkles, Plus, Pencil, Trash2, Power, CheckCircle2, CircleOff, Users, FolderKanban } from 'lucide-react';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { matchesAnyOf, matchesSearch } from '@/lib/list-filter';
import { api, type SkillRecord } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, Textarea, Select, FormGrid, Alert, StatusBadge, ConfirmDialog } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { SKILL_CATEGORY_VALUES } from '@erp71/shared-types';

const columnHelper = createColumnHelper<SkillRecord>();

interface FormState {
    name: string;
    description: string;
    category: string;
    sort_order: string;
}

const EMPTY_FORM: FormState = { name: '', description: '', category: 'OTHER', sort_order: '0' };

const statusOf = (row: { is_active?: boolean }) => (row.is_active === false ? 'inactive' : 'active');

export default function SkillsPage() {
    const { t, fmt, locale } = useI18n();
    const o = t.orgStructure;
    const s = t.skills;
    const [skills, setSkills] = useState<SkillRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<SkillRecord | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<SkillRecord | null>(null);
    const [statusTarget, setStatusTarget] = useState<SkillRecord | null>(null);
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [categoryFilter, setCategoryFilter] = useState<string[]>([]);

    useEffect(() => {
        void load();
    }, []);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getSkills();
            setSkills(Array.isArray(data) ? data : []);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : s.saveFailed);
        } finally {
            setLoading(false);
        }
    };

    const categoryLabel = (category: string) =>
        (s.category as Record<string, string>)[category] ?? category;

    const openCreate = () => {
        setEditTarget(null);
        setForm(EMPTY_FORM);
        setFieldErrors({});
        setError('');
        setModalOpen(true);
    };

    const openEdit = (skill: SkillRecord) => {
        setEditTarget(skill);
        setForm({
            name: skill.name,
            description: skill.description ?? '',
            category: skill.category || 'OTHER',
            sort_order: String(skill.sort_order ?? 0),
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
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
            setForm((prev) => ({ ...prev, [field]: e.target.value }));
            setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
        };

    const handleSave = async () => {
        const name = form.name.trim();
        const errors: Partial<Record<keyof FormState, string>> = {};
        if (!name) errors.name = s.nameRequired;
        if (Object.keys(errors).length) {
            setFieldErrors(errors);
            return;
        }
        const sortOrder = Number.parseInt(form.sort_order, 10);
        const payload = {
            name,
            description: form.description.trim() || null,
            category: form.category,
            sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
        };
        setSaving(true);
        setError('');
        try {
            if (editTarget) await api.updateSkill(editTarget.id, payload);
            else await api.createSkill(payload);
            toast.success(o.saved);
            closeModal();
            void load();
        } catch (err) {
            setError((err instanceof Error && err.message) || s.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async () => {
        if (!statusTarget) return;
        const activating = statusTarget.is_active === false;
        setBusy(true);
        try {
            await api.updateSkill(statusTarget.id, { is_active: activating });
            toast.success(fmt(activating ? o.activated : o.deactivated, { name: statusTarget.name }));
            setStatusTarget(null);
            void load();
        } catch (err) {
            toast.error((err instanceof Error && err.message) || s.saveFailed);
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setBusy(true);
        try {
            await api.deleteSkill(deleteTarget.id);
            toast.success(o.deleted);
            setDeleteTarget(null);
            void load();
        } catch (err) {
            toast.error((err instanceof Error && err.message) || s.deleteFailed);
        } finally {
            setBusy(false);
        }
    };

    const filtered = useMemo(
        () => skills.filter((row) => {
            if (!matchesAnyOf(statusFilter, statusOf(row))) return false;
            if (!matchesAnyOf(categoryFilter, row.category)) return false;
            return matchesSearch(search, row.name, row.description, categoryLabel(row.category));
        }),
        [skills, statusFilter, categoryFilter, search, s],
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
            id: 'category',
            type: 'multi-select',
            label: s.columns.category,
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: SKILL_CATEGORY_VALUES.map((value) => ({ value, label: categoryLabel(value) })),
        },
    ], [o, s, statusFilter, categoryFilter]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const inactive = filtered.filter((row) => statusOf(row) === 'inactive').length;
        const items: ListStat[] = [
            { id: 'count', icon: <Sparkles aria-hidden />, label: s.title, value: n(filtered.length) },
            { id: 'active', icon: <CheckCircle2 aria-hidden />, label: o.active, value: n(filtered.length - inactive) },
            { id: 'inactive', icon: <CircleOff aria-hidden />, label: o.inactive, value: n(inactive) },
            {
                id: 'people',
                icon: <Users aria-hidden />,
                label: s.columns.people,
                value: n(filtered.reduce((sum, row) => sum + (row._count?.personSkills ?? 0), 0)),
            },
            {
                id: 'projects',
                icon: <FolderKanban aria-hidden />,
                label: s.columns.projects,
                value: n(filtered.reduce((sum, row) => sum + (row._count?.projectSkills ?? 0), 0)),
            },
        ];
        return { items, loading, label: t.hr.listUi.skillsStats };
    }, [filtered, loading, locale, o, s, t]);

    const columns: ColumnDef<SkillRecord, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: s.columns.name,
                cell: (info) => {
                    const row = info.row.original;
                    return (
                        <div className="min-w-0">
                            <span className="block">{row.name}</span>
                            {row.description && <span className="block text-gray-500 truncate">{row.description}</span>}
                        </div>
                    );
                },
                size: 280,
            }),
            columnHelper.accessor('category', {
                header: s.columns.category,
                cell: (info) => categoryLabel(info.getValue()),
                size: 140,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => row._count?.personSkills ?? 0, {
                id: 'people',
                header: s.columns.people,
                cell: (info) => info.getValue(),
                size: 100,
                meta: { hideOnMobile: true, align: 'end' },
            }),
            columnHelper.accessor((row) => row._count?.projectSkills ?? 0, {
                id: 'projects',
                header: s.columns.projects,
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
                    const row = info.row.original;
                    const inUse = (row._count?.personSkills ?? 0) > 0 || (row._count?.projectSkills ?? 0) > 0;
                    const active = row.is_active !== false;
                    return (
                        <RowActions>
                            <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openEdit(row)} />
                            <RowActionButton
                                icon={<Power />}
                                label={active ? o.deactivate : o.activate}
                                intent={active ? 'warning' : 'success'}
                                onClick={() => setStatusTarget(row)}
                            />
                            <RowActionButton
                                icon={<Trash2 />}
                                label={inUse ? s.inUse : t.common.delete}
                                intent="danger"
                                disabled={inUse}
                                onClick={() => setDeleteTarget(row)}
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
        [t, o, s],
    );

    const activating = statusTarget?.is_active === false;

    return (
        <PageShell>
            <PageHeader
                title={s.title}
                subtitle={s.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    s.title,
                    'hr',
                )}
                actions={(
                    <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                        {s.newSkill}
                    </Button>
                )}
            />

            <DataTable<SkillRecord>
                tableId="skills"
                columns={columns}
                data={filtered}
                title={s.title}
                isLoading={loading}
                emptyMessage={s.emptyMessage}
                emptyIcon={<Sparkles className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={s.searchPlaceholder}
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
                        title={editTarget ? s.editSkill : s.newSkill}
                        onClose={closeModal}
                    />
                    <div className="p-4 space-y-4 overflow-y-auto">
                        {error && <Alert tone="danger">{error}</Alert>}
                        <FormGrid>
                            <Field label={t.common.name} required error={fieldErrors.name}>
                                <Input
                                    type="text"
                                    value={form.name}
                                    onChange={set('name')}
                                    placeholder={s.placeholders.name}
                                    error={!!fieldErrors.name}
                                    autoFocus
                                />
                            </Field>
                            <Field label={s.columns.category}>
                                <Select value={form.category} onChange={set('category')}>
                                    {SKILL_CATEGORY_VALUES.map((value) => (
                                        <option key={value} value={value}>{categoryLabel(value)}</option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={s.sortOrder}>
                                <Input
                                    type="number"
                                    min={0}
                                    max={9999}
                                    value={form.sort_order}
                                    onChange={set('sort_order')}
                                />
                            </Field>
                            <FormGrid.Full>
                                <Field label={s.description}>
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
                            {saving ? s.saving : editTarget ? t.common.saveChanges : t.common.create}
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
                title={s.deleteTitle}
                prompt={s.deleteDescription}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={() => void handleDelete()}
                onCancel={() => { if (!busy) setDeleteTarget(null); }}
            />
        </PageShell>
    );
}
