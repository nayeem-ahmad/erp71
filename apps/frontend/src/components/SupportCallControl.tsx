'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Phone, Video } from 'lucide-react';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import { Button } from '@/components/ui';
import { buttonClassName } from '@/components/ui/compact';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
    placeMeet71Call,
    type Meet71CallMode,
    type Meet71DialerDirectoryEntry,
} from '@/lib/meet71-dialer';
import { toast } from '@/lib/toast';
import { useVisibleInterval } from '@/hooks/useVisibleInterval';

const PRESENCE_POLL_MS = 10_000;

type AvailableMember = Meet71DialerDirectoryEntry & { online: true };

/**
 * Support-page Call control: not a separate sidebar app. Enabled when at least
 * one Meet71-allowlisted platform user is online in Meet71 so a call can ring
 * on their screen. Hidden when this account is not on the Meet71 list.
 */
export default function SupportCallControl() {
    const { t } = useI18n();
    const m = t.components.supportPage.call;

    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [directory, setDirectory] = useState<Meet71DialerDirectoryEntry[]>([]);
    const [online, setOnline] = useState<Set<string>>(new Set());
    const [pickerOpen, setPickerOpen] = useState(false);
    const [calling, setCalling] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [members, presence] = await Promise.all([
                api.getMeet71Directory() as Promise<Meet71DialerDirectoryEntry[]>,
                api.getMeet71Presence() as Promise<{ online?: string[] }>,
            ]);
            setAllowed(true);
            setDirectory(Array.isArray(members) ? members : []);
            const emails = Array.isArray(presence?.online) ? presence.online : [];
            setOnline(new Set(emails.map((email) => email.trim().toLowerCase())));
        } catch (error) {
            if (error instanceof ApiError && error.code === 'MEET71_NOT_ALLOWED') {
                setAllowed(false);
                setDirectory([]);
                setOnline(new Set());
                return;
            }
            // Keep the last good snapshot on transient presence/API failures;
            // first paint with an error still treats the control as eligible so
            // a later poll can recover.
            setAllowed((prev) => (prev === false ? false : true));
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    useVisibleInterval(() => {
        void load();
    }, allowed === false ? null : PRESENCE_POLL_MS);

    const available = useMemo<AvailableMember[]>(() => {
        return directory
            .filter((member) => online.has(member.email))
            .map((member) => ({ ...member, online: true as const }));
    }, [directory, online]);

    const anyoneAvailable = available.length > 0;

    async function handleCall(email: string, mode: Meet71CallMode) {
        setCalling(`${email}:${mode}`);
        try {
            await placeMeet71Call(email, mode);
            setPickerOpen(false);
        } catch (error) {
            toast.error((error as Error).message || m.callFailed);
        } finally {
            setCalling(null);
        }
    }

    if (allowed === false || allowed === null) return null;

    return (
        <>
            <button
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={!anyoneAvailable}
                title={anyoneAvailable ? m.availableHint : m.unavailableHint}
                aria-label={anyoneAvailable ? m.call : m.unavailable}
                className={`${buttonClassName({
                    variant: anyoneAvailable ? 'tinted' : 'secondary',
                    size: 'sm',
                })} ${anyoneAvailable ? '' : 'opacity-60'}`}
            >
                <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                        anyoneAvailable ? 'bg-emerald-500' : 'bg-gray-300'
                    }`}
                    aria-hidden="true"
                />
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                {m.call}
            </button>

            {pickerOpen ? (
                <ModalShell size="sm" onBackdropClick={() => setPickerOpen(false)}>
                    <ModalHeader title={m.pickerTitle} onClose={() => setPickerOpen(false)} />
                    <div className="space-y-3 p-4">
                        <p className="text-sm text-gray-600">{m.pickerSubtitle}</p>
                        {available.length === 0 ? (
                            <p className="text-sm text-gray-500">{m.unavailableHint}</p>
                        ) : (
                            <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
                                {available.map((member) => {
                                    const voiceBusy = calling === `${member.email}:voice`;
                                    const videoBusy = calling === `${member.email}:video`;
                                    return (
                                        <li
                                            key={member.email}
                                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-gray-900">
                                                    {member.displayName || member.email}
                                                </p>
                                                {member.displayName ? (
                                                    <p className="truncate text-xs text-gray-500">{member.email}</p>
                                                ) : null}
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="secondary"
                                                    disabled={Boolean(calling)}
                                                    onClick={() => void handleCall(member.email, 'voice')}
                                                >
                                                    <Phone className="me-1 h-3.5 w-3.5" />
                                                    {voiceBusy ? m.calling : m.voice}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    disabled={Boolean(calling)}
                                                    onClick={() => void handleCall(member.email, 'video')}
                                                >
                                                    <Video className="me-1 h-3.5 w-3.5" />
                                                    {videoBusy ? m.calling : m.video}
                                                </Button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </ModalShell>
            ) : null}
        </>
    );
}
