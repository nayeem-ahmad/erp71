'use client';

import { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Eye } from 'lucide-react';
import { api } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import AddEmployeeModal from './AddEmployeeModal';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';

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
                header: 'Code',
                cell: (info) => <span className="text-sm font-mono text-gray-500">{info.getValue()}</span>,
                size: 120,
            }),
            columnHelper.accessor('name', {
                header: 'Employee',
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
                header: 'Department',
                cell: (info) => <span className="text-sm text-gray-700">{info.getValue() || '—'}</span>,
                size: 150,
            }),
            columnHelper.accessor((row) => row.designation?.name ?? '', {
                id: 'designation',
                header: 'Designation',
                cell: (info) => <span className="text-sm text-gray-700">{info.getValue() || '—'}</span>,
                size: 150,
            }),
            columnHelper.accessor('date_of_joining', {
                header: 'Joined',
                cell: (info) => (
                    <span className="text-sm text-gray-600">
                        {info.getValue() ? formatDate(info.getValue()!) : '—'}
                    </span>
                ),
                size: 120,
            }),
            columnHelper.accessor((row) => row.user?.email ?? '', {
                id: 'system_user',
                header: 'System Access',
                cell: (info) => {
                    const val = info.getValue();
                    return val
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-bold text-green-700">{val}</span>
                        : <span className="text-xs text-gray-400">Not linked</span>;
                },
                size: 180,
            }),
            columnHelper.accessor('status', {
                header: 'Status',
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
                header: 'Actions',
                cell: (info) => (
                    <div className="flex items-center justify-end">
                        <Link
                            href={`/dashboard/employees/${info.row.original.id}`}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title="View"
                        >
                            <Eye className="w-4 h-4" />
                        </Link>
                    </div>
                ),
                enableSorting: false,
                size: 80,
            }),
        ],
        [],
    );

    const filterPresets = useMemo(
        () => [
            { label: 'Active', filters: [{ id: 'status', value: 'ACTIVE' }] },
            { label: 'Inactive', filters: [{ id: 'status', value: 'INACTIVE' }] },
        ],
        [],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Employees</h1>
                        <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mt-0.5">
                            Staff directory and profiles
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        New Employee
                    </button>
                </div>

                <AddEmployeeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onAdd={handleAdd} />

                <DataTable<Employee>
                    tableId="employees"
                    columns={columns}
                    data={employees}
                    title="Employees"
                    isLoading={loading}
                    emptyMessage="No employees found"
                    emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
                    searchPlaceholder="Search by code, name, or phone..."
                    filterPresets={filterPresets}
                    enableRowSelection
                />
            </div>
        </div>
    );
}
