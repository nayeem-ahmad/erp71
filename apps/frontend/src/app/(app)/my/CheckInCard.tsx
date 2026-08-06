'use client';

import { useState } from 'react';
import { LogIn, LogOut, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import { Button, Alert } from '@/components/ui';

export interface TodayState {
    date: string;
    record: { clock_in?: string | null; clock_out?: string | null; status?: string } | null;
    isHoliday: boolean;
    isWorkingDay: boolean;
    scheduledStartMinute: number | null;
    scheduledEndMinute: number | null;
    selfServiceEnabled: boolean;
    geofenceEnabled: boolean;
}

/**
 * The check-in button — the one thing on the portal an employee touches daily.
 *
 * Location is requested only when the tenant has geofencing on. Asking for it
 * unconditionally would train people to dismiss the browser prompt, and the
 * server ignores coordinates it did not ask for anyway.
 */
export default function CheckInCard({
    today,
    onChanged,
}: {
    today: TodayState | null;
    onChanged: () => void | Promise<void>;
}) {
    const { t } = useI18n();
    const copy = t.employeePortal.checkIn;
    const toast = useToastStore((state) => state.show);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    if (!today) return null;

    const clockedIn = Boolean(today.record?.clock_in);
    const clockedOut = Boolean(today.record?.clock_out);

    const formatTime = (iso?: string | null) =>
        iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

    /**
     * Resolve a position, or explain why not.
     *
     * Rejects rather than falling back to a check-in without coordinates: with
     * geofencing on, a silent fallback would be a hole straight through it.
     */
    const getPosition = (): Promise<{ latitude: number; longitude: number }> =>
        new Promise((resolve, reject) => {
            if (!('geolocation' in navigator)) {
                reject(new Error(copy.noGeolocation));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (position) => resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                }),
                () => reject(new Error(copy.locationDenied)),
                { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
            );
        });

    const run = async (action: 'in' | 'out') => {
        setBusy(true);
        setError('');
        try {
            const location = today.geofenceEnabled ? await getPosition() : undefined;
            if (action === 'in') {
                await api.checkIn(location);
                toast('success', copy.checkedIn);
            } else {
                await api.checkOut(location);
                toast('success', copy.checkedOut);
            }
            await onChanged();
        } catch (err: any) {
            setError(err?.message || copy.failed);
        } finally {
            setBusy(false);
        }
    };

    const unavailableReason = !today.selfServiceEnabled
        ? copy.selfServiceOff
        : today.isHoliday
            ? copy.holiday
            : !today.isWorkingDay
                ? copy.restDay
                : null;

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{copy.title}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                        {copy.in}: {formatTime(today.record?.clock_in)} · {copy.out}: {formatTime(today.record?.clock_out)}
                    </p>
                </div>

                {unavailableReason ? (
                    // Say why, rather than hiding the control — a missing button
                    // reads as a broken app.
                    <span className="text-xs text-gray-500">{unavailableReason}</span>
                ) : clockedOut ? (
                    <span className="text-xs font-medium text-emerald-700">{copy.doneForToday}</span>
                ) : (
                    <Button
                        onClick={() => run(clockedIn ? 'out' : 'in')}
                        disabled={busy}
                        variant={clockedIn ? 'secondary' : 'primary'}
                        className="min-h-touch"
                    >
                        {clockedIn ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                        {clockedIn ? copy.checkOut : copy.checkIn}
                    </Button>
                )}
            </div>

            {today.geofenceEnabled && !unavailableReason && (
                <p className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                    <MapPin className="h-3 w-3" />
                    {copy.locationRequired}
                </p>
            )}

            {error && <div className="mt-2"><Alert tone="danger">{error}</Alert></div>}
        </div>
    );
}
