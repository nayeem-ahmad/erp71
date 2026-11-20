'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Unlink } from 'lucide-react';
import { api, type EmployeeLinkCandidate } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui';
import LinkCandidatePicker from '@/components/hr/LinkCandidatePicker';

export interface MemberEmployee {
    id: string;
    name: string;
    employeeCode: string;
}

/**
 * Which employee card a team member is, from the member's side.
 *
 * The same link the employee page makes, approached the other way round: here
 * the login is known and the card is being chosen. Linking and unlinking need
 * MANAGE_HR as well as the MANAGE_USERS this page already requires, so without
 * it the section only reports the link.
 */
export default function MemberEmployeeSection({
    userId,
    employee,
    canManageHr,
    onChanged,
}: {
    userId: string;
    employee: MemberEmployee | null;
    canManageHr: boolean;
    onChanged: () => void;
}) {
    const { t } = useI18n();
    const tl = t.employees.detail.linking;
    const [candidates, setCandidates] = useState<EmployeeLinkCandidate[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [unlinking, setUnlinking] = useState(false);

    useEffect(() => {
        if (employee || !canManageHr) return;
        setCandidates(null);
        setError(null);
        api.getEmployeeCandidates({ userId })
            .then((rows) => setCandidates(rows ?? []))
            .catch((err: any) => setError(err?.message || tl.loadFailed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, employee?.id, canManageHr]);

    const link = async (employeeId: string) => {
        setBusyId(employeeId);
        try {
            await api.linkEmployeeUser(employeeId, userId);
            toast.success(t.employees.detail.linkSuccess);
            onChanged();
        } catch (err: any) {
            toast.error(err?.message || t.employees.detail.linkFailed);
        } finally {
            setBusyId(null);
        }
    };

    const unlink = async () => {
        if (!employee) return;
        setUnlinking(true);
        try {
            await api.unlinkEmployeeUser(employee.id);
            toast.success(t.employees.detail.unlinkSuccess);
            onChanged();
        } catch (err: any) {
            toast.error(err?.message || t.employees.detail.unlinkFailed);
        } finally {
            setUnlinking(false);
        }
    };

    return (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
            <p className="text-sm font-semibold text-gray-900">{tl.employeeRecord}</p>
            {employee ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{employee.name}</p>
                        <p className="text-xs text-gray-500">{employee.employeeCode}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link
                            href={routes.hr.employeeDetail(employee.id)}
                            className="inline-flex min-h-touch items-center text-sm font-medium text-blue-600 hover:underline"
                        >
                            {tl.openEmployee}
                        </Link>
                        {canManageHr && (
                            <Button
                                type="button"
                                variant="ghost"
                                loading={unlinking}
                                onClick={unlink}
                                icon={<Unlink className="h-4 w-4" />}
                            >
                                {t.employees.detail.unlink}
                            </Button>
                        )}
                    </div>
                </div>
            ) : canManageHr ? (
                <div className="space-y-2">
                    <p className="text-sm text-gray-500">{tl.notLinked}</p>
                    <LinkCandidatePicker
                        rows={(candidates ?? []).map((row) => ({
                            id: row.employeeId,
                            primary: row.name,
                            secondary: [row.employeeCode, row.email, row.phone].filter(Boolean).join(' · '),
                            matches: row.matches,
                        }))}
                        loading={candidates === null && !error}
                        error={error}
                        hint={tl.employeePickerHint}
                        searchPlaceholder={tl.searchEmployees}
                        emptyText={tl.noEmployeeCandidates}
                        busyId={busyId}
                        onLink={link}
                    />
                </div>
            ) : (
                <div className="space-y-1">
                    <p className="text-sm text-gray-500">{tl.notLinked}</p>
                    <p className="text-xs text-gray-500">{tl.needsHrPermission}</p>
                </div>
            )}
        </div>
    );
}
