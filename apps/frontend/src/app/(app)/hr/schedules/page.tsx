'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCog, CalendarDays, Clock, Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button, Field, Input, Select, FormFooter, Alert } from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import HolidayYearModal from './HolidayYearModal';

/**
 * Calendar & schedules — HRIS Phase 2.
 *
 * Nothing on this page is visible to an employee. It exists so attendance has a
 * baseline: without a schedule, "late" and "overtime" are both uncomputable,
 * and marking Eid means editing one row per employee per day.
 */

interface Holiday { id: string; date: string; name: string; }

interface ScheduleDay {
    weekday: number;
    is_working: boolean;
    start_minute: number | null;
    end_minute: number | null;
    break_minutes: number;
}

interface WorkSchedule {
    id: string;
    name: string;
    is_default: boolean;
    days: ScheduleDay[];
}

/** `540` ⇄ `"09:00"` — the input is a time field, the API speaks minutes. */
const toTimeValue = (minute: number | null): string => {
    if (minute == null) return '';
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
};
const fromTimeValue = (value: string): number | null => {
    if (!value) return null;
    const [hours, mins] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(mins)) return null;
    return hours * 60 + mins;
};

const blankDays = (): ScheduleDay[] =>
    Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        is_working: weekday <= 4,
        start_minute: weekday <= 4 ? 540 : null,
        end_minute: weekday <= 4 ? 1080 : null,
        break_minutes: weekday <= 4 ? 60 : 0,
    }));

