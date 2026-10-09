'use client';

import type { LucideIcon } from 'lucide-react';
import { APP_REGISTRY } from '@erp71/shared-types';
import { useAppShell } from '@/contexts/AppShellContext';
import { useNavLayouts } from '@/contexts/NavLayoutContext';
import { buildRail, type RailEntry } from '@/lib/app-shell';
import { useI18n } from '@/lib/i18n';
import { buildNavModulesFromLayout } from '@/lib/nav-resolver';
import { resolveSidebarModules } from '@/lib/sidebar-modules';

export interface LockedApp {
    key: string;
    label: string;
    icon: LucideIcon;
}

export interface HomeApps {
    enabled: boolean;
    /** The business apps this member can open, in menu order. */
    tiles: RailEntry[];
    /** Apps the plan does not grant, for whoever may buy them; empty for everyone else. */
    locked: LockedApp[];
    canManageApps: boolean;
    isOwner: boolean;
}

/**
 * Home's view of the apps: the rail's business entries, resolved from the same
 * gates, plus the ones the workspace could add to its plan.
 */
export function useHomeApps(): HomeApps {
    const { enabled, navGates, canManageBilling, canManageApps } = useAppShell();
    const { t } = useI18n();
    const { tenantLayout, platformAdminLayout } = useNavLayouts();
    const messages = t as Record<string, unknown>;

    const modules = resolveSidebarModules({ ...navGates, tenantLayout, platformAdminLayout, messages });
    const tiles = buildRail(modules, '').business;

    const states = navGates.appStates;
    const locked = canManageBilling && states
        ? buildNavModulesFromLayout(tenantLayout, messages)
            // An app sold as part of another (Expenses with Accounting) is not
            // offered on its own.
            .filter((navModule) => states[navModule.key] === 'locked' && !APP_REGISTRY[navModule.key]?.soldWith)
            .map((navModule) => ({ key: navModule.key, label: navModule.label, icon: navModule.icon }))
        : [];

    return { enabled, tiles, locked, canManageApps, isOwner: Boolean(navGates.memberIsOwner) };
}
