'use client';

import { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import AddEmployeeModal from './AddEmployeeModal';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { useI18n } from '@/lib/i18n';

interface Employee {
    id: string;
    employee_code: string;
    name: string;
    phone: string;
    email?: string | null;
    date_of_joining?: string | null;
    status: string;
    created_at: string;
    department?: { id: string; name: string } | null;
    designation?: { id: string; name: string } | null;
    user?: { id: string; email: string; name?: string | null } | null;
}

const columnHelper = createColumnHelper<Employee>();

export default function EmployeesPage() {
    const { t } = useI18n();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        loadEmployees();
    }, []);

    const loadEmployees = async () => {
        try {
            const data = await api.getEmployees();
            setEmployees(Array.isArray(data) ? data : (data?.items ?? []));
        } catch (error) {
            console.error('Failed to load employees', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async (data: any) => {
        await api.createEmployee(data);
        loadEmployees();
    };

    const columns: ColumnDef<Employee, any>[] = useMemo(
        () => [
            columnHelper.accessor('employee_code', {
                header: t.employees.columns.code,
                cell: (info) => <span className="text-sm font-mono text-gray-500">{info.getValue()}</span>,
                size: 120,
            }),
            columnHelper.accessor('name', {
                header: t.employees.columns.employee,
                cell: (info) => {
                    const emp = info.row.original;
                    return (
                        <div>
                            <span className="block text-sm font-black text-gray-900">{emp.name}</span>
                            <span className="block text-xs text-gray-400">{emp.phone}</span>
                        </div>
                    );
                },
                size: 200,
            }),
            columnHelper.accessor((row) => row.department?.name ?? '', {
                id: 'department',
                header: t.employees.columns.department,
                cell: (info) => <span className="text-sm text-gray-700">{info.getValue() || '—'}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.designation?.name ?? '', {
                id: 'designation',
                header: t.employees.columns.designation,
                cell: (info) => <span className="text-sm text-gray-700">{info.getValue() || '—'}</span>,
                size: 150,
            }),
            columnHelper.accessor('date_of_joining', {
                header: t.employees.columns.joined,
                cell: (info) => (
                    <span className="text-sm text-gray-600">
                        {info.getValue() ? formatDate(info.getValue()!) : '—'}
                    </span>
                ),
                size: 120,
            }),
            columnHelper.accessor((row) => row.user?.email ?? '', {
                id: 'system_user',
                header: t.employees.columns.systemAccess,
                cell: (info) => {
                    const val = info.getValue();
                    return val
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-bold text-green-700">{val}</span>
                        : <span className="text-xs text-gray-400">{t.employees.noAccess}</span>;
                },
                size: 180,
            }),
            columnHelper.accessor('status', {
                header: t.common.status,
                cell: (info) => {
                    const status = info.getValue();
                    const cls = status === 'ACTIVE'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-gray-100 text-gray-500 border-gray-200';
                    return (
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${cls}`}>
                            {status}
                        </span>
                    );
                },
                size: 100,
            }),
            columnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => (
                    <div className="flex items-center justify-end">
                        <Link
                            href={`/hr/employees/${info.row.original.id}`}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title={t.common.view}
                        >
                            <Eye className="w-4 h-4" />
                        </Link>
                    </div>
                ),
                enableSorting: false,
                size: 80,
            }),
        ],
        [t],
    );

    const filterPresets = useMemo(
        () => [
            { label: t.employees.filterPresets.active, filters: [{ id: 'status', value: 'ACTIVE' }] },
            { label: t.employees.filterPresets.inactive, filters: [{ id: 'status', value: 'INACTIVE' }] },
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.employees.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t.employees.subtitle}
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        {t.employees.newEmployee}
                    </button>
                </div>

                <AddEmployeeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onAdd={handleAdd} />

                <DataTable<Employee>
                    tableId="employees"
                    columns={columns}
                    data={employees}
                    title={t.employees.title}
                    isLoading={loading}
                    emptyMessage={t.employees.emptyMessage}
                    emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder={t.employees.searchPlaceholder}
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}
