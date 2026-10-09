'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SidebarModulesInput } from '@/lib/sidebar-modules';

/** What the nav gates on, less what each consumer reads for itself. */
export type NavGates = Omit<SidebarModulesInput, 'tenantLayout' | 'platformAdminLayout' | 'messages'>;

export interface AppShellValue {
    /** The `appShell` switch, for a shop's own workspace. */
    enabled: boolean;
    /** The same gates the sidebar resolves its menu from. */
    navGates: NavGates;
    /** Owner or `MANAGE_USERS` — who may be offered an add-on. */
    canManageBilling: boolean;
    /** Owner or manager — who may hide apps (the backend's rule). */
    canManageApps: boolean;
}

const AppShellContext = createContext<AppShellValue>({
    enabled: false,
    navGates: {},
    canManageBilling: false,
    canManageApps: false,
});

/** Provided by the `(app)` shell, so Home can draw the apps the rail draws. */
export function AppShellProvider({ value, children }: { value: AppShellValue; children: ReactNode }) {
    return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;
}

export function useAppShell(): AppShellValue {
    return useContext(AppShellContext);
}
