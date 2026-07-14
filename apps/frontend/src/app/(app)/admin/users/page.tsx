'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import {
    KeyRound,
    Loader2,
    Mail,
    Pencil,
    Plus,
    Trash2,
} from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell, Button } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { toast } from '@/lib/toast';
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
            toast.success(formatMessage(m.deletedToast, { email: user.email }));
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
            toast.success(formatMessage(m.resetEmailSent, { email: user.email }));
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
            toast.success(formatMessage(m.resetPassword.success, { email: resetUser.email }));
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
        <PageShell>
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
                        <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />} className="shrink-0">
                            {m.addUser}
                        </Button>
                    )}
                />

                {error && (
                    <div className="rounded-md border border-danger bg-danger-light px-4 py-3 text-sm font-semibold text-danger-text">{error}</div>
                )}

                <input
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        void load(e.target.value);
                    }}
                    placeholder={m.searchPlaceholder}
                    className="w-full max-w-md rounded-md border border-gray-100 bg-white px-4 py-3 text-sm outline-none"
                />

                {isLoading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white p-8 text-sm text-gray-500">
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

            <PlatformUserFormModal
                open={formOpen}
                mode={formMode}
                user={selectedUser}
                onClose={() => setFormOpen(false)}
                onSaved={() => void load()}
            />

            {resetUser && (
                <ModalShell size="sm" onBackdropClick={() => setResetUser(null)}>
                    <ModalHeader
                        title={m.resetPassword.title}
                        subtitle={resetUser.email}
                        onClose={() => setResetUser(null)}
                    />
                    <div className="p-4 space-y-3 overflow-y-auto">
                        <label className="text-xs font-medium text-gray-500">{m.resetPassword.label}</label>
                        <input
                            type="password"
                            value={resetPassword}
                            onChange={(e) => setResetPassword(e.target.value)}
                            minLength={8}
                            placeholder={m.resetPassword.placeholder}
                            className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 focus:bg-white"
                        />
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setResetUser(null)}>
                            {m.resetPassword.cancel}
                        </Button>
                        <Button
                            disabled={resetting || resetPassword.length < 8}
                            loading={resetting}
                            onClick={() => void handleResetPassword()}
                        >
                            {resetting ? m.resetPassword.confirming : m.resetPassword.confirm}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}