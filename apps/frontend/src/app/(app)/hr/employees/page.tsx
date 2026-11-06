'use client';

import { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Eye, Pencil, Upload, UserCheck, UserX, Clock, LogOut, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import EmployeeFormModal from './EmployeeFormModal';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type ListFilter, type ListStat } from '@/components/data-table';
import type { CreatedRange } from '@/lib/created-range';
import { inDateRange, matchesAnyOf, matchesSearch } from '@/lib/list-filter';
import { RowActions, RowActionButton } from '@/components/table';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { displayEmail } from '@erp71/shared-types';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { PageShell, Button, BranchFilter, ConfirmDialog, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import { useBranchScope } from '@/lib/branch-scope';

const IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'joining_date', label: 'Joining Date', required: false },
    { key: 'salary', label: 'Salary', required: false },
];

interface Employee {
    id: string;
    employee_code: string;
    name: string;
    phone: string;
    email?: string | null;
    nid?: string | null;
    date_of_joining?: string | null;
    department_id?: string | null;
    designation_id?: string | null;
    basic_salary?: string | number | null;
    status: string;
    created_at: string;
    department?: { id: string; name: string } | null;
    designation?: { id: string; name: string; code?: string | null } | null;
    user?: { id: string; email: string; name?: string | null; mobile?: string | null } | null;
    store_id?: string | null;
}

const EMPLOYEE_STATUSES = ['ACTIVE', 'PROBATION', 'INACTIVE', 'RESIGNED', 'TERMINATED', 'CONTRACT_ENDED'] as const;

const statusTones: Record<string, StatusBadgeTone> = {
    ACTIVE: 'success',
    PROBATION: 'info',
    TERMINATED: 'danger',
};

const statusLabel = (labels: Record<string, string>, status: string) => labels[status] ?? status;

/** Still on staff: Deactivate takes them off; anyone else is offered Activate. */
const ON_STAFF = new Set(['ACTIVE', 'PROBATION']);
/** The department and designation chips' value for an employee without one. */
const NONE = '__none__';

const columnHelper = createColumnHelper<Employee>();

