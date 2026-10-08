'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { APP_REGISTRY } from '@erp71/shared-types';
import { Button, PageShell, Switch } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { useAppShell } from '@/contexts/AppShellContext';
import { useNavLayouts } from '@/contexts/NavLayoutContext';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { buildNavModulesFromLayout } from '@/lib/nav-resolver';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { ME_QUERY_KEY } from '@/lib/query-client';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';

/**
 * Which apps the workspace shows on the rail and on Home. Owners and managers
 * switch them; everyone else can see the list. Hiding is presentation only —
 * the note on the page says so, because the first question an owner asks is
 * whether hiding deletes anything.
 */
export default function AppsSettingsPage() {
    const { t, fmt } = useI18n();
    const copy = t.components.appShell;
    const queryClient = useQueryClient();
    const { navGates, canManageApps } = useAppShell();
    const { tenantLayout } = useNavLayouts();
    const states = navGates.appStates ?? {};

    // Business apps in menu order, as this member's session sees them.
    const apps = useMemo(
        () => buildNavModulesFromLayout(tenantLayout, t as Record<string, unknown>)
            .filter((navModule) => APP_REGISTRY[navModule.key]?.kind === 'business')
            .filter((navModule) => states[navModule.key] !== undefined && states[navModule.key] !== 'unavailable'),
        [tenantLayout, t, states],
    );

    // Start from the session's answer so the list draws at once; the saved
    // list then replaces it unless the owner has already started editing.
    const sessionHidden = useMemo(
        () => Object.entries(states).filter(([, state]) => state === 'hidden').map(([id]) => id),
        [states],
    );
    const [saved, setSaved] = useState<string[]>(sessionHidden);
    const [hidden, setHidden] = useState<string[]>(sessionHidden);
    const [edited, setEdited] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let active = true;
        api.getTenantAppSettings()
            .then((settings) => {
                if (!active) return;
                const list = settings?.hidden_apps ?? [];
                setSaved(list);
                setHidden((current) => (edited ? current : list));
            })
            .catch(() => {
                if (active) toast.error(copy.settings.loadFailed);
            });
        return () => {
            active = false;
        };
        // Loaded once; `edited` is read at resolve time on purpose.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const dirty = hidden.length !== saved.length || hidden.some((id) => !saved.includes(id));

    const toggle = (id: string, show: boolean) => {
        setEdited(true);
        setHidden((current) => (show ? current.filter((item) => item !== id) : [...current, id]));
    };

    const save = async () => {
        setSaving(true);
        try {
            const result = await api.updateTenantAppSettings({ hidden_apps: hidden });
            const next = result?.hidden_apps ?? hidden;
            setSaved(next);
            setHidden(next);
            setEdited(false);
            // The rail and Home read the hidden list off the session.
            await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
            toast.success(copy.settings.saved);
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : copy.settings.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <PageShell maxWidth="wide" className="space-y-4">
            <PageHeader
                title={copy.settings.title}
                subtitle={copy.settings.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    copy.settings.title,
                    'settings',
                )}
                actions={canManageApps ? (
                    <Button onClick={save} disabled={!dirty || saving}>
                        {copy.settings.save}
                    </Button>
                ) : undefined}
            />

            <p className="text-xs text-gray-500">{copy.settings.note}</p>
            {!canManageApps ? (
                <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    {copy.settings.readOnly}
                </p>
            ) : null}

            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {apps.map((app) => {
                    const Icon = app.icon;
                    const locked = states[app.key] === 'locked';
                    const shown = !hidden.includes(app.key);
                    return (
                        <li key={app.key} className="flex min-h-touch items-center gap-3 px-3 py-2">
                            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                                <Icon className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-gray-900">{app.label}</span>
                                <span className="block text-xs text-gray-500">
                                    {locked ? copy.settings.lockedHint : shown ? copy.settings.shown : copy.settings.hidden}
                                </span>
                            </span>
                            {locked ? (
                                <Link href={routes.billing} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
                                    <Lock className="h-3.5 w-3.5" aria-hidden />
                                    {copy.seePlans}
                                </Link>
                            ) : (
                                <Switch
                                    checked={shown}
                                    onCheckedChange={(next) => toggle(app.key, next)}
                                    disabled={!canManageApps || saving}
                                    aria-label={fmt(copy.settings.toggleLabel, { app: app.label })}
                                />
                            )}
                        </li>
                    );
                })}
            </ul>
        </PageShell>
    );
}