export default function SchedulesPage() {
    const { t } = useI18n();
    const copy = t.workSchedules;
    const toast = useToastStore((state) => state.show);

    const [tab, setTab] = useState<'holidays' | 'schedules'>('holidays');
    const [year, setYear] = useState(new Date().getFullYear());
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [holidayModal, setHolidayModal] = useState<{ open: boolean; editing: Holiday | null }>({ open: false, editing: null });
    const [holidayForm, setHolidayForm] = useState({ date: '', name: '' });
    const [yearModal, setYearModal] = useState(false);
    const [scheduleModal, setScheduleModal] = useState<{ open: boolean; editing: WorkSchedule | null }>({ open: false, editing: null });
    const [scheduleForm, setScheduleForm] = useState<{ name: string; is_default: boolean; days: ScheduleDay[] }>({
        name: '', is_default: false, days: blankDays(),
    });
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const weekdayNames = useMemo(() => [
        copy.weekdays.sunday, copy.weekdays.monday, copy.weekdays.tuesday, copy.weekdays.wednesday,
        copy.weekdays.thursday, copy.weekdays.friday, copy.weekdays.saturday,
    ], [copy.weekdays]);

    /**
     * Anchored on today, not on the selected year: a window that slides with the
     * selection lets the user walk to 1997 one click at a time and never find
     * their way back.
     */
    const yearOptions = useMemo(() => {
        const thisYear = new Date().getFullYear();
        const nearby = [thisYear - 2, thisYear - 1, thisYear, thisYear + 1, thisYear + 2];
        return nearby.includes(year) ? nearby : [...nearby, year].sort((a, b) => a - b);
    }, [year]);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [days, scheds] = await Promise.all([api.getHolidays(year), api.getWorkSchedules()]);
            setHolidays(days ?? []);
            setSchedules(scheds ?? []);
        } catch (err: any) {
            setError(err?.message || copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [year, copy.loadFailed]);

    useEffect(() => { load(); }, [load]);

    // ── Holidays ──────────────────────────────────────────────────────────────

    const openHoliday = (editing: Holiday | null) => {
        setFormError('');
        setHolidayForm(editing
            ? { date: editing.date.slice(0, 10), name: editing.name }
            : { date: '', name: '' });
        setHolidayModal({ open: true, editing });
    };

    const saveHoliday = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');
        setSaving(true);
        try {
            if (holidayModal.editing) {
                await api.updateHoliday(holidayModal.editing.id, holidayForm);
                toast('success', copy.holidays.updated);
            } else {
                await api.createHoliday(holidayForm);
                toast('success', copy.holidays.created);
            }
            setHolidayModal({ open: false, editing: null });
            await load();
        } catch (err: any) {
            setFormError(err?.message || copy.holidays.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const removeHoliday = async (holiday: Holiday) => {
        if (!window.confirm(copy.holidays.deleteConfirm)) return;
        try {
            await api.deleteHoliday(holiday.id);
            toast('success', copy.holidays.deleted);
            await load();
        } catch (err: any) {
            toast('error', err?.message || copy.holidays.deleteFailed);
        }
    };

    // ── Schedules ─────────────────────────────────────────────────────────────

    const openSchedule = (editing: WorkSchedule | null) => {
        setFormError('');
        setScheduleForm(editing
            ? { name: editing.name, is_default: editing.is_default, days: editing.days.map((day) => ({ ...day })) }
            : { name: '', is_default: false, days: blankDays() });
        setScheduleModal({ open: true, editing });
    };

    const setDay = (weekday: number, patch: Partial<ScheduleDay>) => {
        setScheduleForm((prev) => ({
            ...prev,
            days: prev.days.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)),
        }));
    };

    const saveSchedule = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');
        setSaving(true);
        try {
            const payload = {
                name: scheduleForm.name,
                is_default: scheduleForm.is_default,
                // Blank the hours on a rest day before sending: the server does
                // this too, but a working day with no hours is a 400 and the
                // user should not have to discover that from the server.
                days: scheduleForm.days.map((day) => ({
                    weekday: day.weekday,
                    is_working: day.is_working,
                    start_minute: day.is_working ? day.start_minute : null,
                    end_minute: day.is_working ? day.end_minute : null,
                    break_minutes: day.is_working ? day.break_minutes : 0,
                })),
            };
            if (scheduleModal.editing) {
                await api.updateWorkSchedule(scheduleModal.editing.id, payload);
                toast('success', copy.schedules.updated);
            } else {
                await api.createWorkSchedule(payload);
                toast('success', copy.schedules.created);
            }
            setScheduleModal({ open: false, editing: null });
            await load();
        } catch (err: any) {
            setFormError(err?.message || copy.schedules.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const removeSchedule = async (schedule: WorkSchedule) => {
        if (!window.confirm(copy.schedules.deleteConfirm)) return;
        try {
            await api.deleteWorkSchedule(schedule.id);
            toast('success', copy.schedules.deleted);
            await load();
        } catch (err: any) {
            toast('error', err?.message || copy.schedules.deleteFailed);
        }
    };

    const weeklyHours = (schedule: WorkSchedule) => {
        const minutes = schedule.days.reduce((sum, day) => {
            if (!day.is_working || day.start_minute == null || day.end_minute == null) return sum;
            return sum + Math.max(0, day.end_minute - day.start_minute - day.break_minutes);
        }, 0);
        return Math.round((minutes / 60) * 10) / 10;
    };

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    copy.breadcrumb,
                    'hr',
                )}
            />

            {error && <Alert tone="danger">{error}</Alert>}

            <div className="flex gap-1 border-b border-gray-200">
                {([
                    ['holidays', copy.tabs.holidays, CalendarDays],
                    ['schedules', copy.tabs.schedules, Clock],
                ] as const).map(([key, label, Icon]) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setTab(key)}
                        className={`flex min-h-touch items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                            tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'
                        }`}
                    >
                        <Icon className="h-4 w-4" />
                        {label}
                    </button>
                ))}
            </div>

            {loading ? (
                <p className="py-8 text-center text-sm text-gray-500">…</p>
            ) : tab === 'holidays' ? (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Select
                                value={String(year)}
                                onChange={(e) => setYear(Number(e.target.value))}
                                className="w-32"
                                aria-label={copy.holidays.year.picker}
                            >
                                {yearOptions.map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                ))}
                            </Select>
                            <span className="text-xs text-gray-500">
                                {copy.holidays.year.count
                                    .replace('{count}', String(holidays.length))
                                    .replace('{year}', String(year))}
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="secondary" onClick={() => setYearModal(true)}>
                                <CalendarCog className="h-4 w-4" />
                                {copy.holidays.year.manage}
                            </Button>
                            <Button onClick={() => openHoliday(null)}>
                                <Plus className="h-4 w-4" />
                                {copy.holidays.add}
                            </Button>
                        </div>
                    </div>

                    <p className="text-xs text-gray-500">{copy.holidays.hint}</p>

                    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                        {holidays.length === 0 ? (
                            <p className="p-6 text-center text-sm text-gray-500">{copy.holidays.empty}</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                                    <tr>
                                        <th className="p-2 text-left font-medium">{copy.holidays.date}</th>
                                        <th className="p-2 text-left font-medium">{copy.holidays.name}</th>
                                        <th className="p-2" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {holidays.map((holiday) => (
                                        <tr key={holiday.id} className="border-b border-gray-100 last:border-0">
                                            <td className="p-2">{formatDate(holiday.date)}</td>
                                            <td className="p-2 font-medium text-gray-900">{holiday.name}</td>
                                            <td className="p-2 text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button variant="ghost" onClick={() => openHoliday(holiday)} aria-label={copy.holidays.editTitle}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="ghost" onClick={() => removeHoliday(holiday)} aria-label={copy.holidays.deleteConfirm}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center justify-end">
                        <Button onClick={() => openSchedule(null)}>
                            <Plus className="h-4 w-4" />
                            {copy.schedules.add}
                        </Button>
                    </div>

                    <p className="text-xs text-gray-500">{copy.schedules.hint}</p>

                    {schedules.length === 0 ? (
                        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                            {copy.schedules.empty}
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {schedules.map((schedule) => (
                                <div key={schedule.id} className="rounded-lg border border-gray-200 bg-white p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                                {schedule.name}
                                                {schedule.is_default && (
                                                    <span className="rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                                                        {copy.schedules.defaultBadge}
                                                    </span>
                                                )}
                                            </p>
                                            <p className="mt-0.5 text-xs text-gray-500">
                                                {copy.schedules.hoursPerWeek.replace('{hours}', String(weeklyHours(schedule)))}
                                            </p>
                                        </div>
                                        <div className="flex gap-1">
                                            <Button variant="ghost" onClick={() => openSchedule(schedule)} aria-label={copy.schedules.editTitle}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" onClick={() => removeSchedule(schedule)} aria-label={copy.schedules.deleteConfirm}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {schedule.days.map((day) => (
                                            <span
                                                key={day.weekday}
                                                className={`rounded-md border px-1.5 py-0.5 text-xs ${
                                                    day.is_working
                                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                        : 'border-gray-200 bg-gray-50 text-gray-400'
                                                }`}
                                            >
                                                {weekdayNames[day.weekday]?.slice(0, 3)}
                                                {day.is_working && ` ${toTimeValue(day.start_minute)}–${toTimeValue(day.end_minute)}`}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {yearModal && (
                <HolidayYearModal
                    year={year}
                    holidayCount={holidays.length}
                    onClose={() => setYearModal(false)}
                    onApplied={load}
                />
            )}

            {holidayModal.open && (
                <ModalShell size="sm" onBackdropClick={() => setHolidayModal({ open: false, editing: null })}>
                    <ModalHeader
                        title={holidayModal.editing ? copy.holidays.editTitle : copy.holidays.addTitle}
                        onClose={() => setHolidayModal({ open: false, editing: null })}
                    />
                    <form onSubmit={saveHoliday} className="space-y-3 p-4">
                        {formError && <Alert tone="danger">{formError}</Alert>}
                        <Field label={copy.holidays.date} htmlFor="holiday-date">
                            <Input
                                id="holiday-date"
                                type="date"
                                value={holidayForm.date}
                                onChange={(e) => setHolidayForm((prev) => ({ ...prev, date: e.target.value }))}
                                required
                            />
                        </Field>
                        <Field label={copy.holidays.name} htmlFor="holiday-name">
                            <Input
                                id="holiday-name"
                                value={holidayForm.name}
                                onChange={(e) => setHolidayForm((prev) => ({ ...prev, name: e.target.value }))}
                                placeholder={copy.holidays.namePlaceholder}
                                required
                            />
                        </Field>
                        <FormFooter>
                            <Button type="submit" disabled={saving}>{t.common.save}</Button>
                        </FormFooter>
                    </form>
                </ModalShell>
            )}

            {scheduleModal.open && (
                <ModalShell size="lg" onBackdropClick={() => setScheduleModal({ open: false, editing: null })}>
                    <ModalHeader
                        title={scheduleModal.editing ? copy.schedules.editTitle : copy.schedules.addTitle}
                        onClose={() => setScheduleModal({ open: false, editing: null })}
                    />
                    <form onSubmit={saveSchedule} className="space-y-3 p-4">
                        {formError && <Alert tone="danger">{formError}</Alert>}
                        <Field label={copy.schedules.name} htmlFor="schedule-name">
                            <Input
                                id="schedule-name"
                                value={scheduleForm.name}
                                onChange={(e) => setScheduleForm((prev) => ({ ...prev, name: e.target.value }))}
                                placeholder={copy.schedules.namePlaceholder}
                                required
                            />
                        </Field>

                        <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={scheduleForm.is_default}
                                onChange={(e) => setScheduleForm((prev) => ({ ...prev, is_default: e.target.checked }))}
                            />
                            {copy.schedules.isDefault}
                        </label>

                        <div className="space-y-2">
                            {scheduleForm.days.map((day) => (
                                <div key={day.weekday} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2">
                                    <label className="flex min-w-28 items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={day.is_working}
                                            onChange={(e) => setDay(day.weekday, {
                                                is_working: e.target.checked,
                                                ...(e.target.checked
                                                    ? { start_minute: day.start_minute ?? 540, end_minute: day.end_minute ?? 1080 }
                                                    : {}),
                                            })}
                                            aria-label={`${weekdayNames[day.weekday]} ${copy.schedules.working}`}
                                        />
                                        {weekdayNames[day.weekday]}
                                    </label>
                                    {day.is_working && (
                                        <>
                                            <Input
                                                type="time"
                                                className="w-32"
                                                value={toTimeValue(day.start_minute)}
                                                onChange={(e) => setDay(day.weekday, { start_minute: fromTimeValue(e.target.value) })}
                                                aria-label={`${weekdayNames[day.weekday]} ${copy.schedules.start}`}
                                            />
                                            <Input
                                                type="time"
                                                className="w-32"
                                                value={toTimeValue(day.end_minute)}
                                                onChange={(e) => setDay(day.weekday, { end_minute: fromTimeValue(e.target.value) })}
                                                aria-label={`${weekdayNames[day.weekday]} ${copy.schedules.end}`}
                                            />
                                            <Input
                                                type="number"
                                                min="0"
                                                className="w-24"
                                                value={String(day.break_minutes)}
                                                onChange={(e) => setDay(day.weekday, { break_minutes: Number(e.target.value) || 0 })}
                                                aria-label={`${weekdayNames[day.weekday]} ${copy.schedules.breakMinutes}`}
                                            />
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>

                        <FormFooter>
                            <Button type="submit" disabled={saving}>{t.common.save}</Button>
                        </FormFooter>
                    </form>
                </ModalShell>
            )}
        </PageShell>
    );
}