export default function EmployeesPage() {
    const { t, locale } = useI18n();
    const branch = useBranchScope();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [formOpen, setFormOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Employee | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [statusTarget, setStatusTarget] = useState<Employee | null>(null);
    const [changingStatus, setChangingStatus] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [departmentIds, setDepartmentIds] = useState<string[]>([]);
    const [designationIds, setDesignationIds] = useState<string[]>([]);
    const [accessFilter, setAccessFilter] = useState<string | null>(null);
    const [joinedRange, setJoinedRange] = useState<CreatedRange | null>(null);
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);

    useEffect(() => {
        if (!branch.ready) return;
        void loadEmployees(branch.apiStoreId);
        // loadEmployees closes over nothing but the store id passed in.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch.ready, branch.apiStoreId]);

    const loadEmployees = async (storeId?: string) => {
        try {
            setEmployees(await api.getEmployees(storeId ? { storeId } : undefined));
        } catch (error) {
            console.error('Failed to load employees', error);
        } finally {
            setLoading(false);
        }
    };

    // The update answers with the row as the list reads it, so one employee's
    // change does not refetch the whole roster.
    const replaceRow = (updated: Employee) =>
        setEmployees((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));

    const openCreate = () => {
        setEditTarget(null);
        setFormOpen(true);
    };

    const openEdit = (employee: Employee) => {
        setEditTarget(employee);
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setEditTarget(null);
    };

    const handleSubmit = async (data: any) => {
        if (editTarget) {
            replaceRow(await api.updateEmployee(editTarget.id, data));
            toast.success(t.employees.detail.updateSuccess);
        } else {
            await api.createEmployee(data);
            void loadEmployees(branch.apiStoreId);
        }
    };

    const handleStatusChange = async () => {
        if (!statusTarget) return;
        const next = ON_STAFF.has(statusTarget.status) ? 'INACTIVE' : 'ACTIVE';
        setChangingStatus(true);
        try {
            replaceRow(await api.updateEmployee(statusTarget.id, { status: next }));
            toast.success(formatMessage(
                next === 'ACTIVE' ? t.employees.statusChange.activated : t.employees.statusChange.deactivated,
                { name: statusTarget.name },
            ));
        } catch (err: any) {
            toast.error(err?.message || t.employees.statusChange.failed);
        } finally {
            setChangingStatus(false);
            setStatusTarget(null);
        }
    };

    const columns: ColumnDef<Employee, any>[] = useMemo(
        () => [
            columnHelper.accessor('employee_code', {
                header: t.employees.columns.code,
                cell: (info) => info.getValue(),
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('name', {
                header: t.employees.columns.employee,
                cell: (info) => {
                    const emp = info.row.original;
                    return (
                        <>
                            <span className="block">{emp.name}</span>
                            <span className="block text-gray-500">{emp.phone}</span>
                        </>
                    );
                },
                size: 200,
            }),
            columnHelper.accessor((row) => row.department?.name ?? '', {
                id: 'department',
                header: t.employees.columns.department,
                cell: (info) => info.getValue() || '—',
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => (row.designation
                ? (row.designation.code ? `${row.designation.code} · ${row.designation.name}` : row.designation.name)
                : ''), {
                id: 'designation',
                header: t.employees.columns.designation,
                cell: (info) => info.getValue() || '—',
                size: 150,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('date_of_joining', {
                header: t.employees.columns.joined,
                // A timestamp: no typed text to match it against.
                enableColumnFilter: false,
                cell: (info) => (info.getValue() ? formatDate(info.getValue()!, locale) : '—'),
                size: 120,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor((row) => (row.user ? row.user.mobile ?? displayEmail(row.user.email) ?? row.phone : ''), {
                id: 'system_user',
                header: t.employees.columns.systemAccess,
                cell: (info) => {
                    const signsInWith = info.getValue();
                    return signsInWith
                        ? <StatusBadge tone="success">{signsInWith}</StatusBadge>
                        : <span className="text-gray-400">{t.employees.noAccess}</span>;
                },
                size: 180,
                meta: { hideOnMobile: true },
            }),
            columnHelper.accessor('status', {
                header: t.common.status,
                cell: (info) => {
                    const status = info.getValue();
                    return <StatusBadge tone={statusTones[status] ?? 'neutral'}>{statusLabel(t.employees.statuses, status)}</StatusBadge>;
                },
                size: 120,
            }),
            createdAtColumn(columnHelper, { header: t.common.createdAt, locale, enableColumnFilter: false }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => {
                    const emp = info.row.original;
                    const onStaff = ON_STAFF.has(emp.status);
                    return (
                        <RowActions>
                            <RowActionButton icon={<Eye />} label={t.common.view} href={`/hr/employees/${emp.id}`} />
                            <RowActionButton icon={<Pencil />} label={t.common.edit} onClick={() => openEdit(emp)} />
                            <RowActionButton
                                icon={onStaff ? <UserX /> : <UserCheck />}
                                label={onStaff ? t.employees.statusChange.deactivate : t.employees.statusChange.activate}
                                intent={onStaff ? 'warning' : 'success'}
                                onClick={() => setStatusTarget(emp)}
                            />
                        </RowActions>
                    );
                },
                enableSorting: false,
                enableColumnFilter: false,
                enableResizing: false,
                size: 110,
            }),
        ],
        [t, locale],
    );

    const departmentOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const e of employees) if (e.department) seen.set(e.department.id, e.department.name);
        return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    }, [employees]);

    const designationOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const e of employees) {
            if (e.designation) {
                seen.set(e.designation.id, e.designation.code ? `${e.designation.code} · ${e.designation.name}` : e.designation.name);
            }
        }
        return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    }, [employees]);

    // The whole roster is on the page, so the chips, the search and the strip
    // all narrow the same rows here.
    const filtered = useMemo(
        () => employees.filter((e) => {
            if (!matchesAnyOf(statusFilter, e.status, statusExclude)) return false;
            if (!matchesAnyOf(departmentIds, e.department?.id ?? NONE)) return false;
            if (!matchesAnyOf(designationIds, e.designation?.id ?? NONE)) return false;
            if (accessFilter === 'yes' && !e.user) return false;
            if (accessFilter === 'no' && e.user) return false;
            if (!inDateRange(e.date_of_joining, joinedRange)) return false;
            if (!inDateRange(e.created_at, createdRange)) return false;
            return matchesSearch(
                search,
                e.employee_code, e.name, e.phone, e.email, e.nid,
                e.department?.name, e.designation?.name, e.designation?.code,
            );
        }),
        [employees, statusFilter, statusExclude, departmentIds, designationIds, accessFilter, joinedRange, createdRange, search],
    );

    const filters = useMemo<ListFilter[]>(
        () => [
            {
                id: 'status',
                type: 'multi-select',
                label: t.common.status,
                value: statusFilter,
                onChange: setStatusFilter,
                exclude: { value: statusExclude, onChange: setStatusExclude },
                options: EMPLOYEE_STATUSES.map((value) => ({ value, label: statusLabel(t.employees.statuses, value) })),
            },
            {
                id: 'department',
                type: 'multi-select',
                label: t.employees.columns.department,
                value: departmentIds,
                onChange: setDepartmentIds,
                options: [{ value: NONE, label: t.hr.reports.common.unassigned }, ...departmentOptions],
            },
            {
                id: 'designation',
                type: 'multi-select',
                label: t.employees.columns.designation,
                value: designationIds,
                onChange: setDesignationIds,
                options: [{ value: NONE, label: t.hr.reports.common.unassigned }, ...designationOptions],
            },
            {
                id: 'joined',
                type: 'date-range',
                label: t.employees.columns.joined,
                value: joinedRange,
                onChange: setJoinedRange,
                operators: true,
            },
            {
                id: 'access',
                type: 'select',
                label: t.employees.columns.systemAccess,
                value: accessFilter,
                onChange: setAccessFilter,
                options: [
                    { value: 'yes', label: t.hr.listUi.hasAccess },
                    { value: 'no', label: t.employees.noAccess },
                ],
                more: true,
            },
            { id: 'created', type: 'date-range', value: createdRange, onChange: setCreatedRange, operators: true, more: true },
        ],
        [t, statusFilter, statusExclude, departmentIds, departmentOptions, designationIds, designationOptions, joinedRange, accessFilter, createdRange],
    );

    const stats = useMemo(() => {
        const copy = t.hr.listUi.employees;
        const count = (pick: (e: Employee) => boolean) => filtered.filter(pick).length.toLocaleString(locale);
        const left = filtered.filter((e) => !ON_STAFF.has(e.status)).length;
        const items: ListStat[] = [
            { id: 'count', icon: <Users aria-hidden />, label: copy.employees, value: filtered.length.toLocaleString(locale) },
            { id: 'active', icon: <UserCheck aria-hidden />, label: copy.active, value: count((e) => e.status === 'ACTIVE') },
            { id: 'probation', icon: <Clock aria-hidden />, label: copy.probation, value: count((e) => e.status === 'PROBATION') },
            {
                id: 'left',
                icon: <LogOut aria-hidden />,
                label: copy.left,
                value: left.toLocaleString(locale),
                tone: left > 0 ? 'warning' : 'default',
            },
            { id: 'access', icon: <KeyRound aria-hidden />, label: copy.systemAccess, value: count((e) => Boolean(e.user)) },
        ];
        return { items, loading, label: copy.statsLabel };
    }, [filtered, loading, locale, t]);

    const deactivating = statusTarget ? ON_STAFF.has(statusTarget.status) : false;

    return (
        <PageShell>
                <PageHeader
                    title={t.employees.title}
                    subtitle={t.employees.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.hr,
                        t.employees.title,
                        'hr',
                    )}
                    actions={(
                        <>
                            <BranchFilter scope={branch} />
                            <Button variant="secondary" icon={<Upload className="w-4 h-4" />} onClick={() => setImportOpen(true)}>
                                {t.common.import}
                            </Button>
                            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                                {t.employees.newEmployee}
                            </Button>
                        </>
                    )}
                />

                <EmployeeFormModal isOpen={formOpen} employee={editTarget} onClose={closeForm} onSubmit={handleSubmit} />

                <ImportDialog
                    open={importOpen}
                    onClose={() => setImportOpen(false)}
                    entityLabel="Employees"
                    fields={IMPORT_FIELDS}
                    importFn={(rows, mode) => api.importEmployees(rows, mode)}
                    onSuccess={() => void loadEmployees(branch.apiStoreId)}
                />

                <DataTable<Employee>
                    tableId="employees"
                    columns={columns}
                    data={filtered}
                    title={t.employees.title}
                    isLoading={loading}
                    emptyMessage={t.employees.emptyMessage}
                    emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.employees.searchPlaceholder}
                    searchValue={search}
                    onSearchChange={setSearch}
                    filters={filters}
                    filterLayout="row"
                    stats={stats}
                    enableColumnFilters={false}
                    viewOptions
                />

                <ConfirmDialog
                    open={statusTarget !== null}
                    title={deactivating ? t.employees.statusChange.deactivateTitle : t.employees.statusChange.activateTitle}
                    prompt={formatMessage(
                        deactivating ? t.employees.statusChange.deactivatePrompt : t.employees.statusChange.activatePrompt,
                        { name: statusTarget?.name ?? '' },
                    )}
                    confirmLabel={deactivating ? t.employees.statusChange.deactivate : t.employees.statusChange.activate}
                    cancelLabel={t.common.cancel}
                    loading={changingStatus}
                    danger={deactivating}
                    onConfirm={() => void handleStatusChange()}
                    onCancel={() => { if (!changingStatus) setStatusTarget(null); }}
                />
        </PageShell>
    );
}
