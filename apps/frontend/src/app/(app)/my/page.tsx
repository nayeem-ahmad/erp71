'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarOff, Wallet, LayoutDashboard, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button, Field, Input, Select, FormFooter, Alert } from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import CheckInCard, { type TodayState } from './CheckInCard';

/**
 * Employee self-service. Phase 1 of the HRIS plan.
 *
 * One page with tabs rather than four routes: this is the screen an employee
 * opens on a phone, and a tab strip beats a back button for four small views.
 * Everything here reads `/employee-portal/*`, which resolves the employee from
 * the token — the client never sends an employee id, so there is nothing here
 * to scope or filter by.
 */

type Tab = 'overview' | 'attendance' | 'leave' | 'pay';

interface Profile {
    id: string;
    name: string;
    employee_code: string;
    department?: { id: string; name: string } | null;
    designation?: { id: string; name: string } | null;
}

interface AttendanceRecord {
    id: string;
    date: string;
    status: string;
    clock_in?: string | null;
    clock_out?: string | null;
}

interface LeaveBalance {
    leave_type_id: string;
    leave_type: string | null;
    total_days: number;
    used_days: number;
    remaining_days: number;
}

interface LeaveRequest {
    id: string;
    start_date: string;
    end_date: string;
    days: number;
    status: string;
    reason?: string | null;
    leave_type?: { id: string; name: string } | null;
}

interface SalaryPayment {
    id: string;
    amount: string | number;
    pay_period: string;
    payment_date: string;
    payment_method: string;
}

const STATUS_COLORS: Record<string, string> = {
    PRESENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ABSENT: 'bg-red-50 text-red-700 border-red-200',
    HALF_DAY: 'bg-amber-50 text-amber-700 border-amber-200',
    HOLIDAY: 'bg-gray-100 text-gray-500 border-gray-200',
    PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
    APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REJECTED: 'bg-red-50 text-red-700 border-red-200',
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-200',
};

const EMPTY_LEAVE_FORM = { leave_type_id: '', start_date: '', end_date: '', days: '', reason: '' };

function StatusPill({ status }: { status: string }) {
    return (
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
            {status.replace('_', ' ')}
        </span>
    );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
        </div>
    );
}

