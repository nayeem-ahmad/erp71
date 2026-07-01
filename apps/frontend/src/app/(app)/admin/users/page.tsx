'use client';

import { useI18n, formatMessage } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Search, ShieldCheck, ShieldOff, Loader2, CheckCircle, User } from 'lucide-react';
import { api } from '@/lib/api';

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
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [actionUserId, setActionUserId] = useState('');
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');

    const load = async (q?: string) => {
        setIsLoading(true);
        try {
            const res: any = await api.getAdminUsers({ search: q || search || undefined, limit: 50 });
            setUsers(res.data ?? []);
            setTotal(res.total ?? 0);
        } catch (err: any) {
            setError(err.message || m.loadFailed);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { void load(); }, []);

    const handleSearch = (value: string) => {
        setSearch(value);
        void load(value);
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

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{m.title}</h1>
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-1">
                        {formatMessage(m.subtitle, { total })}
                    </p>
                </div>

                {toast && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                        <CheckCircle className="w-4 h-4" /> {toast}
                    </div>
                )}

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
                )}

                <div className="rounded-3xl border border-gray-100 bg-white overflow-hidden">
                    <div className="p-4 border-b border-gray-100">
                        <label className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-2.5 flex items-center gap-3">
                            <Search className="w-4 h-4 text-gray-400 shrink-0" />
                            <input
                                value={search}
                                onChange={(e) => handleSearch(e.target.value)}
                                placeholder={m.searchPlaceholder}
                                className="w-full bg-transparent outline-none text-sm"
                            />
                        </label>
                    </div>

                    {isLoading ? (
                        <div className="p-10 flex items-center justify-center text-sm text-gray-500">
                            <Loader2 className="w-4 h-4 animate-spin mr-2" /> {m.loading}
                        </div>
                    ) : users.length === 0 ? (
                        <div className="p-10 text-center text-sm text-gray-500">{m.noUsers}</div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {users.map((user) => (
                                <div key={user.id} className="px-5 py-4 flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                                            <User className="w-4 h-4 text-gray-400" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-gray-900 truncate">{user.name || user.email}</p>
                                            <p className="text-xs text-gray-500 truncate">{user.email}</p>
                                            <p className="text-[10px] text-gray-400 mt-0.5">{user.tenant_count === 1 ? formatMessage(m.tenantCount, { count: user.tenant_count }) : formatMessage(m.tenantCountPlural, { count: user.tenant_count })}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        {user.is_platform_admin && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-700">
                                                <ShieldCheck className="w-3 h-3" /> Admin
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => void toggleAdmin(user)}
                                            disabled={actionUserId === user.id}
                                            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition disabled:opacity-50 ${
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
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
