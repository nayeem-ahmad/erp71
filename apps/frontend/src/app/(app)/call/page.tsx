'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Phone, Video } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Button, PageShell } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
    placeMeet71Call,
    type Meet71CallMode,
    type Meet71DialerDirectoryEntry,
} from '@/lib/meet71-dialer';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';
import { useVisibleInterval } from '@/hooks/useVisibleInterval';

const PRESENCE_POLL_MS = 10_000;

export default function Meet71CallPage() {
    const { t } = useI18n();
    const m = t.admin.meet71.dialer;

    const [directory, setDirectory] = useState<Meet71DialerDirectoryEntry[]>([]);
    const [online, setOnline] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [notAllowed, setNotAllowed] = useState(false);
    const [calling, setCalling] = useState<string | null>(null);
    const [query, setQuery] = useState('');

    const loadDirectory = useCallback(async () => {
        try {
            const rows = (await api.getMeet71Directory()) as Meet71DialerDirectoryEntry[];
            setDirectory(Array.isArray(rows) ? rows : []);
            setNotAllowed(false);
        } catch (error) {
            if (error instanceof ApiError && error.code === 'MEET71_NOT_ALLOWED') {
                setNotAllowed(true);
                setDirectory([]);
            } else {
                toast.error((error as Error).message || m.loadFailed);
            }
        } finally {
            setLoading(false);
        }
    }, [m.loadFailed]);

    const loadPresence = useCallback(async () => {
        if (notAllowed) return;
        try {
            const data = (await api.getMeet71Presence()) as { online?: string[] };
            const emails = Array.isArray(data?.online) ? data.online : [];
            setOnline(new Set(emails.map((email) => email.trim().toLowerCase())));
        } catch (error) {
            if (error instanceof ApiError && error.code === 'MEET71_NOT_ALLOWED') {
                setNotAllowed(true);
            }
            // Presence is best-effort; a 503 just means no green dots.
        }
    }, [notAllowed]);

    useEffect(() => {
        void loadDirectory();
    }, [loadDirectory]);

    useEffect(() => {
        void loadPresence();
    }, [loadPresence]);

    useVisibleInterval(() => {
        void loadPresence();
    }, PRESENCE_POLL_MS);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return directory;
        return directory.filter((row) => {
            const name = (row.displayName ?? '').toLowerCase();
            return row.email.includes(needle) || name.includes(needle);
        });
    }, [directory, query]);

    async function handleCall(email: string, mode: Meet71CallMode) {
        setCalling(`${email}:${mode}`);
        try {
            await placeMeet71Call(email, mode);
        } catch (error) {
            if (error instanceof ApiError && error.code === 'MEET71_NOT_ALLOWED') {
                toast.error(m.notAllowed);
            } else {
                toast.error((error as Error).message || m.callFailed);
            }
        } finally {
            setCalling(null);
        }
    }

    return (
        <PageShell>
            <div className="space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={m.subtitle}
                    breadcrumbs={buildBreadcrumbs(t.dashboardHome.breadcrumbHome, [
                        { label: m.title },
                    ])}
                />

                {notAllowed ? (
                    <p className="text-sm text-gray-600">{m.notAllowed}</p>
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                type="search"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder={m.searchPlaceholder}
                                className="min-h-touch w-full max-w-md rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600"
                                aria-label={m.searchPlaceholder}
                            />
                            <p className="text-xs text-gray-500">
                                {m.onlineHint}
                            </p>
                        </div>

                        {loading && directory.length === 0 ? (
                            <p className="text-sm text-gray-500">{t.common.loading}</p>
                        ) : filtered.length === 0 ? (
                            <p className="text-sm text-gray-500">{m.empty}</p>
                        ) : (
                            <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
                                {filtered.map((member) => {
                                    const isOnline = online.has(member.email);
                                    const voiceBusy = calling === `${member.email}:voice`;
                                    const videoBusy = calling === `${member.email}:video`;
                                    return (
                                        <li
                                            key={member.email}
                                            className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                                        >
                                            <div className="min-w-0 flex items-center gap-2">
                                                <span
                                                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                                                        isOnline ? 'bg-emerald-500' : 'bg-gray-300'
                                                    }`}
                                                    title={isOnline ? m.online : m.offline}
                                                    aria-label={isOnline ? m.online : m.offline}
                                                />
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium text-gray-900">
                                                        {member.displayName || member.email}
                                                    </p>
                                                    {member.displayName ? (
                                                        <p className="truncate text-xs text-gray-500">
                                                            {member.email}
                                                        </p>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="secondary"
                                                    disabled={Boolean(calling)}
                                                    onClick={() => void handleCall(member.email, 'voice')}
                                                >
                                                    <Phone className="me-1.5 h-4 w-4" />
                                                    {voiceBusy ? m.calling : m.voice}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    disabled={Boolean(calling)}
                                                    onClick={() => void handleCall(member.email, 'video')}
                                                >
                                                    <Video className="me-1.5 h-4 w-4" />
                                                    {videoBusy ? m.calling : m.video}
                                                </Button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </>
                )}
            </div>
        </PageShell>
    );
}
