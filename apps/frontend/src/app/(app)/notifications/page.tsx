'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, CheckCheck, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { NotificationIcon } from '@/components/NotificationIcon';

interface Notification {
    id: string;
    type: string;
    title: string;
    body: string;
    link?: string | null;
    read_at: string | null;
    created_at: string;
}

const PAGE_SIZE = 20;

export default function NotificationsPage() {
    const { t } = useI18n();
    const m = t.components.notificationsPage;
    const router = useRouter();

    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(true);

    const timeAgo = useCallback((dateStr: string): string => {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return m.timeAgo.justNow;
        if (mins < 60) return formatMessage(m.timeAgo.minutes, { count: mins });
        const hours = Math.floor(mins / 60);
        if (hours < 24) return formatMessage(m.timeAgo.hours, { count: hours });
        const days = Math.floor(hours / 24);
        return formatMessage(m.timeAgo.days, { count: days });
    }, [m.timeAgo]);

    const loadNotifications = useCallback(async () => {
        setLoading(true);
        try {
            const [list, countRes] = await Promise.all([
                api.getNotifications({ page, limit: PAGE_SIZE }),
                api.getNotificationUnreadCount(),
            ]);
            setNotifications(list.items);
            setPages(Math.max(1, list.pages));
            setUnreadCount((countRes as { count?: number })?.count ?? 0);
        } catch {
            setNotifications([]);
            setPages(1);
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => {
        void loadNotifications();
    }, [loadNotifications]);

    const handleMarkRead = async (n: Notification, e: React.MouseEvent) => {
        e.stopPropagation();
        if (n.read_at) return;
        try {
            await api.markNotificationRead(n.id);
            setNotifications((prev) =>
                prev.map((item) => item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item)
            );
            setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch { /* ignore */ }
    };

    const handleNotificationClick = async (n: Notification) => {
        if (!n.read_at) {
            try {
                await api.markNotificationRead(n.id);
                setNotifications((prev) =>
                    prev.map((item) => item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item)
                );
                setUnreadCount((prev) => Math.max(0, prev - 1));
            } catch { /* ignore */ }
        }
        if (n.link) {
            router.push(n.link);
        }
    };

    const handleMarkAllRead = async () => {
        try {
            await api.markAllNotificationsRead();
            setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
            setUnreadCount(0);
        } catch { /* ignore */ }
    };

    return (
        <div className="overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px] space-y-4">
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={[{ label: m.title }]}
                actions={unreadCount > 0 ? (
                    <button
                        type="button"
                        onClick={() => void handleMarkAllRead()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                        <CheckCheck className="w-3.5 h-3.5" />
                        {m.markAllRead}
                    </button>
                ) : undefined}
            />

            {unreadCount > 0 && (
                <p className="text-sm text-gray-500 font-medium">
                    {formatMessage(m.unread, { count: unreadCount })}
                </p>
            )}

            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                {loading ? (
                    <div className="py-16 flex flex-col items-center justify-center text-sm text-gray-400 gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {m.loading}
                    </div>
                ) : notifications.length === 0 ? (
                    <div className="py-16 text-center">
                        <Bell className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                        <p className="text-sm text-gray-400 font-medium">{m.empty}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {notifications.map((n) => (
                            <div
                                key={n.id}
                                onClick={() => void handleNotificationClick(n)}
                                className={`flex gap-4 px-4 py-4 cursor-pointer transition-colors ${
                                    n.read_at ? 'hover:bg-gray-50' : 'bg-blue-50/30 hover:bg-blue-50/60'
                                }`}
                            >
                                <div className="pt-0.5">
                                    <NotificationIcon type={n.type} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm leading-snug ${n.read_at ? 'text-gray-600 font-medium' : 'text-gray-900 font-semibold'}`}>
                                        {n.title}
                                    </p>
                                    <p className="text-sm text-gray-500 mt-1 leading-relaxed">{n.body}</p>
                                    <p className="text-xs text-gray-400 mt-2 font-medium">{timeAgo(n.created_at)}</p>
                                </div>
                                {!n.read_at && (
                                    <button
                                        type="button"
                                        onClick={(e) => void handleMarkRead(n, e)}
                                        className="flex-shrink-0 self-start p-1.5 text-gray-300 hover:text-blue-500 rounded-lg hover:bg-white transition-colors"
                                        title={t.components.notificationBell.markReadTitle}
                                    >
                                        <Check className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {pages > 1 && (
                <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-gray-500">
                        {formatMessage(m.pageOf, { page, pages })}
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={page <= 1 || loading}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {m.previous}
                        </button>
                        <button
                            type="button"
                            disabled={page >= pages || loading}
                            onClick={() => setPage((p) => p + 1)}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {m.next}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}