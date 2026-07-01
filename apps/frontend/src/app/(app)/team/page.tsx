'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    Loader2, UserPlus, Mail, Trash2, ShieldCheck, Store as StoreIcon,
    ChevronRight, CheckCircle, XCircle, X, Users,
} from 'lucide-react';
import {
    STORE_PERMISSION_GROUPS,
    STORE_PERMISSION_LABELS,
    UserRole,
} from '@erp71/shared-types';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';

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
    role: UserRole;
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
    role: UserRole;
    isSelf: boolean;
    stores: MemberDetailStore[];
};
type Invitation = { id: string; email: string; role: UserRole; invitedAt: string; expiresAt: string };
type ToastState = { type: 'success' | 'error'; message: string } | null;

const ROLES: UserRole[] = [UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER, UserRole.ACCOUNTANT];

const ROLE_STYLES: Record<string, string> = {
    OWNER: 'bg-purple-100 text-purple-700',
    MANAGER: 'bg-blue-100 text-blue-700',
    CASHIER: 'bg-emerald-100 text-emerald-700',
    ACCOUNTANT: 'bg-amber-100 text-amber-700',
};

/* ------------------------------- Toast -------------------------------- */

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(onDismiss, 4000);
        return () => clearTimeout(t);
    }, [toast, onDismiss]);
    if (!toast) return null;
    const ok = toast.type === 'success';
    return (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold ${ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {ok ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
            {toast.message}
        </div>
    );
}

/* --------------------------- Member detail ---------------------------- */

function MemberPanel({
    userId, onToast, onChanged, onClose,
}: {
    userId: string;
    onToast: (t: ToastState) => void;
    onChanged: () => void;
    onClose: () => void;
}) {
    const { t } = useI18n();
    const tm = t.teamManagement.member;
    const [detail, setDetail] = useState<MemberDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [role, setRole] = useState<UserRole>(UserRole.CASHIER);
    const [reseed, setReseed] = useState(false);
    const [savingRole, setSavingRole] = useState(false);
    const [busyStore, setBusyStore] = useState<string>('');
    // Draft permission sets keyed by storeId
    const [drafts, setDrafts] = useState<Record<string, Set<string>>>({});

    const load = async () => {
        setLoading(true);
        try {
            const d: MemberDetail = await api.getTeamMember(userId);
            setDetail(d);
            setRole(d.role);
            setReseed(false);
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
        setSavingRole(true);
        try {
            await api.updateMemberRole(userId, { role, reseedPermissions: reseed });
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

    const isOwner = detail.role === UserRole.OWNER;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-black border border-blue-200">
                        {(detail.name || detail.email).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <p className="font-black text-gray-900 truncate">{detail.name || '—'}</p>
                        <p className="text-xs text-gray-500 truncate">{detail.email}</p>
                    </div>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label={tm.closeAria}>
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Role */}
            <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 space-y-3">
                <p className="text-sm font-black text-gray-800">{tm.role}</p>
                <div className="flex flex-wrap items-center gap-3">
                    <select
                        value={role}
                        onChange={(e) => setRole(e.target.value as UserRole)}
                        disabled={detail.isSelf}
                        className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                        <input type="checkbox" checked={reseed} onChange={(e) => setReseed(e.target.checked)} className="rounded" />
                        {tm.reseedPermissions}
                    </label>
                    <button
                        onClick={saveRole}
                        disabled={savingRole || detail.isSelf || (role === detail.role && !reseed)}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {savingRole && <Loader2 className="w-4 h-4 animate-spin" />} {tm.saveRole}
                    </button>
                </div>
                {detail.isSelf && <p className="text-xs text-amber-600">{tm.cannotChangeOwnRole}</p>}
                {isOwner && <p className="text-xs text-gray-400">{tm.ownerUnrestricted}</p>}
            </div>

            {/* Per-branch access + permissions */}
            <div className="space-y-4">
                <p className="text-sm font-black text-gray-800">{tm.branchAccessTitle}</p>
                {detail.stores.map((s) => {
                    const draft = drafts[s.storeId] ?? new Set<string>();
                    const original = new Set(s.permissions);
                    const dirty = draft.size !== original.size || Array.from(draft).some((p) => !original.has(p));
                    return (
                        <div key={s.storeId} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                            <div className="flex items-center justify-between gap-3 px-5 py-3.5 bg-gray-50 border-b border-gray-100">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <StoreIcon className="w-4 h-4 text-gray-400 shrink-0" />
                                    <span className="font-bold text-sm text-gray-800 truncate">{s.storeName}</span>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    {s.hasAccess && (
                                        <select
                                            value={s.accessLevel}
                                            onChange={(e) => changeAccessLevel(s, e.target.value as any)}
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
                                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-black disabled:opacity-50 ${s.hasAccess ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
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
                                                        <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-2">{group.label}</p>
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
                                                    {draft.size === 1
                                                        ? formatMessage(tm.permissionsSelected, { count: draft.size })
                                                        : formatMessage(tm.permissionsSelectedPlural, { count: draft.size })}
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

            {/* Danger zone */}
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
    const { t } = useI18n();
    const tm = t.teamManagement;
    const [members, setMembers] = useState<Member[]>([]);
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<string | null>(null);
    const [toast, setToast] = useState<ToastState>(null);

    // Invite form
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<UserRole>(UserRole.CASHIER);
    const [inviting, setInviting] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const [m, inv] = await Promise.all([api.getTeamMembers(), api.getTeamInvitations()]);
            setMembers(m ?? []);
            setInvitations(inv ?? []);
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || tm.loadFailed });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { void load(); }, []);

    const sendInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;
        setInviting(true);
        try {
            await api.sendTeamInvitation({ email: inviteEmail.trim(), role: inviteRole });
            setToast({ type: 'success', message: formatMessage(tm.inviteSent, { email: inviteEmail.trim() }) });
            setInviteEmail('');
            await load();
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || tm.inviteFailed });
        } finally {
            setInviting(false);
        }
    };

    const revokeInvite = async (id: string, email: string) => {
        try {
            await api.revokeTeamInvitation(id);
            setToast({ type: 'success', message: formatMessage(tm.inviteRevoked, { email }) });
            await load();
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || tm.revokeFailed });
        }
    };

    const selectedExists = useMemo(() => members.some((m) => m.userId === selected), [members, selected]);
    useEffect(() => { if (selected && !selectedExists) setSelected(null); }, [selected, selectedExists]);

    return (
        <div className="h-full overflow-y-auto bg-[#f9fafb]">
            <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
                <div>
                    <h1 className="text-2xl font-black text-gray-900 tracking-tight">{tm.title}</h1>
                    <p className="mt-1 text-sm text-gray-500">{tm.description}</p>
                </div>

                {/* Invite */}
                <form onSubmit={sendInvite} className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                        <div className="flex-1">
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
                            <label className="block text-xs font-bold uppercase tracking-widest text-gray-500 mb-1.5">{tm.role}</label>
                            <select
                                value={inviteRole}
                                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                                className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <button
                            type="submit"
                            disabled={inviting || !inviteEmail.trim()}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                            {tm.sendInvite}
                        </button>
                    </div>

                    {invitations.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                            <p className="text-xs font-bold uppercase tracking-widest text-gray-400">{tm.pendingInvitations}</p>
                            {invitations.map((inv) => (
                                <div key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                                        <span className="font-semibold text-gray-700 truncate">{inv.email}</span>
                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${ROLE_STYLES[inv.role] ?? 'bg-gray-100 text-gray-600'}`}>{inv.role}</span>
                                    </div>
                                    <button onClick={() => revokeInvite(inv.id, inv.email)} className="text-xs font-semibold text-red-500 hover:text-red-700">{tm.revoke}</button>
                                </div>
                            ))}
                        </div>
                    )}
                </form>

                {/* Members + detail */}
                <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
                    {/* Member list */}
                    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden self-start">
                        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
                            <Users className="w-4 h-4 text-gray-400" />
                            <span className="text-sm font-black text-gray-800">{tm.members}</span>
                            <span className="text-xs text-gray-400">· {members.length}</span>
                        </div>
                        {loading ? (
                            <div className="p-8 flex items-center justify-center text-sm text-gray-400">
                                <Loader2 className="w-4 h-4 animate-spin mr-2" /> {tm.loading}
                            </div>
                        ) : members.length === 0 ? (
                            <div className="p-8 text-center text-sm text-gray-400">{tm.noMembers}</div>
                        ) : (
                            <div className="divide-y divide-gray-100">
                                {members.map((m) => (
                                    <button
                                        key={m.userId}
                                        onClick={() => setSelected(m.userId)}
                                        className={`w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition ${selected === m.userId ? 'bg-blue-50/60' : ''}`}
                                    >
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-gray-900 truncate">{m.name || m.email}</p>
                                            <p className="text-xs text-gray-500 truncate">
                                                {m.role === UserRole.OWNER
                                                    ? tm.allBranches
                                                    : m.stores.length === 1
                                                        ? formatMessage(tm.branchCount, { count: m.stores.length })
                                                        : formatMessage(tm.branchCountPlural, { count: m.stores.length })}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${ROLE_STYLES[m.role] ?? 'bg-gray-100 text-gray-600'}`}>{m.role}</span>
                                            <ChevronRight className="w-4 h-4 text-gray-300" />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Detail */}
                    <div className="rounded-2xl border border-gray-200 bg-[#f9fafb] p-5 min-h-[300px]">
                        {selected ? (
                            <MemberPanel
                                userId={selected}
                                onToast={setToast}
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
            </div>

            <Toast toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
