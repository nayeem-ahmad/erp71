'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { User, Phone, Mail, Calendar, Briefcase, KeyRound, LinkIcon, Unlink, Save } from 'lucide-react';
import { api, type EmployeeLoginState } from '@/lib/api';
import { displayEmail } from '@erp71/shared-types';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Alert, Button, Input, StatusBadge, statusToneFor } from '@/components/ui';
import { getWorkspaceItem } from '@/lib/session-store';
import LoginCredentialsModal, { type LoginCredentials } from './LoginCredentialsModal';

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
    portal_access?: boolean;
    user_id?: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    department?: Department | null;
    designation?: Designation | null;
    user?: {
        id: string;
        email: string;
        name?: string | null;
        /** What they sign in with. Null for an account created before mobile sign-in. */
        mobile?: string | null;
        must_change_password?: boolean;
    } | null;
}

export default function EmployeeDetailPage() {
    const { t } = useI18n();
    const params = useParams();
    const id = params.id as string;
    const [employee, setEmployee] = useState<Employee | null>(null);
    const [canSeeSalary, setCanSeeSalary] = useState(false);
    const [portalLoading, setPortalLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [departments, setDepartments] = useState<Department[]>([]);
    const [designations, setDesignations] = useState<Designation[]>([]);
    const [, setTenantUsers] = useState<any[]>([]);
    const [linkUserId, setLinkUserId] = useState('');
    const [linkLoading, setLinkLoading] = useState(false);
    const [loginLoading, setLoginLoading] = useState(false);
    const [showLinkExisting, setShowLinkExisting] = useState(false);
    const [credentials, setCredentials] = useState<(LoginCredentials & { mode: 'created' | 'reset' }) | null>(null);
    const [loginState, setLoginState] = useState<EmployeeLoginState | null>(null);

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
            // The API omits `basic_salary` entirely for a viewer without
            // VIEW_PAYROLL — absent means "not allowed to see", where null
            // means "none recorded". Hide the field rather than render an empty
            // box the user cannot meaningfully fill.
            setCanSeeSalary('basic_salary' in (emp as Record<string, unknown>));
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
            const tenantId = typeof window !== 'undefined' ? getWorkspaceItem('tenant_id') : null;
            const tenant = me?.tenants?.find((t: any) => t.id === tenantId) || me?.tenants?.[0];
            setTenantUsers(tenant?.users ?? []);
        } catch {
            // fallback: can't load users, link feature will be limited
        }
    }

    // `loginState` is whatever the last login call reported; before any of them
    // has run, the employee row is the only source. Reading the two in that order
    // means the panel updates in place after a create, reset or revoke rather
    // than showing stale values until the page is loaded again — in particular
    // `hasLogin`, without which the panel would still offer to create the login
    // that was just created.
    const hasLogin = loginState?.has_login ?? !!employee?.user;
    const signInIdentifier = loginState?.sign_in_identifier ?? employee?.user?.mobile ?? null;
    const mustChangePassword = loginState?.must_change_password ?? employee?.user?.must_change_password ?? false;
    const portalAccess = loginState?.portal_access ?? employee?.portal_access ?? false;

    const handleTogglePortalAccess = async () => {
        if (!employee) return;
        setPortalLoading(true);
        setError('');
        try {
            // Turning access off goes through the login revoke, because that is
            // the one that also ends the session — without it the employee keeps
            // a working token until it expires, and `EmployeeGuard` would refuse
            // them while the rest of the API still accepted it. Safe for an
            // employee linked to a staff account too: the server only signs out
            // an account whose access *was* the portal, so revoking an owner's
            // payslip screen does not sign them out of the ERP.
            const updated = portalAccess
                ? await api.revokeEmployeeLogin(id)
                : await api.grantEmployeePortalAccess(id);
            // The endpoint returns only the access fields, so merge rather than
            // replace — replacing would blank the rest of the profile on screen.
            setEmployee((prev) => (prev ? { ...prev, portal_access: updated.portal_access } : prev));
            // `portalAccess` prefers `loginState` when one is present, so this
            // has to move that too or the badge keeps reporting whatever the
            // last login call said.
            setLoginState((prev) => (prev ? { ...prev, portal_access: updated.portal_access } : prev));
            setSuccess(updated.portal_access
                ? t.employeePortal.access.enabled
                : t.employeePortal.access.disabled);
        } catch (err: any) {
            setError(err?.message || t.employeePortal.access.failed);
        } finally {
            setPortalLoading(false);
        }
    };

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
            // Only send the salary if this user can see it. The server drops it
            // from an unpermitted caller anyway; not sending it keeps the
            // request honest rather than relying on that.
            if (canSeeSalary) {
                payload.basic_salary = form.basic_salary !== '' ? Number(form.basic_salary) : null;
            }

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

    /**
     * Provision a login for an employee who has no ERP account.
     *
     * The response carries the generated password and is the only time it can be
     * read, so it goes straight into the modal and is never put in component
     * state that outlives it — `credentials` is cleared on dismiss.
     */
    const handleCreateLogin = async () => {
        setLoginLoading(true);
        setError('');
        setSuccess('');
        try {
            const result = await api.createEmployeeLogin(id);
            setLoginState(result);
            setCredentials({
                mode: 'created',
                sign_in_identifier: result.sign_in_identifier,
                password: result.password,
            });
        } catch (err: any) {
            setError(err?.message || t.employeePortal.login.createFailed);
        } finally {
            setLoginLoading(false);
        }
    };

    const handleResetLoginPassword = async () => {
        setLoginLoading(true);
        setError('');
        setSuccess('');
        try {
            const result = await api.resetEmployeeLoginPassword(id);
            setLoginState(result);
            setCredentials({
                mode: 'reset',
                sign_in_identifier: result.sign_in_identifier,
                password: result.password,
            });
        } catch (err: any) {
            setError(err?.message || t.employeePortal.login.resetFailed);
        } finally {
            setLoginLoading(false);
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
                                <User className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input required type="text" value={form.name} onChange={set('name')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 ps-10 pe-4 font-semibold focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.common.phone}</label>
                            <div className="relative">
                                <Phone className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input required type="text" value={form.phone} onChange={set('phone')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 ps-10 pe-4 font-semibold focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.common.email}</label>
                            <div className="relative">
                                <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input type="email" value={form.email} onChange={set('email')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 ps-10 pe-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" />
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
                                <Calendar className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input type="date" value={form.date_of_joining} onChange={set('date_of_joining')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 ps-10 pe-4 font-bold text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.detail.department}</label>
                            <div className="relative">
                                <Briefcase className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <select value={form.department_id} onChange={set('department_id')}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 ps-10 pe-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all appearance-none">
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

                        {canSeeSalary && (
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.employees.modal.basicSalary}</label>
                            <input type="number" min="0" step="0.01" value={form.basic_salary} onChange={set('basic_salary')}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-bold text-gray-600 text-sm focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
                                placeholder="0.00" />
                        </div>
                        )}

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

                {/*
                  * System access.
                  *
                  * Three states, and the order matters: an employee with no
                  * account at all gets one button, because minting a login is
                  * the answer for nearly everyone. Linking an existing user is
                  * the exception — someone who already works here in another
                  * capacity — so it is behind a disclosure rather than sitting
                  * next to the common case as an equal choice.
                  */}
                <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm space-y-4">
                    <h2 className="text-sm font-semibold text-gray-900">{t.employees.detail.systemAccess}</h2>

                    {hasLogin ? (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 space-y-0.5">
                                    <p className="text-sm font-semibold text-gray-900">
                                        {signInIdentifier ?? displayEmail(employee.user?.email) ?? employee.phone}
                                    </p>
                                    <p className="text-xs text-gray-500">{t.employeePortal.login.signsInWith}</p>
                                </div>
                                <StatusBadge tone={portalAccess ? 'success' : 'neutral'}>
                                    {portalAccess ? t.employeePortal.access.on : t.employeePortal.access.off}
                                </StatusBadge>
                            </div>

                            {mustChangePassword && (
                                <Alert tone="info">{t.employeePortal.login.pendingPasswordChange}</Alert>
                            )}

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant={portalAccess ? 'danger' : 'primary'}
                                    loading={portalLoading || loginLoading}
                                    onClick={handleTogglePortalAccess}
                                >
                                    {portalAccess
                                        ? t.employeePortal.access.revoke
                                        : t.employeePortal.access.grant}
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    loading={loginLoading}
                                    onClick={handleResetLoginPassword}
                                    icon={<KeyRound className="w-4 h-4" />}
                                >
                                    {t.employeePortal.login.resetPassword}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    loading={linkLoading}
                                    onClick={handleUnlinkUser}
                                    icon={<Unlink className="w-4 h-4" />}
                                >
                                    {t.employees.detail.unlink}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-sm text-gray-500">{t.employeePortal.login.noneDescription}</p>
                            <Button
                                type="button"
                                variant="primary"
                                loading={loginLoading}
                                onClick={handleCreateLogin}
                                icon={<KeyRound className="w-4 h-4" />}
                            >
                                {t.employeePortal.login.create}
                            </Button>

                            <div className="border-t border-gray-100 pt-3">
                                <button
                                    type="button"
                                    onClick={() => setShowLinkExisting((open) => !open)}
                                    className="text-xs font-medium text-blue-600 hover:underline"
                                >
                                    {t.employeePortal.login.linkExisting}
                                </button>

                                {showLinkExisting && (
                                    <div className="mt-3 space-y-2">
                                        <p className="text-sm text-gray-500">{t.employees.detail.linkDescription}</p>
                                        <div className="flex flex-wrap gap-2">
                                            <Input
                                                type="text"
                                                value={linkUserId}
                                                onChange={(e) => setLinkUserId(e.target.value)}
                                                placeholder={t.employees.detail.pasteUserId}
                                                className="flex-1 font-mono"
                                            />
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                disabled={!linkUserId}
                                                loading={linkLoading}
                                                onClick={handleLinkUser}
                                                icon={<LinkIcon className="w-4 h-4" />}
                                            >
                                                {t.employees.detail.link}
                                            </Button>
                                        </div>
                                        <p className="text-xs text-gray-400">{t.employees.detail.linkTip}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {credentials && (
                <LoginCredentialsModal
                    credentials={credentials}
                    mode={credentials.mode}
                    employeeName={employee.name}
                    onClose={() => setCredentials(null)}
                />
            )}
        </PageShell>
    );
}
