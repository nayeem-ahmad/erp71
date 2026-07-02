'use client';

import { useI18n, formatMessage } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Search, ShieldCheck, ShieldOff, Loader2, CheckCircle, User, ChevronLeft, ChevronRight } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

const PAGE_SIZE = 20;

type AdminUser = {
    id: string;
    email: string;
    name: string | null;
    is_platform_admin: boolean;
    email_verified: boolean;
    tenant_count: number;
    created_at: string;
};

export default function AdminUsersPage() {
    const { t } = useI18n();
    const m = t.admin.users;
    const [selfId, setSelfId] = useState<string>('');
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [adminFilter, setAdminFilter] = useState<boolean | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(true);
    const [actionUserId, setActionUserId] = useState('');
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');

    useEffect(() => {
        api.getMe().then((me: any) => setSelfId(me?.id ?? '')).catch(() => null);
    }, []);

    const load = async (opts?: { q?: string; p?: number; isAdmin?: boolean | undefined }) => {
        setIsLoading(true);
        setError('');
        try {
            const res: any = await api.getAdminUsers({
                search: opts?.q ?? search || undefined,
                page: opts?.p ?? page,
                limit: PAGE_SIZE,
                isAdmin: opts?.isAdmin !== undefined ? opts.isAdmin : adminFilter,
            });
            setUsers(res.data ?? []);
            setTotal(res.total ?? 0);
        } catch (err: any) {
            setError(err.message || m.loadFailed);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSearch = (value: string) => {
        setSearch(value);
        setPage(1);
        void load({ q: value, p: 1, isAdmin: adminFilter });
    };

    const handleFilterChange = (isAdmin: boolean | undefined) => {
        setAdminFilter(isAdmin);
        setPage(1);
        void load({ q: search, p: 1, isAdmin });
    };

    const handlePageChange = (next: number) => {
        setPage(next);
        void load({ p: next });
    };

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3000);
    };

    const toggleAdmin = async (user: AdminUser) => {
        setActionUserId(user.id);
        setError('');
        try {
            if (user.is_platform_admin) {
                await api.demoteUser(user.id);
                showToast(formatMessage(m.removedAdmin, { email: user.email }));
            } else {
                await api.promoteUser(user.id);
                showToast(formatMessage(m.grantedAdmin, { email: user.email }));
            }
            await load();
        } catch (err: any) {
            setError(err.message || m.actionFailed);
        } finally {
            setActionUserId('');
        }
    };

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <PageHeader
                    title={m.title}
                    subtitle={formatMessage(m.subtitle, { total })}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        m.title,
                        'admin',
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

                <div className="rounded-3xl border border-gray-100 bg-white overflow-hidden">
                    {/* Search + filter toolbar */}
                    <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <label className="flex-1 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-2.5 flex items-center gap-3">
                            <Search className="w-4 h-4 text-gray-400 shrink-0" />
                            <input
                                value={search}
                                onChange={(e) => handleSearch(e.target.value)}
                                placeholder={m.searchPlaceholder}
                                className="w-full bg-transparent outline-none text-sm"
                            />
                        </label>
                        <div className="flex rounded-2xl border border-gray-100 bg-gray-50 p-1 gap-1 shrink-0">
                            <FilterBtn active={adminFilter === undefined} onClick={() => handleFilterChange(undefined)}>
                                {m.filterAll}
                            </FilterBtn>
                            <FilterBtn active={adminFilter === true} onClick={() => handleFilterChange(true)}>
                                <ShieldCheck className="w-3 h-3" />
                                {m.filterAdmins}
                            </FilterBtn>
                        </div>
                    </div>

                    {isLoading ? (
                        <div className="p-10 flex items-center justify-center text-sm text-gray-500">
                            <Loader2 className="w-4 h-4 animate-spin mr-2" /> {m.loading}
                        </div>
                    ) : users.length === 0 ? (
                        <div className="p-10 text-center text-sm text-gray-500">{m.noUsers}</div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {users.map((user) => {
                                const isSelf = user.id === selfId;
                                return (
                                    <div key={user.id} className="px-5 py-4 flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                                                <User className="w-4 h-4 text-gray-400" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-black text-gray-900 truncate">{user.name || user.email}</p>
                                                <p className="text-xs text-gray-500 truncate">{user.email}</p>
                                                <p className="text-[10px] text-gray-400 mt-0.5">
                                                    {user.tenant_count === 1
                                                        ? formatMessage(m.tenantCount, { count: user.tenant_count })
                                                        : formatMessage(m.tenantCountPlural, { count: user.tenant_count })}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {isSelf && (
                                                <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-blue-700">
                                                    {m.youBadge}
                                                </span>
                                            )}
                                            {user.is_platform_admin && (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-700">
                                                    <ShieldCheck className="w-3 h-3" /> {m.adminBadge}
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => void toggleAdmin(user)}
                                                disabled={actionUserId === user.id || isSelf}
                                                title={isSelf ? m.selfDemoteError : undefined}
                                                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition disabled:opacity-40 disabled:cursor-not-allowed ${
                                                    user.is_platform_admin
                                                        ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                                        : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                                                }`}
                                            >
                                                {actionUserId === user.id ? (
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : user.is_platform_admin ? (
                                                    <ShieldOff className="w-3 h-3" />
                                                ) : (
                                                    <ShieldCheck className="w-3 h-3" />
                                                )}
                                                {user.is_platform_admin ? m.revokeAdmin : m.makeAdmin}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Pagination */}
                    {!isLoading && totalPages > 1 && (
                        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-4">
                            <span className="text-xs text-gray-500">
                                {formatMessage(m.pageOf, { page, total: totalPages })}
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => handlePageChange(page - 1)}
                                    disabled={page <= 1}
                                    className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-black bg-gray-50 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                >
                                    <ChevronLeft className="w-3 h-3" /> {m.prev}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handlePageChange(page + 1)}
                                    disabled={page >= totalPages}
                                    className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-black bg-gray-50 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                >
                                    {m.next} <ChevronRight className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function FilterBtn({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-black transition ${
                active ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
        >
            {children}
        </button>
    );
}