export default function MyWorkspacePage() {
    const { t } = useI18n();
    const copy = t.employeePortal;
    const toast = useToastStore((state) => state.show);

    const [tab, setTab] = useState<Tab>('overview');
    const [profile, setProfile] = useState<Profile | null>(null);
    const [summary, setSummary] = useState<any>(null);
    const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [payments, setPayments] = useState<SalaryPayment[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<{ id: string; name: string }[]>([]);
    const [today, setToday] = useState<TodayState | null>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [applyOpen, setApplyOpen] = useState(false);
    const [form, setForm] = useState({ ...EMPTY_LEAVE_FORM });
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [me, sum, att, bal, reqs, pays, todayState] = await Promise.all([
                api.getMyProfile(),
                api.getMySummary(),
                api.getMyAttendance(),
                api.getMyLeaveBalances(),
                api.getMyLeaveRequests(),
                api.getMySalaryPayments(),
                api.getMyToday(),
            ]);
            setProfile(me.employee);
            setToday(todayState);
            setSummary(sum);
            setAttendance(att.records ?? []);
            setBalances(bal ?? []);
            setRequests(reqs ?? []);
            setPayments(pays ?? []);
        } catch (err: any) {
            setError(err?.message || copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [copy.loadFailed]);

    useEffect(() => { load(); }, [load]);

    /**
     * The leave-type list comes from the staff endpoint, which an employee has
     * no permission for — so the picker is built from the balances HR has
     * already set for them. An employee with no balances cannot apply, which is
     * the correct outcome: there is nothing to draw down.
     */
    useEffect(() => {
        setLeaveTypes(
            balances
                .filter((balance) => balance.leave_type)
                .map((balance) => ({ id: balance.leave_type_id, name: balance.leave_type as string })),
        );
    }, [balances]);

    const totalRemaining = useMemo(
        () => balances.reduce((sum, balance) => sum + balance.remaining_days, 0),
        [balances],
    );

    const set = (key: keyof typeof EMPTY_LEAVE_FORM) =>
        (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
            setForm((prev) => ({ ...prev, [key]: e.target.value }));

    const submitLeave = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');
        if (!form.leave_type_id || !form.start_date || !form.end_date || !form.days) {
            setFormError(copy.leave.applyFailed);
            return;
        }
        setSubmitting(true);
        try {
            await api.applyForLeave({
                leave_type_id: form.leave_type_id,
                start_date: form.start_date,
                end_date: form.end_date,
                days: Number(form.days),
                reason: form.reason || undefined,
            });
            toast('success', copy.leave.applied);
            setApplyOpen(false);
            setForm({ ...EMPTY_LEAVE_FORM });
            await load();
        } catch (err: any) {
            setFormError(err?.message || copy.leave.applyFailed);
        } finally {
            setSubmitting(false);
        }
    };

    const withdraw = async (id: string) => {
        if (!window.confirm(copy.leave.cancelConfirm)) return;
        try {
            await api.cancelMyLeaveRequest(id);
            toast('success', copy.leave.cancelled);
            await load();
        } catch (err: any) {
            toast('error', err?.message || copy.leave.cancelFailed);
        }
    };

    const tabs: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
        { key: 'overview', label: copy.tabs.overview, icon: LayoutDashboard },
        { key: 'attendance', label: copy.tabs.attendance, icon: CalendarCheck },
        { key: 'leave', label: copy.tabs.leave, icon: CalendarOff },
        { key: 'pay', label: copy.tabs.pay, icon: Wallet },
    ];

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={profile ? copy.subtitle.replace('{name}', profile.name) : undefined}
            />

            {error && <Alert tone="danger">{error}</Alert>}

            <div className="flex gap-1 overflow-x-auto border-b border-gray-200">
                {tabs.map(({ key, label, icon: Icon }) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setTab(key)}
                        className={`flex min-h-touch items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                            tab === key
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        <Icon className="h-4 w-4" />
                        {label}
                    </button>
                ))}
            </div>

            {loading ? (
                <p className="py-8 text-center text-sm text-gray-500">…</p>
            ) : (
                <>
                    {tab === 'overview' && (
                        <div className="space-y-4">
                            <CheckInCard today={today} onChanged={load} />
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                <StatTile label={copy.summary.presentDays} value={summary?.attendance?.summary?.PRESENT ?? 0} />
                                <StatTile label={copy.summary.absentDays} value={summary?.attendance?.summary?.ABSENT ?? 0} />
                                <StatTile label={copy.summary.halfDays} value={summary?.attendance?.summary?.HALF_DAY ?? 0} />
                                <StatTile label={copy.summary.leaveBalance} value={totalRemaining} />
                            </div>
                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                                <p className="text-xs text-gray-500">{copy.summary.pendingRequests}</p>
                                <p className="mt-1 text-lg font-semibold text-gray-900">
                                    {summary?.pendingLeaveRequests ?? 0}
                                </p>
                            </div>
                        </div>
                    )}

                    {tab === 'attendance' && (
                        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                            {attendance.length === 0 ? (
                                <p className="p-6 text-center text-sm text-gray-500">{copy.attendance.empty}</p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                                        <tr>
                                            <th className="p-2 text-start font-medium">{copy.attendance.date}</th>
                                            <th className="p-2 text-start font-medium">{copy.attendance.status}</th>
                                            <th className="hidden p-2 text-start font-medium md:table-cell">{copy.attendance.clockIn}</th>
                                            <th className="hidden p-2 text-start font-medium md:table-cell">{copy.attendance.clockOut}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {attendance.map((record) => (
                                            <tr key={record.id} className="border-b border-gray-100 last:border-0">
                                                <td className="p-2">{formatDate(record.date)}</td>
                                                <td className="p-2"><StatusPill status={record.status} /></td>
                                                <td className="hidden p-2 text-gray-600 md:table-cell">
                                                    {record.clock_in ? new Date(record.clock_in).toLocaleTimeString() : '—'}
                                                </td>
                                                <td className="hidden p-2 text-gray-600 md:table-cell">
                                                    {record.clock_out ? new Date(record.clock_out).toLocaleTimeString() : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}

                    {tab === 'leave' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm font-semibold text-gray-900">{copy.leave.balances}</h2>
                                <Button
                                    onClick={() => setApplyOpen(true)}
                                    disabled={leaveTypes.length === 0}
                                >
                                    <Plus className="h-4 w-4" />
                                    {copy.leave.apply}
                                </Button>
                            </div>

                            {balances.length === 0 ? (
                                <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                                    {copy.leave.noBalances}
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                    {balances.map((balance) => (
                                        <div key={balance.leave_type_id} className="rounded-lg border border-gray-200 bg-white p-3">
                                            <p className="text-xs text-gray-500">{balance.leave_type}</p>
                                            <p className="mt-1 text-lg font-semibold text-gray-900">
                                                {balance.remaining_days}
                                                <span className="ms-1 text-xs font-normal text-gray-500">
                                                    {copy.leave.of} {balance.total_days} {copy.leave.remaining}
                                                </span>
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <h2 className="text-sm font-semibold text-gray-900">{copy.leave.requests}</h2>
                            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                                {requests.length === 0 ? (
                                    <p className="p-6 text-center text-sm text-gray-500">{copy.leave.empty}</p>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                                            <tr>
                                                <th className="p-2 text-start font-medium">{copy.leave.type}</th>
                                                <th className="p-2 text-start font-medium">{copy.leave.from}</th>
                                                <th className="hidden p-2 text-start font-medium md:table-cell">{copy.leave.to}</th>
                                                <th className="p-2 text-start font-medium">{copy.leave.days}</th>
                                                <th className="p-2 text-start font-medium">{copy.attendance.status}</th>
                                                <th className="p-2" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {requests.map((req) => (
                                                <tr key={req.id} className="border-b border-gray-100 last:border-0">
                                                    <td className="p-2">{req.leave_type?.name ?? '—'}</td>
                                                    <td className="p-2">{formatDate(req.start_date)}</td>
                                                    <td className="hidden p-2 md:table-cell">{formatDate(req.end_date)}</td>
                                                    <td className="p-2">{req.days}</td>
                                                    <td className="p-2"><StatusPill status={req.status} /></td>
                                                    <td className="p-2 text-end">
                                                        {req.status === 'PENDING' && (
                                                            <Button variant="ghost" onClick={() => withdraw(req.id)}>
                                                                {copy.leave.cancel}
                                                            </Button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    )}

                    {tab === 'pay' && (
                        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                            {payments.length === 0 ? (
                                <p className="p-6 text-center text-sm text-gray-500">{copy.pay.empty}</p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                                        <tr>
                                            <th className="p-2 text-start font-medium">{copy.pay.period}</th>
                                            <th className="p-2 text-start font-medium">{copy.pay.paidOn}</th>
                                            <th className="p-2 text-end font-medium">{copy.pay.amount}</th>
                                            <th className="hidden p-2 text-start font-medium md:table-cell">{copy.pay.method}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {payments.map((payment) => (
                                            <tr key={payment.id} className="border-b border-gray-100 last:border-0">
                                                <td className="p-2">{payment.pay_period}</td>
                                                <td className="p-2">{formatDate(payment.payment_date)}</td>
                                                <td className="p-2 text-end font-medium">{formatBDT(Number(payment.amount))}</td>
                                                <td className="hidden p-2 text-gray-600 md:table-cell">{payment.payment_method}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                </>
            )}

            {applyOpen && (
            <ModalShell size="sm" onBackdropClick={() => setApplyOpen(false)}>
                <ModalHeader title={copy.leave.applyTitle} onClose={() => setApplyOpen(false)} />
                <form onSubmit={submitLeave} className="space-y-3 p-4">
                    {formError && <Alert tone="danger">{formError}</Alert>}
                    <Field label={copy.leave.type}>
                        <Select value={form.leave_type_id} onChange={set('leave_type_id')} required>
                            <option value="">—</option>
                            {leaveTypes.map((type) => (
                                <option key={type.id} value={type.id}>{type.name}</option>
                            ))}
                        </Select>
                    </Field>
                    <Field label={copy.leave.from}>
                        <Input type="date" value={form.start_date} onChange={set('start_date')} required />
                    </Field>
                    <Field label={copy.leave.to}>
                        <Input type="date" value={form.end_date} onChange={set('end_date')} required />
                    </Field>
                    <Field label={copy.leave.days}>
                        <Input type="number" min="0.5" step="0.5" value={form.days} onChange={set('days')} required />
                    </Field>
                    <Field label={copy.leave.reason}>
                        <Input value={form.reason} onChange={set('reason')} placeholder={copy.leave.reasonPlaceholder} />
                    </Field>
                    <FormFooter>
                        <Button type="submit" disabled={submitting}>{copy.leave.submit}</Button>
                    </FormFooter>
                </form>
            </ModalShell>
            )}
        </PageShell>
    );
}
