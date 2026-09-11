'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    Loader2, UserPlus, Mail, Trash2, ShieldCheck, Store as StoreIcon,
    ChevronRight, Users, Plus, Pencil, X,
} from 'lucide-react';
import {
    STORE_PERMISSION_GROUPS,
    STORE_PERMISSION_LABELS,
    TENANT_RECORD_SCOPE_LABELS,
    TENANT_ROLE_MODULES,
    TenantRecordScope,
    type StorePermission,
    type TenantRoleSummary,
} from '@erp71/shared-types';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell } from '@/components/ui';
import { toast } from '@/lib/toast';
import { getWorkspaceItem } from '@/lib/session-store';

/* ------------------------------- Types -------------------------------- */

type MemberStore = {
    storeId: string;
    storeName: string;
    accessLevel: 'STORE_ONLY' | 'MULTI_STORE_CAPABLE';
    permissionCount: number;
};
type Member = {
    userId: string;
    email: string;
    name: string | null;
    isOwner: boolean;
    roleName: string;
    roleNames: string[];
    tenantRoleId: string | null;
    tenantRoleIds: string[];
    isSelf: boolean;
    stores: MemberStore[];
};
type MemberDetailStore = {
    storeId: string;
    storeName: string;
    hasAccess: boolean;
    accessLevel: 'STORE_ONLY' | 'MULTI_STORE_CAPABLE';
    permissions: string[];
};
type MemberDetail = {
    userId: string;
    email: string;
    name: string | null;
    isOwner: boolean;
    roleName: string;
    roleNames: string[];
    tenantRoleId: string | null;
    tenantRoleIds: string[];
    isSelf: boolean;
    stores: MemberDetailStore[];
};
type Invitation = {
    id: string;
    email: string;
    roleName: string;
    roleNames: string[];
    tenantRoleId: string;
    tenantRoleIds: string[];
    invitedAt: string;
    expiresAt: string;
};
type ToastState = { type: 'success' | 'error'; message: string } | null;
type TeamTab = 'members' | 'roles';

const OWNER_BADGE_STYLE = 'bg-purple-100 text-purple-700';
const ROLE_BADGE_STYLE = 'bg-gray-100 text-gray-700';

/** Forwards local `{type, message}` toast payloads to the global toast store. */
function showToast(state: ToastState) {
    if (!state) return;
    if (state.type === 'success') toast.success(state.message);
    else toast.error(state.message);
}

/* ------------------------------ Role picker --------------------------- */

/**
 * Groups roles by the module their template belongs to, in the order the
 * templates declare. Roles with no module — the legacy system roles and anything
 * an owner wrote themselves — fall into a trailing group.
 */
function groupRolesByModule(roles: TenantRoleSummary[], otherLabel: string) {
    const groups = new Map<string, TenantRoleSummary[]>();
    for (const role of roles) {
        const key = role.module ?? otherLabel;
        groups.set(key, [...(groups.get(key) ?? []), role]);
    }
    const ordered = [...TENANT_ROLE_MODULES, otherLabel].filter((label) => groups.has(label));
    // Any module the catalog does not know about (a newer backend than this build)
    // still gets rendered rather than silently dropped.
    const extras = [...groups.keys()].filter((label) => !ordered.includes(label));
    return [...ordered, ...extras].map((label) => ({ label, roles: groups.get(label) ?? [] }));
}

/**
 * Multi-select over the workspace's roles. A member may hold several — their
 * access is the union — and the order they were picked in is preserved, so the
 * first stays the primary role.
 */
