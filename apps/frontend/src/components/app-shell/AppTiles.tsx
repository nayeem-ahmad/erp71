'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { appHomeHref } from '@/lib/app-shell';
import { useI18n } from '@/lib/i18n';
import { workspaceScope } from '@/lib/query-client';
import { routes } from '@/lib/routes';
import LockedAppSheet from './LockedAppSheet';
import { useHomeApps, type LockedApp } from './use-home-apps';

/**
 * Home's row of apps: one tile per app the member can open, carrying the one
 * count that says what is waiting in it, then the apps the plan could add.
 * One request for every count — round trips are what Home's load time is
 * made of from Dhaka.
 */
export default function AppTiles() {
    const { t, fmt } = useI18n();
    const copy = t.components.appShell;
    const home = useHomeApps();
    const [openLocked, setOpenLocked] = useState<LockedApp | null>(null);

    // The header branch, sent explicitly: every branch-aware tile counts that
    // branch, for owners as for staff. The key carries it, so switching the
    // header branch refetches.
    const scope = workspaceScope();
    const headerBranchId = scope[1];
    const pulseQuery = useQuery({
        queryKey: ['home-pulse', ...scope],
        queryFn: () => api.getHomePulse(headerBranchId ? { storeId: headerBranchId } : undefined),
        enabled: home.enabled,
        staleTime: 60_000,
    });

    if (!home.enabled) return null;

    const pulse = pulseQuery.data ?? {};
    const pulseCopy = copy.pulse as Record<string, string>;

    return (
        <section aria-label={copy.apps} className="space-y-2">
            {home.tiles.length > 0 ? (
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
                    {home.tiles.map((tile) => {
                        const Icon = tile.icon;
                        const waiting = pulse[tile.key];
                        const line = waiting && pulseCopy[tile.key] ? fmt(pulseCopy[tile.key], { count: waiting.count }) : null;
                        const href = waiting?.href ?? appHomeHref(tile.modules[0]) ?? routes.home;
                        return (
                            <Link
                                key={tile.key}
                                href={href}
                                className="flex min-h-touch items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-blue-300 hover:bg-blue-50"
                            >
                                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                                    <Icon className="h-5 w-5" aria-hidden />
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-semibold text-gray-900">{tile.label}</span>
                                    {line ? <span className="block truncate text-xs text-amber-700">{line}</span> : null}
                                </span>
                            </Link>
                        );
                    })}
                </div>
            ) : null}

            {home.locked.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500">{copy.addToPlan}</span>
                    {home.locked.map((app) => (
                        <button
                            key={app.key}
                            type="button"
                            onClick={() => setOpenLocked(app)}
                            title={copy.locked}
                            className="inline-flex min-h-touch items-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-2.5 text-xs text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-700"
                        >
                            <Lock className="h-3.5 w-3.5" aria-hidden />
                            {app.label}
                        </button>
                    ))}
                </div>
            ) : null}

            {home.canManageApps ? (
                <Link href={routes.settings.apps} className="inline-flex text-xs font-medium text-blue-600 hover:text-blue-700">
                    {copy.manageApps}
                </Link>
            ) : null}

            {openLocked ? <LockedAppSheet app={openLocked} onClose={() => setOpenLocked(null)} /> : null}
        </section>
    );
}
