'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { User, Phone, Mail, Calendar, Briefcase, LinkIcon, Unlink, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, StatusBadge, statusToneFor } from '@/components/ui';

interface Department { id: string; name: string; }
interface Designation { id: string; name: string; }

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
    user_id?: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    department?: Department | null;
    designation?: Designation | null;
    user?: { id: string; email: string; name?: string | null } | null;
}

export default function EmployeeDetailPage() {
    const { t } = useI18n();
    const params = useParams();
    const id = params.id as string;
    const [employee, setEmployee] = useState<Employee | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [departments, setDepartments] = useState<Department[]>([]);
    const [designations, setDesignations] = useState<Designation[]>([]);
    const [, setTenantUsers] = useState<any[]>([]);
    const [linkUserId, setLinkUserId] = useState('');
    const [linkLoading, setLinkLoading] = useState(false);

    const [form, setForm] = useState({
        name: '', phone: '', email: '', nid: '',
        date_of_joining: '', department_id: '', designation_id: '', basic_salary: '', status: 'ACTIVE',
    });

    useEffect(() => {
        Promise.all([
            api.getEmployee(id),
            api.getDepartments(),
            api.getDesignations(),
            fetchTenantUsers(),
        ]).then(([emp, depts, desigs]) => {
            setEmployee(emp);
            setDepartments(depts as Department[]);
            setDesignations(desigs as Designation[]);
            setForm({
                name: emp.name ?? '',
                phone: emp.phone ?? '',
                email: emp.email ?? '',
                nid: emp.nid ?? '',
                date_of_joining: emp.date_of_joining ? emp.date_of_joining.split('T')[0] : '',
                department_id: emp.department_id ?? '',
                designation_id: emp.designation_id ?? '',
                basic_salary: emp.basic_salary != null ? String(emp.basic_salary) : '',
                status: emp.status ?? 'ACTIVE',
            });
        }).catch(() => setError(t.employees.detail.loadFailed))
          .finally(() => setLoading(false));
    }, [id]);

    async function fetchTenantUsers() {
        try {
            // Get tenant users via the invitations/users context from auth/me
            const me = await api.getMe();
            const tenantId = typeof window !== 'undefined' ? localStorage.getItem('tenant_id') : null;
            const tenant = me?.tenants?.find((t: any) => t.id === tenantId) || me?.tenants?.[0];
            setTenantUsers(tenant?.users ?? []);
        } catch {
            // fallback: can't load users, link feature will be limited
        }
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            const payload: any = {
                name: form.name,
                phone: form.phone,
                status: form.status,
            };
            if (form.email) payload.email = form.email;
            if (form.nid) payload.nid = form.nid;
            if (form.date_of_joining) payload.date_of_joining = form.date_of_joining;
            if (form.department_id) payload.department_id = form.department_id;
            else payload.department_id = null;
            if (form.designation_id) payload.designation_id = form.designation_id;
            else payload.designation_id = null;
            payload.basic_salary = form.basic_salary !== '' ? Number(form.basic_salary) : null;

            const updated = await api.updateEmployee(id, payload);
            setEmployee(updated);
            setSuccess(t.employees.detail.updateSuccess);
        } catch (err: any) {
            setError(err.message || t.employees.detail.updateFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleLinkUser = async () => {
        if (!linkUserId) return;
        setLinkLoading(true);
        setError('');
        setSuccess('');
        try {
            const updated = await api.linkEmployeeUser(id, linkUserId);
            setEmployee(updated);
            setLinkUserId('');
            setSuccess(t.employees.detail.linkSuccess);
        } catch (err: any) {
            setError(err.message || t.employees.detail.linkFailed);
        } finally {
            setLinkLoading(false);
        }
    };

    const handleUnlinkUser = async () => {
        setLinkLoading(true);
        setError('');
        setSuccess('');
        try {
            const updated = await api.unlinkEmployeeUser(id);
            setEmployee(updated);
            setSuccess(t.employees.detail.unlinkSuccess);
        } catch (err: any) {
            setError(err.message || t.employees.detail.unlinkFailed);
        } finally {
            setLinkLoading(false);
        }
    };

    const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm({ ...form, [field]: e.target.value });

    if (loading) {
        return (
            <PageShell className="flex items-center justify-center">
                <p className="text-gray-400 font-semibold">{t.employees.detail.loading}</p>
            </PageShell>
        );
    }

    if (!employee) {
        return (
            <PageShell className="flex items-center justify-center">
                <p className="text-danger font-semibold">{t.employees.detail.notFound}</p>
            </PageShell>
        );
    }

    return (
        <PageShell>
            <div className="max-w-3xl mx-auto space-y-6">
                <PageHeader
                    title={employee.name}
                    subtitle={employee.employee_code}
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.hr,
                        'hr',
                        [{ label: t.employees.title, href: routes.hr.employees }],
                        employee.name,
                    )}
                />

                <div className="rounded-lg border border-gray-100 bg-white p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                        <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center text-white font-semibold text-sm uppercase shrink-0">
                            {employee.name.substring(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-base font-semibold text-gray-900">{employee.name}</p>
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                <StatusBadge tone={statusToneFor(employee.status)}>{employee.status}</StatusBadge>
                                <span className="text-xs text-gray-500">{employee.employee_code}</span>
                            </div>
                            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-xs text-gray-500">
                                <span>{t.employees.detail.department}: {employee.department?.name ?? '—'}</span>
                                <span>{t.employees.detail.designation}: {employee.designation?.name ?? '—'}</span>
                                <span>{t.employees.detail.joined}: {employee.date_of_joining ? formatDate(employee.date_of_joining) : '—'}</span>
                                <span>{t.employees.detail.added}: {formatDate(employee.created_at)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Alerts */}
                {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold border border-red-100">{error}</div>}
                {success && <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold border border-emerald-100">{success}</div>}

                {/* Edit form */}
                <form onSubmit={handleSave} className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm space-y-4">
                    <h2 className="text-sm font-semibold text-gray-900">{t.employees.detail.profile}</h2>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2 space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.detail.fullName}</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input required type="text" value={form.name} onChange={set('name')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-semibold focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.common.phone}</label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input required type="text" value={form.phone} onChange={set('phone')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-semibold focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.common.email}</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input type="email" value={form.email} onChange={set('email')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.detail.nationalId}</label>
                            <input type="text" value={form.nid} onChange={set('nid')}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm"
                                placeholder={t.employees.detail.nationalId} />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.detail.dateOfJoining}</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input type="date" value={form.date_of_joining} onChange={set('date_of_joining')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.detail.department}</label>
                            <div className="relative">
                                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <select value={form.department_id} onChange={set('department_id')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all appearance-none">
                                    <option value="">{t.common.none}</option>
                                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.detail.designation}</label>
                            <select value={form.designation_id} onChange={set('designation_id')}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all">
                                <option value="">{t.common.none}</option>
                                {designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.modal.basicSalary}</label>
                            <input type="number" min="0" step="0.01" value={form.basic_salary} onChange={set('basic_salary')}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                placeholder="0.00" />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.common.status}</label>
                            <select value={form.status} onChange={set('status')}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-semibold text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all">
                                <option value="ACTIVE">{t.employees.detail.active}</option>
                                <option value="INACTIVE">{t.employees.detail.inactive}</option>
                            </select>
                        </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                        <Button type="submit" variant="primary" loading={saving} icon={<Save className="w-4 h-4" />}>
                            {saving ? t.employees.detail.saving : t.employees.detail.saveChanges}
                        </Button>
                    </div>
                </form>

                {/* System access / User link */}
                <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm space-y-4">
                    <h2 className="text-sm font-semibold text-gray-900">{t.employees.detail.systemAccess}</h2>

                    {employee.user ? (
                        <div className="flex items-center justify-between p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                            <div>
                                <p className="text-sm font-semibold text-emerald-800">{employee.user.email}</p>
                                {employee.user.name && <p className="text-xs text-emerald-600 mt-0.5">{employee.user.name}</p>}
                            </div>
                            <button
                                onClick={handleUnlinkUser}
                                disabled={linkLoading}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-red-600 hover:bg-red-50 border border-red-200 transition-all disabled:opacity-50"
                            >
                                <Unlink className="w-4 h-4" />
                                Unlink
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-sm text-gray-500">{t.employees.detail.linkDescription}</p>
                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    value={linkUserId}
                                    onChange={(e) => setLinkUserId(e.target.value)}
                                    placeholder={t.employees.detail.pasteUserId}
                                    className="flex-1 bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-mono text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                />
                                <button
                                    onClick={handleLinkUser}
                                    disabled={!linkUserId || linkLoading}
                                    className="flex items-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm bg-blue-600 hover:bg-blue-700 text-white transition-all disabled:opacity-50"
                                >
                                    <LinkIcon className="w-4 h-4" />
                                    Link
                                </button>
                            </div>
                            <p className="text-xs text-gray-400">{t.employees.detail.linkTip}</p>
                        </div>
                    )}
                </div>
            </div>
        </PageShell>
    );
}