function RolePicker({
    roles,
    selectedIds,
    onChange,
    disabled,
    otherLabel,
}: {
    roles: TenantRoleSummary[];
    selectedIds: string[];
    onChange: (next: string[]) => void;
    disabled?: boolean;
    otherLabel: string;
}) {
    const groups = useMemo(() => groupRolesByModule(roles, otherLabel), [roles, otherLabel]);

    const toggle = (roleId: string) => {
        onChange(
            selectedIds.includes(roleId)
                ? selectedIds.filter((id) => id !== roleId)
                : [...selectedIds, roleId],
        );
    };

    return (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 space-y-3">
            {groups.map((group) => (
                <div key={group.label}>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">
                        {group.label}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                        {group.roles.map((role) => (
                            <label
                                key={role.id}
                                title={role.description ?? undefined}
                                className="flex items-center gap-2.5 min-h-touch text-sm text-gray-700 cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedIds.includes(role.id)}
                                    onChange={() => toggle(role.id)}
                                    disabled={disabled}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                                />
                                <span className="truncate">{role.name}</span>
                            </label>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

/* --------------------------- Permission matrix ------------------------ */

function PermissionMatrix({
    permissions,
    onToggle,
}: {
    permissions: Set<StorePermission>;
    onToggle: (perm: StorePermission) => void;
}) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            {STORE_PERMISSION_GROUPS.map((group) => (
                <div key={group.label}>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">{group.label}</p>
                    <div className="space-y-1.5">
                        {group.permissions.map((perm) => (
                            <label key={perm} className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={permissions.has(perm)}
                                    onChange={() => onToggle(perm)}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                {STORE_PERMISSION_LABELS[perm]}
                            </label>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ---------------------------- Record scope ---------------------------- */

/**
 * The second half of what a role grants: the permissions above say *what* it can
 * do, this says *whose records* it may read.
 *
 * Copy comes from `TENANT_RECORD_SCOPE_LABELS` rather than the locale files, for
 * the same reason the permission matrix reads `STORE_PERMISSION_LABELS`: the
 * vocabulary belongs with the enum, so a new value cannot ship with nothing to
 * call it.
 */
function RecordScopeField({
    scope,
    onChange,
}: {
    scope: TenantRecordScope;
    onChange: (scope: TenantRecordScope) => void;
}) {
    return (
        <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                Records this role can see
            </p>
            <div className="space-y-2">
                {(Object.keys(TENANT_RECORD_SCOPE_LABELS) as TenantRecordScope[]).map((value) => (
                    <label
                        key={value}
                        className="flex items-start gap-2.5 text-sm text-gray-700 cursor-pointer"
                    >
                        <input
                            type="radio"
                            name="record-scope"
                            checked={scope === value}
                            onChange={() => onChange(value)}
                            className="mt-0.5 border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>
                            <span className="font-semibold">{TENANT_RECORD_SCOPE_LABELS[value].label}</span>
                            <span className="block text-xs text-gray-500">
                                {TENANT_RECORD_SCOPE_LABELS[value].description}
                            </span>
                        </span>
                    </label>
                ))}
            </div>
            <p className="mt-2 text-xs text-gray-400">
                A member holding more than one role gets the widest scope of the roles they hold.
            </p>
        </div>
    );
}

/* ----------------------------- Roles panel ---------------------------- */

function RolesPanel({
    onToast,
}: {
    onToast: (t: ToastState) => void;
}) {
    const { t, fmt } = useI18n();
    const tr = t.teamManagement.roles;
    const [roles, setRoles] = useState<TenantRoleSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [formName, setFormName] = useState('');
    const [formPerms, setFormPerms] = useState<Set<StorePermission>>(new Set());
    const [formScope, setFormScope] = useState<TenantRecordScope>(TenantRecordScope.ALL);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const data: TenantRoleSummary[] = await api.getTeamRoles();
            setRoles(data ?? []);
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || tr.loadFailed });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const startCreate = () => {
        setCreating(true);
        setEditingId(null);
        setFormName('');
        setFormPerms(new Set());
        setFormScope(TenantRecordScope.ALL);
    };

    const startEdit = (role: TenantRoleSummary) => {
        setCreating(false);
        setEditingId(role.id);
        setFormName(role.name);
        setFormPerms(new Set(role.permissions));
        setFormScope(role.record_scope ?? TenantRecordScope.ALL);
    };

    const cancelForm = () => {
        setCreating(false);
        setEditingId(null);
        setFormName('');
        setFormPerms(new Set());
        setFormScope(TenantRecordScope.ALL);
    };

    const togglePerm = (perm: StorePermission) => {
        setFormPerms((prev) => {
            const next = new Set(prev);
            if (next.has(perm)) next.delete(perm);
            else next.add(perm);
            return next;
        });
    };

    const saveCreate = async () => {
        if (!formName.trim() || formPerms.size === 0) return;
        setSaving(true);
        try {
            await api.createTeamRole({
                name: formName.trim(),
                permissions: Array.from(formPerms),
                recordScope: formScope,
            });
            onToast({ type: 'success', message: tr.roleCreated });
            cancelForm();
            await load();
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || tr.createFailed });
        } finally {
            setSaving(false);
        }
    };

    const saveEdit = async (role: TenantRoleSummary) => {
        if (!formName.trim() || formPerms.size === 0) return;

        const nameChanged = formName.trim() !== role.name;
        const originalPerms = new Set(role.permissions);
        const permsChanged =
            formPerms.size !== originalPerms.size ||
            Array.from(formPerms).some((p) => !originalPerms.has(p));
        // Narrowing a role changes what its members can read on their next
        // request, so it belongs in the same confirmation as a permission edit.
        const scopeChanged = formScope !== (role.record_scope ?? TenantRecordScope.ALL);

        const memberCount = role.member_count ?? 0;
        if (memberCount > 0 && (nameChanged || permsChanged || scopeChanged)) {
            const msg = formatMessage(tr.syncWarning, { count: memberCount });
            if (!confirm(msg)) return;
        }

        setSaving(true);
        try {
            await api.updateTeamRole(role.id, {
                name: formName.trim(),
                permissions: Array.from(formPerms),
                recordScope: formScope,
            });
            onToast({ type: 'success', message: tr.roleUpdated });
            cancelForm();
            await load();
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || tr.updateFailed });
        } finally {
            setSaving(false);
        }
    };

    const deleteRole = async (role: TenantRoleSummary) => {
        if ((role.member_count ?? 0) > 0) return;
        if (!confirm(formatMessage(tr.deleteConfirm, { name: role.name }))) return;
        setDeletingId(role.id);
        try {
            await api.deleteTeamRole(role.id);
            onToast({ type: 'success', message: tr.roleDeleted });
            if (editingId === role.id) cancelForm();
            await load();
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || tr.deleteFailed });
        } finally {
            setDeletingId(null);
        }
    };

    const formatPermCount = (count: number) => fmt(tr.permissionCount, { count });

    const formatMemberCount = (count: number) => fmt(tr.memberCount, { count });

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-bold text-gray-800">{tr.title}</p>
                <button
                    onClick={startCreate}
                    disabled={creating}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                    <Plus className="w-4 h-4" /> {tr.createRole}
                </button>
            </div>

            {creating && (
                <div className="rounded-lg border border-blue-200 bg-white p-5 space-y-4">
                    <p className="text-sm font-bold text-gray-800">{tr.createRole}</p>
                    <div>
                        <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-1.5">{tr.nameLabel}</label>
                        <input
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            className="w-full max-w-md rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <PermissionMatrix permissions={formPerms} onToggle={togglePerm} />
                    <RecordScopeField scope={formScope} onChange={setFormScope} />
                    <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
                        <button
                            onClick={saveCreate}
                            disabled={saving || !formName.trim() || formPerms.size === 0}
                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {tr.saveRole}
                        </button>
                        <button onClick={cancelForm} className="text-sm font-semibold text-gray-500 hover:text-gray-700">{t.common.cancel}</button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="rounded-lg border border-gray-200 bg-white p-8 flex items-center justify-center text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin me-2" /> {t.teamManagement.loading}
                </div>
            ) : roles.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">{tr.noRoles}</div>
            ) : (
                <div className="space-y-3">
                    {roles.map((role) => {
                        const isEditing = editingId === role.id;
                        const inUse = (role.member_count ?? 0) > 0;
                        return (
                            <div key={role.id} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                                {isEditing ? (
                                    <div className="p-5 space-y-4">
                                        <p className="text-sm font-bold text-gray-800">{tr.editRole}</p>
                                        <div>
                                            <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-1.5">{tr.nameLabel}</label>
                                            <input
                                                value={formName}
                                                onChange={(e) => setFormName(e.target.value)}
                                                className="w-full max-w-md rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <PermissionMatrix permissions={formPerms} onToggle={togglePerm} />
                                        <RecordScopeField scope={formScope} onChange={setFormScope} />
                                        <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
                                            <button
                                                onClick={() => saveEdit(role)}
                                                disabled={saving || !formName.trim() || formPerms.size === 0}
                                                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                {saving && <Loader2 className="w-4 h-4 animate-spin" />} {tr.saveRole}
                                            </button>
                                            <button onClick={cancelForm} className="text-sm font-semibold text-gray-500 hover:text-gray-700">{t.common.cancel}</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between gap-4 px-5 py-4">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-sm font-bold text-gray-900">{role.name}</p>
                                                {role.is_system && (
                                                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-600">
                                                        {tr.systemRole}
                                                    </span>
                                                )}
                                                {role.record_scope === TenantRecordScope.OWN && (
                                                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700">
                                                        Own records
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                {formatPermCount(role.permissions.length)} · {formatMemberCount(role.member_count ?? 0)}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <button
                                                onClick={() => startEdit(role)}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
                                            >
                                                <Pencil className="w-3.5 h-3.5" /> {tr.editRole}
                                            </button>
                                            <button
                                                onClick={() => deleteRole(role)}
                                                disabled={inUse || deletingId === role.id}
                                                title={inUse ? tr.cannotDeleteInUse : undefined}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                {deletingId === role.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                                {tr.deleteRole}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* --------------------------- Member detail ---------------------------- */

function MemberPanel({
    userId, tenantRoles, onToast, onChanged, onClose,
}: {
    userId: string;
    tenantRoles: TenantRoleSummary[];
    onToast: (t: ToastState) => void;
    onChanged: () => void;
    onClose: () => void;
}) {
    const { t, fmt } = useI18n();
    const tm = t.teamManagement.member;
    const [detail, setDetail] = useState<MemberDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [tenantRoleIds, setTenantRoleIds] = useState<string[]>([]);
    const [savingRole, setSavingRole] = useState(false);
    const [busyStore, setBusyStore] = useState<string>('');
    const [drafts, setDrafts] = useState<Record<string, Set<string>>>({});

    const load = async () => {
        setLoading(true);
        try {
            const d: MemberDetail = await api.getTeamMember(userId);
            setDetail(d);
            setTenantRoleIds(d.tenantRoleIds ?? []);
            const next: Record<string, Set<string>> = {};
            d.stores.forEach((s) => { next[s.storeId] = new Set(s.permissions); });
            setDrafts(next);
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || tm.loadFailed });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

    const saveRole = async () => {
        if (tenantRoleIds.length === 0) {
            onToast({ type: 'error', message: tm.selectAtLeastOneRole });
            return;
        }
        setSavingRole(true);
        try {
            await api.updateMemberRoles(userId, { tenantRoleIds });
            onToast({ type: 'success', message: tm.roleUpdated });
            onChanged();
            await load();
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || tm.roleUpdateFailed });
        } finally {
            setSavingRole(false);
        }
    };

    const toggleAccess = async (s: MemberDetailStore) => {
        setBusyStore(s.storeId);
        try {
            if (s.hasAccess) {
                await api.revokeMemberStoreAccess(userId, s.storeId);
                onToast({ type: 'success', message: formatMessage(tm.accessRemoved, { store: s.storeName }) });
            } else {
                await api.grantMemberStoreAccess(userId, { storeId: s.storeId, accessLevel: 'STORE_ONLY', seedDefaults: true });
                onToast({ type: 'success', message: formatMessage(tm.accessGranted, { store: s.storeName }) });
            }
            onChanged();
            await load();
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || tm.branchAccessFailed });
        } finally {
            setBusyStore('');
        }
    };

    const changeAccessLevel = async (s: MemberDetailStore, level: 'STORE_ONLY' | 'MULTI_STORE_CAPABLE') => {
        setBusyStore(s.storeId);
        try {
            await api.grantMemberStoreAccess(userId, { storeId: s.storeId, accessLevel: level, seedDefaults: false });
            onChanged();
            await load();
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || tm.accessLevelFailed });
        } finally {
            setBusyStore('');
        }
    };

    const togglePerm = (storeId: string, perm: string) => {
        setDrafts((prev) => {
            const set = new Set(prev[storeId] ?? []);
            if (set.has(perm)) set.delete(perm); else set.add(perm);
            return { ...prev, [storeId]: set };
        });
    };

    const savePerms = async (storeId: string, storeName: string) => {
        setBusyStore(storeId);
        try {
            await api.setMemberStorePermissions(userId, storeId, Array.from(drafts[storeId] ?? []));
            onToast({ type: 'success', message: formatMessage(tm.permissionsSaved, { store: storeName }) });
            onChanged();
            await load();
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || tm.permissionsSaveFailed });
        } finally {
            setBusyStore('');
        }
    };

    const remove = async () => {
        if (!detail) return;
        if (!confirm(formatMessage(tm.removeConfirm, { name: detail.name || detail.email }))) return;
        try {
            await api.removeMember(userId);
            onToast({ type: 'success', message: tm.memberRemoved });
            onChanged();
            onClose();
        } catch (err: any) {
            onToast({ type: 'error', message: err?.message || tm.removeFailed });
        }
    };

    if (loading || !detail) {
        return (
            <div className="flex items-center gap-2 text-sm text-gray-400 p-8">
                <Loader2 className="w-4 h-4 animate-spin" /> {tm.loading}
            </div>
        );
    }

    const isOwner = detail.isOwner;
    const savedRoleIds = detail.tenantRoleIds ?? [];
    const roleDirty =
        !isOwner &&
        (tenantRoleIds.length !== savedRoleIds.length ||
            tenantRoleIds.some((id, i) => id !== savedRoleIds[i]));

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold border border-blue-200">
                        {(detail.name || detail.email).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <p className="font-bold text-gray-900 truncate">{detail.name || '—'}</p>
                        <p className="text-xs text-gray-500 truncate">{detail.email}</p>
                    </div>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label={tm.closeAria}>
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 space-y-3">
                <p className="text-sm font-bold text-gray-800">{tm.roles}</p>
                {isOwner ? (
                    <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${OWNER_BADGE_STYLE}`}>
                            {detail.roleName}
                        </span>
                        <p className="text-xs text-gray-400">{tm.ownerUnrestricted}</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className="text-xs text-gray-500">{tm.rolesHint}</p>
                        <RolePicker
                            roles={tenantRoles}
                            selectedIds={tenantRoleIds}
                            onChange={setTenantRoleIds}
                            disabled={detail.isSelf}
                            otherLabel={tm.otherRoles}
                        />
                        <div className="flex flex-wrap items-center gap-3">
                            <p className="text-xs text-gray-500">
                                {fmt(tm.rolesSelected, { count: tenantRoleIds.length })}
                            </p>
                            <button
                                onClick={saveRole}
                                disabled={savingRole || detail.isSelf || !roleDirty}
                                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                                {savingRole && <Loader2 className="w-4 h-4 animate-spin" />} {tm.saveRole}
                            </button>
                        </div>
                    </div>
                )}
                {detail.isSelf && !isOwner && <p className="text-xs text-amber-600">{tm.cannotChangeOwnRole}</p>}
            </div>

            <div className="space-y-4">
                <p className="text-sm font-bold text-gray-800">{tm.branchAccessTitle}</p>
                {detail.stores.map((s) => {
                    const draft = drafts[s.storeId] ?? new Set<string>();
                    const original = new Set(s.permissions);
                    const dirty = draft.size !== original.size || Array.from(draft).some((p) => !original.has(p));
                    return (
                        <div key={s.storeId} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                            <div className="flex items-center justify-between gap-3 px-5 py-3.5 bg-gray-50 border-b border-gray-100">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <StoreIcon className="w-4 h-4 text-gray-400 shrink-0" />
                                    <span className="font-bold text-sm text-gray-800 truncate">{s.storeName}</span>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    {s.hasAccess && (
                                        <select
                                            value={s.accessLevel}
                                            onChange={(e) => changeAccessLevel(s, e.target.value as 'STORE_ONLY' | 'MULTI_STORE_CAPABLE')}
                                            disabled={busyStore === s.storeId}
                                            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 outline-none"
                                        >
                                            <option value="STORE_ONLY">{tm.lockedToBranch}</option>
                                            <option value="MULTI_STORE_CAPABLE">{tm.canSwitchBranches}</option>
                                        </select>
                                    )}
                                    <button
                                        onClick={() => toggleAccess(s)}
                                        disabled={busyStore === s.storeId}
                                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${s.hasAccess ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                                    >
                                        {busyStore === s.storeId ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                        {s.hasAccess ? tm.removeAccess : tm.grantAccess}
                                    </button>
                                </div>
                            </div>

                            {s.hasAccess && (
                                <div className="p-5 space-y-4">
                                    {isOwner ? (
                                        <p className="text-xs text-gray-400">{tm.ownerBypass}</p>
                                    ) : (
                                        <>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                                                {STORE_PERMISSION_GROUPS.map((group) => (
                                                    <div key={group.label}>
                                                        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">{group.label}</p>
                                                        <div className="space-y-1.5">
                                                            {group.permissions.map((perm) => (
                                                                <label key={perm} className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={draft.has(perm)}
                                                                        onChange={() => togglePerm(s.storeId, perm)}
                                                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                                    />
                                                                    {STORE_PERMISSION_LABELS[perm]}
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="flex items-center justify-end gap-3 pt-1 border-t border-gray-100">
                                                <span className="text-xs text-gray-400">
                                                    {fmt(tm.permissionsSelected, { count: draft.size })}
                                                </span>
                                                <button
                                                    onClick={() => savePerms(s.storeId, s.storeName)}
                                                    disabled={!dirty || busyStore === s.storeId}
                                                    className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-black disabled:opacity-40"
                                                >
                                                    {busyStore === s.storeId && <Loader2 className="w-4 h-4 animate-spin" />} {tm.savePermissions}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {!detail.isSelf && (
                <div className="pt-2">
                    <button onClick={remove} className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" /> {tm.removeFromOrg}
                    </button>
                </div>
            )}
        </div>
    );
}

/* -------------------------------- Page -------------------------------- */

export default function TeamPage() {
    const { t, fmt } = useI18n();
    const tm = t.teamManagement;
    const [activeTab, setActiveTab] = useState<TeamTab>('members');
    const [isOwner, setIsOwner] = useState(false);
    const [tenantRoles, setTenantRoles] = useState<TenantRoleSummary[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<string | null>(null);

    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteTenantRoleIds, setInviteTenantRoleIds] = useState<string[]>([]);
    const [inviting, setInviting] = useState(false);

    useEffect(() => {
        api.getMe().then((me) => {
            const tenantId = getWorkspaceItem('tenant_id');
            const tenant = me?.tenants?.find((entry: { id: string }) => entry.id === tenantId) || me?.tenants?.[0];
            setIsOwner(tenant?.role === 'OWNER');
        }).catch(() => setIsOwner(false));
    }, []);

    const loadRoles = async () => {
        try {
            const roles: TenantRoleSummary[] = await api.getTeamRoles();
            const list = roles ?? [];
            setTenantRoles(list);
        } catch {
            setTenantRoles([]);
        }
    };

    const load = async () => {
        setLoading(true);
        try {
            const [m, inv] = await Promise.all([api.getTeamMembers(), api.getTeamInvitations()]);
            setMembers(m ?? []);
            setInvitations(inv ?? []);
            await loadRoles();
        } catch (err: any) {
            showToast({ type: 'error', message: err?.message || tm.loadFailed });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { void load(); }, []);

    const sendInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inviteEmail.trim() || inviteTenantRoleIds.length === 0) return;
        setInviting(true);
        try {
            await api.sendTeamInvitation({ email: inviteEmail.trim(), tenantRoleIds: inviteTenantRoleIds });
            showToast({ type: 'success', message: formatMessage(tm.inviteSent, { email: inviteEmail.trim() }) });
            setInviteEmail('');
            setInviteTenantRoleIds([]);
            await load();
        } catch (err: any) {
            showToast({ type: 'error', message: err?.message || tm.inviteFailed });
        } finally {
            setInviting(false);
        }
    };

    const revokeInvite = async (id: string, email: string) => {
        try {
            await api.revokeTeamInvitation(id);
            showToast({ type: 'success', message: formatMessage(tm.inviteRevoked, { email }) });
            await load();
        } catch (err: any) {
            showToast({ type: 'error', message: err?.message || tm.revokeFailed });
        }
    };

    const selectedExists = useMemo(() => members.some((m) => m.userId === selected), [members, selected]);
    useEffect(() => { if (selected && !selectedExists) setSelected(null); }, [selected, selectedExists]);

    useEffect(() => {
        if (!isOwner && activeTab === 'roles') setActiveTab('members');
    }, [isOwner, activeTab]);

    return (
        <PageShell>
                <PageHeader
                    title={tm.title}
                    subtitle={tm.description}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.accountSettings,
                        tm.title,
                        'settings',
                    )}
                />

                <div className="flex gap-1 border-b border-gray-200">
                    <button
                        onClick={() => setActiveTab('members')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'members'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        {tm.members}
                    </button>
                    {isOwner && (
                        <button
                            onClick={() => setActiveTab('roles')}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                activeTab === 'roles'
                                    ? 'border-blue-600 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {tm.roles.tabLabel}
                        </button>
                    )}
                </div>

                {activeTab === 'roles' ? (
                    <RolesPanel onToast={showToast} />
                ) : (
                    <>
                        <form onSubmit={sendInvite} className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-1.5">{tm.inviteEmail}</label>
                                    <input
                                        type="email"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        placeholder={tm.emailPlaceholder}
                                        className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-1.5">{tm.roles.pickerLabel}</label>
                                    <p className="text-xs text-gray-500 mb-1.5">{tm.member.rolesHint}</p>
                                    <RolePicker
                                        roles={tenantRoles}
                                        selectedIds={inviteTenantRoleIds}
                                        onChange={setInviteTenantRoleIds}
                                        disabled={tenantRoles.length === 0}
                                        otherLabel={tm.member.otherRoles}
                                    />
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-xs text-gray-500">
                                        {fmt(tm.member.rolesSelected, { count: inviteTenantRoleIds.length })}
                                    </p>
                                    <button
                                        type="submit"
                                        disabled={inviting || !inviteEmail.trim() || inviteTenantRoleIds.length === 0}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                                        {tm.sendInvite}
                                    </button>
                                </div>
                            </div>

                            {invitations.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                                    <p className="text-xs font-bold uppercase tracking-widest text-gray-400">{tm.pendingInvitations}</p>
                                    {invitations.map((inv) => (
                                        <div key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                                                <span className="font-semibold text-gray-700 truncate">{inv.email}</span>
                                                {(inv.roleNames ?? [inv.roleName]).map((name) => (
                                                    <span
                                                        key={name}
                                                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${ROLE_BADGE_STYLE}`}
                                                    >
                                                        {name}
                                                    </span>
                                                ))}
                                            </div>
                                            <button onClick={() => revokeInvite(inv.id, inv.email)} className="text-xs font-semibold text-red-500 hover:text-red-700">{tm.revoke}</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </form>

                        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
                            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden self-start">
                                <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
                                    <Users className="w-4 h-4 text-gray-400" />
                                    <span className="text-sm font-bold text-gray-800">{tm.members}</span>
                                    <span className="text-xs text-gray-400">· {members.length}</span>
                                </div>
                                {loading ? (
                                    <div className="p-8 flex items-center justify-center text-sm text-gray-400">
                                        <Loader2 className="w-4 h-4 animate-spin me-2" /> {tm.loading}
                                    </div>
                                ) : members.length === 0 ? (
                                    <div className="p-8 text-center text-sm text-gray-400">{tm.noMembers}</div>
                                ) : (
                                    <div className="divide-y divide-gray-100">
                                        {members.map((m) => (
                                            <button
                                                key={m.userId}
                                                onClick={() => setSelected(m.userId)}
                                                className={`w-full px-5 py-3.5 flex items-center justify-between gap-3 text-start hover:bg-gray-50 transition ${selected === m.userId ? 'bg-blue-50/60' : ''}`}
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-sm font-bold text-gray-900 truncate">{m.name || m.email}</p>
                                                    <p className="text-xs text-gray-500 truncate">
                                                        {m.isOwner
                                                            ? tm.allBranches
                                                            : fmt(tm.branchCount, { count: m.stores.length })}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${m.isOwner ? OWNER_BADGE_STYLE : ROLE_BADGE_STYLE}`}>
                                                        {m.roleName}
                                                    </span>
                                                    {/* One badge plus a count: a member holding six roles must not push the row wide. */}
                                                    {(m.roleNames?.length ?? 0) > 1 && (
                                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ROLE_BADGE_STYLE}`}>
                                                            +{m.roleNames.length - 1}
                                                        </span>
                                                    )}
                                                    <ChevronRight className="w-4 h-4 text-gray-300" />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="rounded-lg border border-gray-200 bg-canvas p-5 min-h-[300px]">
                                {selected ? (
                                    <MemberPanel
                                        userId={selected}
                                        tenantRoles={tenantRoles}
                                        onToast={showToast}
                                        onChanged={load}
                                        onClose={() => setSelected(null)}
                                    />
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 py-16">
                                        <ShieldCheck className="w-10 h-10 mb-3 text-gray-300" />
                                        <p className="text-sm font-semibold">{tm.selectPrompt}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
        </PageShell>
    );
}