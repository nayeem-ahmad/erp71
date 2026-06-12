'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Mail, Plus, UserCog, X } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/format';

interface TeamMember {
    id: string;
    user_id: string;
    email: string;
    name?: string | null;
    role: string;
    is_owner?: boolean;
    joined_at: string;
}

interface PendingInvitation {
    id: string;
    email: string;
    role: string;
    expires_at: string;
    created_at: string;
    invited_by: { id: string; name: string };
}

const INVITABLE_ROLES = ['MANAGER', 'CASHIER', 'ACCOUNTANT'] as const;

const ROLE_BADGE: Record<string, string> = {
    OWNER: 'bg-violet-50 text-violet-700 border-violet-200',
    MANAGER: 'bg-blue-50 text-blue-700 border-blue-200',
    CASHIER: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ACCOUNTANT: 'bg-amber-50 text-amber-700 border-amber-200',
};

const memberColumnHelper = createColumnHelper<TeamMember>();
const inviteColumnHelper = createColumnHelper<PendingInvitation>();

function RoleBadge({ role }: { role: string }) {
    return (
        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${ROLE_BADGE[role] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
            {role}
        </span>
    );
}

export default function TeamSettingsPage() {
    const { t } = useI18n();
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [pending, setPending] = useState<PendingInvitation[]>([]);
    const [loading, setLoading] = useState(true);
    const [forbidden, setForbidden] = useState(false);
    const [showInviteForm, setShowInviteForm] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<(typeof INVITABLE_ROLES)[number]>('CASHIER');
    const [sending, setSending] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const loadTeam = async () => {
        try {
            const [membersData, pendingData] = await Promise.all([
                api.getTeamMembers(),
                api.getPendingInvitations(),
            ]);
            setMembers(Array.isArray(membersData) ? membersData : []);
            setPending(Array.isArray(pendingData) ? pendingData : []);
            setForbidden(false);
        } catch (error: any) {
            if (error?.message?.includes('OWNER or MANAGER')) {
                setForbidden(true);
            } else {
                console.error('Failed to load team', error);
                setToast({ type: 'error', message: error?.message || t.settings.team.loadFailed });
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadTeam();
        api.getMe()
            .then((me) => setCurrentUserId(me.id))
            .catch(() => null);
    }, []);

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(timer);
    }, [toast]);

    const handleInvite = async (event: React.FormEvent) => {
        event.preventDefault();
        const email = inviteEmail.trim().toLowerCase();
        if (!email) {
            setToast({ type: 'error', message: t.settings.team.emailRequired });
            return;
        }

        setSending(true);
        try {
            await api.sendInvitation({ email, role: inviteRole });
            setToast({ type: 'success', message: t.settings.team.inviteSent });
            setInviteEmail('');
            setShowInviteForm(false);
            await loadTeam();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.settings.team.inviteFailed });
        } finally {
            setSending(false);
        }
    };

    const canEditMemberRole = (member: TeamMember) =>
        !member.is_owner && member.role !== 'OWNER' && member.user_id !== currentUserId;

    const handleRoleChange = async (member: TeamMember, role: string) => {
        if (!canEditMemberRole(member) || member.role === role) return;

        setUpdatingUserId(member.user_id);
        try {
            await api.updateMemberRole(member.user_id, role);
            setMembers((prev) => prev.map((row) => (
                row.user_id === member.user_id ? { ...row, role } : row
            )));
            setToast({ type: 'success', message: t.settings.team.roleUpdated });
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.settings.team.roleUpdateFailed });
        } finally {
            setUpdatingUserId(null);
        }
    };

    const handleCancelInvite = async (id: string) => {
        if (!confirm(t.settings.team.cancelConfirm)) return;
        try {
            await api.cancelInvitation(id);
            setToast({ type: 'success', message: t.settings.team.inviteCancelled });
            await loadTeam();
        } catch (error: any) {
            setToast({ type: 'error', message: error?.message || t.settings.team.cancelFailed });
        }
    };

    const memberColumns: ColumnDef<TeamMember, any>[] = useMemo(
        () => [
            memberColumnHelper.accessor((row) => row.name || row.email, {
                id: 'member',
                header: t.settings.team.columns.member,
                cell: (info) => {
                    const member = info.row.original;
                    const isSelf = member.user_id === currentUserId;
                    return (
                        <div>
                            <span className="block text-sm font-black text-gray-900">
                                {member.name || member.email}
                                {isSelf && (
                                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-blue-600">
                                        {t.settings.team.youLabel}
                                    </span>
                                )}
                            </span>
                            {member.name && <span className="block text-xs text-gray-400">{member.email}</span>}
                        </div>
                    );
                },
                size: 260,
            }),
            memberColumnHelper.accessor('role', {
                header: t.settings.team.columns.role,
                cell: (info) => {
                    const member = info.row.original;
                    if (!canEditMemberRole(member)) {
                        return <RoleBadge role={info.getValue()} />;
                    }

                    return (
                        <div className="relative">
                            <select
                                value={member.role}
                                disabled={updatingUserId === member.user_id}
                                onChange={(event) => handleRoleChange(member, event.target.value)}
                                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                            >
                                {INVITABLE_ROLES.map((role) => (
                                    <option key={role} value={role}>{role}</option>
                                ))}
                            </select>
                            {updatingUserId === member.user_id && (
                                <Loader2 className="absolute -right-5 top-1.5 w-3.5 h-3.5 animate-spin text-blue-500" />
                            )}
                        </div>
                    );
                },
                size: 150,
            }),
            memberColumnHelper.accessor('joined_at', {
                header: t.settings.team.columns.joined,
                cell: (info) => (
                    <span className="text-sm text-gray-600">{formatDate(info.getValue())}</span>
                ),
                size: 140,
            }),
        ],
        [t, currentUserId, updatingUserId],
    );

    const pendingColumns: ColumnDef<PendingInvitation, any>[] = useMemo(
        () => [
            inviteColumnHelper.accessor('email', {
                header: t.settings.team.columns.email,
                cell: (info) => <span className="text-sm font-semibold text-gray-800">{info.getValue()}</span>,
                size: 240,
            }),
            inviteColumnHelper.accessor('role', {
                header: t.settings.team.columns.role,
                cell: (info) => <RoleBadge role={info.getValue()} />,
                size: 130,
            }),
            inviteColumnHelper.accessor((row) => row.invited_by.name, {
                id: 'invited_by',
                header: t.settings.team.columns.invitedBy,
                cell: (info) => <span className="text-sm text-gray-600">{info.getValue()}</span>,
                size: 160,
            }),
            inviteColumnHelper.accessor('expires_at', {
                header: t.settings.team.columns.expires,
                cell: (info) => (
                    <span className="text-sm text-gray-600">{formatDate(info.getValue())}</span>
                ),
                size: 140,
            }),
            inviteColumnHelper.display({
                id: 'actions',
                header: t.common.actions,
                cell: (info) => (
                    <button
                        type="button"
                        onClick={() => handleCancelInvite(info.row.original.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                    >
                        <X className="w-3.5 h-3.5" />
                        {t.settings.team.cancelInvite}
                    </button>
                ),
                size: 120,
            }),
        ],
        [t],
    );

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                {t.common.loading}
            </div>
        );
    }

    if (forbidden) {
        return (
            <div className="h-full overflow-y-auto">
                <div className="max-w-3xl mx-auto px-6 py-8">
                    <Link href="/dashboard/settings" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-6">
                        <ArrowLeft className="w-4 h-4" />
                        {t.common.back}
                    </Link>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-8 text-center">
                        <UserCog className="w-10 h-10 text-amber-500 mx-auto mb-3" />
                        <h1 className="text-lg font-bold text-gray-900">{t.settings.team.forbiddenTitle}</h1>
                        <p className="text-sm text-gray-600 mt-2">{t.settings.team.forbiddenDescription}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <Link href="/dashboard/settings" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-3">
                            <ArrowLeft className="w-4 h-4" />
                            {t.common.back}
                        </Link>
                        <h1 className="text-2xl font-black text-gray-900 tracking-tight">{t.settings.team.title}</h1>
                        <p className="mt-1 text-sm text-gray-500">{t.settings.team.description}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowInviteForm((open) => !open)}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        {t.settings.team.inviteButton}
                    </button>
                </div>

                {showInviteForm && (
                    <form onSubmit={handleInvite} className="rounded-2xl border border-blue-100 bg-blue-50/40 p-5 space-y-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
                            <Mail className="w-4 h-4" />
                            {t.settings.team.inviteFormTitle}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-3 items-end">
                            <label className="block">
                                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t.settings.team.emailLabel}</span>
                                <input
                                    type="email"
                                    value={inviteEmail}
                                    onChange={(event) => setInviteEmail(event.target.value)}
                                    placeholder="staff@example.com"
                                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                    required
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t.settings.team.roleLabel}</span>
                                <select
                                    value={inviteRole}
                                    onChange={(event) => setInviteRole(event.target.value as (typeof INVITABLE_ROLES)[number])}
                                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                >
                                    {INVITABLE_ROLES.map((role) => (
                                        <option key={role} value={role}>{role}</option>
                                    ))}
                                </select>
                            </label>
                            <button
                                type="submit"
                                disabled={sending}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                            >
                                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                                {t.settings.team.sendInvite}
                            </button>
                        </div>
                    </form>
                )}

                <section className="space-y-3">
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-500">{t.settings.team.membersTitle}</h2>
                    <DataTable
                        tableId="team-members"
                        title="Team Members"
                        data={members}
                        columns={memberColumns}
                        searchPlaceholder={t.settings.team.searchMembers}
                        emptyMessage={t.settings.team.noMembers}
                    />
                </section>

                <section className="space-y-3">
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-500">{t.settings.team.pendingTitle}</h2>
                    <DataTable
                        tableId="team-pending"
                        title="Pending Invitations"
                        data={pending}
                        columns={pendingColumns}
                        searchPlaceholder={t.settings.team.searchPending}
                        emptyMessage={t.settings.team.noPending}
                    />
                </section>
            </div>

            {toast && (
                <div className={`fixed bottom-6 right-6 z-50 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg ${
                    toast.type === 'success'
                        ? 'bg-green-50 border-green-200 text-green-800'
                        : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                    {toast.message}
                </div>
            )}
        </div>
    );
}