'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, CheckCheck, Package, CreditCard, Info, X } from 'lucide-react';
import { api } from '@/lib/api';

interface Notification {
    id: string;
    type: string;
    title: string;
    body: string;
    link?: string | null;
    read_at: string | null;
    created_at: string;
}

function NotificationIcon({ type }: { type: string }) {
    if (type === 'LOW_STOCK') return <Package className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />;
    if (type === 'SUBSCRIPTION_EXPIRY') return <CreditCard className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />;
    return <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />;
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export default function NotificationBell() {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    const fetchCount = useCallback(async () => {
        try {
            const data = await api.getNotificationUnreadCount();
            setUnreadCount((data as any)?.count ?? 0);
        } catch {
            // silently ignore if not authenticated yet
        }
    }, []);

    // Poll unread count every 60s
    useEffect(() => {
        fetchCount();
        const interval = setInterval(fetchCount, 60_000);
        return () => clearInterval(interval);
    }, [fetchCount]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleOpen = async () => {
        if (open) { setOpen(false); return; }
        setOpen(true);
        setLoading(true);
        try {
            const data = await api.getNotifications();
            setNotifications(Array.isArray(data) ? data : []);
            setUnreadCount(0);
        } catch {
            setNotifications([]);
        } finally {
            setLoading(false);
        }
    };

    const handleMarkRead = async (n: Notification, e: React.MouseEvent) => {
        e.stopPropagation();
        if (n.read_at) return;
        try {
            await api.markNotificationRead(n.id);
            setNotifications((prev) =>
                prev.map((item) => item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item)
            );
        } catch { /* ignore */ }
    };

    const handleNotificationClick = async (n: Notification) => {
        if (!n.read_at) {
            try {
                await api.markNotificationRead(n.id);
                setNotifications((prev) =>
                    prev.map((item) => item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item)
                );
            } catch { /* ignore */ }
        }
        if (n.link) {
            setOpen(false);
            router.push(n.link);
        }
    };

    const handleMarkAllRead = async () => {
        try {
            await api.markAllNotificationsRead();
            setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
        } catch { /* ignore */ }
    };

    const unread = notifications.filter((n) => !n.read_at);

    return (
        <div className="relative" ref={panelRef}>
            <button
                onClick={handleOpen}
                className="relative p-2 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors rounded-lg hover:bg-gray-100"
                aria-label="Notifications"
            >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 bg-red-500 rounded-full border-2 border-white flex items-center justify-center text-[9px] font-black text-white px-0.5">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-gray-900">Notifications</h3>
                            {unread.length > 0 && (
                                <span className="text-[10px] font-black bg-red-100 text-red-600 rounded-full px-1.5 py-0.5">
                                    {unread.length}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            {unread.length > 0 && (
                                <button
                                    onClick={handleMarkAllRead}
                                    className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                                    title="Mark all as read"
                                >
                                    <CheckCheck className="w-3.5 h-3.5" />
                                    All read
                                </button>
                            )}
                            <button
                                onClick={() => setOpen(false)}
                                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* List */}
                    <div className="max-h-96 overflow-y-auto">
                        {loading ? (
                            <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
                        ) : notifications.length === 0 ? (
                            <div className="py-10 text-center">
                                <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                                <p className="text-sm text-gray-400 font-medium">No notifications yet</p>
                            </div>
                        ) : (
                            notifications.map((n) => (
                                <div
                                    key={n.id}
                                    onClick={() => handleNotificationClick(n)}
                                    className={`flex gap-3 px-4 py-3 border-b border-gray-50 last:border-0 cursor-pointer transition-colors ${
                                        n.read_at ? 'hover:bg-gray-50' : 'bg-blue-50/40 hover:bg-blue-50'
                                    }`}
                                >
                                    <div className="pt-0.5">
                                        <NotificationIcon type={n.type} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm leading-snug ${n.read_at ? 'text-gray-600 font-medium' : 'text-gray-900 font-semibold'}`}>
                                            {n.title}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-0.5 leading-snug line-clamp-2">{n.body}</p>
                                        <p className="text-[10px] text-gray-400 mt-1 font-medium">{timeAgo(n.created_at)}</p>
                                    </div>
                                    {!n.read_at && (
                                        <button
                                            onClick={(e) => handleMarkRead(n, e)}
                                            className="flex-shrink-0 p-1 text-gray-300 hover:text-blue-500 rounded transition-colors"
                                            title="Mark as read"
                                        >
                                            <Check className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
