'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import {
    CheckCircle,
    KeyRound,
    Loader2,
    Mail,
    Pencil,
    Plus,
    Trash2,
} from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DataTable } from '@/components/data-table';
import PlatformUserFormModal, { type PlatformAdminUser } from '@/components/admin/platform-users/PlatformUserFormModal';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { formatMessage, useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

const columnHelper = createColumnHelper<PlatformAdminUser & { email_verified?: boolean; created_at?: string }>();

export default function AdminUsersPage() {
    const { t } = useI18n();
    const m = t.admin.users;
    const [selfId, setSelfId] = useState('');
    const [users, setUsers] = useState<Array<PlatformAdminUser & { email_verified?: boolean; created_at?: string }>>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
    const [selectedUser, setSelectedUser] = useState<PlatformAdminUser | null>(null);
    const [resetUser, setResetUser] = useState<PlatformAdminUser | null>(null);
    const [resetPassword, setResetPassword] = useState('');
    const [resetting, setResetting] = useState(false);
    const [actionUserId, setActionUserId] = useState('');

    useEffect(() => {
        api.getMe().then((me: { id?: string }) => setSelfId(me?.id ?? '')).catch(() => null);
    }, []);

    const load = async (query = search) => {
        setIsLoading(true);
        setError('');
        try {
            const res: { data?: PlatformAdminUser[] } = await api.getAdminUsers({
                search: query || undefined,
                page: 1,
                limit: 100,
            });
            setUsers(res.data ?? []);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.loadFailed);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3500);
    };

    const openCreate = () => {
        setFormMode('create');
        setSelectedUser(null);
        setFormOpen(true);
    };

    const openEdit = (user: PlatformAdminUser) => {
        setFormMode('edit');
        setSelectedUser(user);
        setFormOpen(true);
    };

    const handleDelete = async (user: PlatformAdminUser) => {
        if (!window.confirm(formatMessage(m.deleteConfirm, { email: user.email }))) return;
        setActionUserId(user.id);
        setError('');
        try {
            await api.deletePlatformAdminUser(user.id);
            showToast(formatMessage(m.deletedToast, { email: user.email }));
            await load();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.deleteFailed);
        } finally {
            setActionUserId('');
        }
    };

    const handleSendResetEmail = async (user: PlatformAdminUser) => {
        setActionUserId(user.id);
        setError('');
        try {
            await api.sendPlatformAdminUserResetEmail(user.id);
            showToast(formatMessage(m.resetEmailSent, { email: user.email }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.resetEmailFailed);
        } finally {
            setActionUserId('');
        }
    };

    const handleResetPassword = async () => {
        if (!resetUser) return;
        setResetting(true);
        setError('');
        try {
            await api.resetPlatformAdminUserPassword(resetUser.id, resetPassword);
            showToast(formatMessage(m.resetPassword.success, { email: resetUser.email }));
            setResetUser(null);
            setResetPassword('');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : m.resetPassword.failed);
        } finally {
            setResetting(false);
        }
    };

    const columns: ColumnDef<PlatformAdminUser & { created_at?: string }, unknown>[] = useMemo(() => [
        columnHelper.accessor((row) => row.name || row.email, {
            id: 'name',
            header: m.columns.name,
            cell: (info) => <span className="font-semibold text-gray-900">{info.getValue()}</span>,
        }),
        columnHelper.accessor('email', {
            header: m.columns.email,
            cell: (info) => <span className="text-gray-600">{info.getValue()}</span>,
        }),
        columnHelper.accessor('mobile', {
            header: m.columns.mobile,
            cell: (info) => info.getValue() || '—',
        }),
        columnHelper.accessor('created_at', {
            header: m.columns.created,
            cell: (info) => info.getValue() ? formatDate(info.getValue() as string) : '—',
        }),
        columnHelper.display({
            id: 'actions',
            header: m.columns.actions,
            cell: ({ row }) => {
                const user = row.original;
                const isSelf = user.id === selfId;
                const busy = actionUserId === user.id;
                return (
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            title={m.actions.edit}
                            aria-label={m.actions.edit}
                            onClick={() => openEdit(user)}
                            className="rounded-xl border border-gray-200 bg-white p-2 text-gray-600 hover:border-blue-300 hover:text-blue-600"
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            title={m.actions.resetPassword}
                            aria-label={m.actions.resetPassword}
                            onClick={() => { setResetUser(user); setResetPassword(''); }}
                            className="rounded-xl border border-gray-200 bg-white p-2 text-gray-600 hover:border-amber-300 hover:text-amber-600"
                        >
                            <KeyRound className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            title={m.actions.sendResetEmail}
                            aria-label={m.actions.sendResetEmail}
                            disabled={busy}
                            onClick={() => void handleSendResetEmail(user)}
                            className="rounded-xl border border-gray-200 bg-white p-2 text-gray-600 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
                        >
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                        </button>
                        <button
                            type="button"
                            title={m.actions.delete}
                            aria-label={m.actions.delete}
                            disabled={busy || isSelf}
                            onClick={() => void handleDelete(user)}
                            className="rounded-xl border border-gray-200 bg-white p-2 text-gray-600 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                );
            },
        }),
    ], [actionUserId, m, selfId]);

    return (
        <div className="overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={formatMessage(m.subtitle, { total: users.length })}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        m.title,
                        'admin',
                    )}
                    actions={(
                        <button
                            type="button"
                            onClick={openCreate}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors shrink-0"
                        >
                            <Plus className="w-4 h-4" /> {m.addUser}
                        </button>
                    )}
                />

                {toast && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                        <CheckCircle className="w-4 h-4" /> {toast}
                    </div>
                )}

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
                )}

                <input
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        void load(e.target.value);
                    }}
                    placeholder={m.searchPlaceholder}
                    className="w-full max-w-md rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm outline-none"
                />

                {isLoading ? (
                    <div className="flex items-center gap-2 rounded-3xl border border-gray-100 bg-white p-8 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> {m.loading}
                    </div>
                ) : (
                    <DataTable
                        tableId="admin-platform-users"
                        columns={columns}
                        data={users}
                        title={m.title}
                        emptyMessage={m.noUsers}
                    />
                )}
            </div>

            <PlatformUserFormModal
                open={formOpen}
                mode={formMode}
                user={selectedUser}
                onClose={() => setFormOpen(false)}
                onSaved={() => void load()}
            />

            {resetUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setResetUser(null)}>
                    <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="border-b border-gray-100 px-6 py-5">
                            <h2 className="text-lg font-black tracking-tight">{m.resetPassword.title}</h2>
                            <p className="mt-1 text-sm text-gray-500">{resetUser.email}</p>
                        </div>
                        <div className="p-6 space-y-3">
                            <label className="text-xs font-medium text-gray-500">{m.resetPassword.label}</label>
                            <input
                                type="password"
                                value={resetPassword}
                                onChange={(e) => setResetPassword(e.target.value)}
                                minLength={8}
                                placeholder={m.resetPassword.placeholder}
                                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                            />
                        </div>
                        <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
                            <button
                                type="button"
                                onClick={() => setResetUser(null)}
                                className="rounded-2xl bg-gray-100 px-5 py-2.5 text-sm font-black text-gray-700"
                            >
                                {m.resetPassword.cancel}
                            </button>
                            <button
                                type="button"
                                disabled={resetting || resetPassword.length < 8}
                                onClick={() => void handleResetPassword()}
                                className="inline-flex items-center gap-2 rounded-2xl bg-amber-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-60"
                            >
                                {resetting
                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> {m.resetPassword.confirming}</>
                                    : m.resetPassword.confirm}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}