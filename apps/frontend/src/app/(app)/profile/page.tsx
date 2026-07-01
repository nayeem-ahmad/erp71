'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, CheckCircle, Loader2, Settings, XCircle } from 'lucide-react';
import { api, fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import AvatarCropModal from '@/components/AvatarCropModal';

type ToastState = { type: 'success' | 'error'; message: string } | null;

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(onDismiss, 4000);
        return () => clearTimeout(timer);
    }, [toast, onDismiss]);

    if (!toast) return null;

    const isSuccess = toast.type === 'success';
    return (
        <div
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold ${
                isSuccess
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-red-50 border-red-200 text-red-800'
            }`}
        >
            {isSuccess ? (
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
            ) : (
                <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            )}
            {toast.message}
        </div>
    );
}

export default function ProfilePage() {
    const { t } = useI18n();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [user, setUser] = useState<any>(null);
    const [name, setName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [toast, setToast] = useState<ToastState>(null);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [cropOpen, setCropOpen] = useState(false);

    useEffect(() => {
        api.getMe()
            .then((me) => {
                setUser(me);
                setName(me?.name || '');
                setAvatarUrl(me?.avatar_url || null);
            })
            .catch(() => null)
            .finally(() => setLoading(false));
    }, []);

    const initials = (name || user?.name || 'U')
        .split(' ')
        .map((part: string) => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    const handleFilePick = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setToast({ type: 'error', message: t.profile.uploadFailed });
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            setCropSrc(reader.result as string);
            setCropOpen(true);
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    };

    const handleCropConfirm = async (file: File) => {
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('avatar', file);
            const result: { avatarUrl?: string } = await api.updateProfileAvatar(formData);
            const nextUrl = result?.avatarUrl ?? null;
            setAvatarUrl(nextUrl);
            setToast({ type: 'success', message: t.profile.uploadSuccess });
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || t.profile.uploadFailed });
        } finally {
            setUploading(false);
            setCropSrc(null);
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) {
            setToast({ type: 'error', message: t.profile.nameRequired });
            return;
        }
        setSaving(true);
        try {
            await fetchWithAuth('/auth/me', {
                method: 'PATCH',
                body: JSON.stringify({ name: name.trim() }),
                headers: { 'Content-Type': 'application/json' },
            });
            setUser((current: any) => ({ ...current, name: name.trim() }));
            setToast({ type: 'success', message: t.profile.profileUpdated });
        } catch (err: any) {
            setToast({ type: 'error', message: err?.message || t.profile.profileFailed });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="p-8 text-sm text-gray-500">{t.settings.loading}</div>;
    }

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-2xl mx-auto space-y-6">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950 text-gray-900">{t.profile.pageTitle}</h1>
                    <p className="text-sm text-gray-500 mt-1">{t.profile.pageDescription}</p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 shadow-sm space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                        <div className="relative flex-shrink-0">
                            {avatarUrl ? (
                                <img
                                    src={avatarUrl}
                                    alt={name || user?.name || 'Profile'}
                                    className="w-24 h-24 rounded-full object-cover ring-4 ring-white shadow-md"
                                />
                            ) : (
                                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-black ring-4 ring-white shadow-md">
                                    {initials}
                                </div>
                            )}
                            {uploading && (
                                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleFilePick}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-bold text-gray-800 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-60"
                            >
                                <Camera className="w-4 h-4" />
                                {t.profile.changePhoto}
                            </button>
                            <p className="text-xs text-gray-400">{t.profile.photoHint}</p>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-5 border-t border-gray-100 pt-6">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {t.profile.nameLabel}
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t.profile.namePlaceholder}
                                className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                {t.profile.emailLabel}
                            </label>
                            <input
                                type="email"
                                value={user?.email || ''}
                                readOnly
                                disabled
                                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-400 cursor-not-allowed"
                            />
                            <p className="mt-1.5 text-xs text-gray-400">{t.profile.emailReadonly}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 pt-2">
                            <button
                                type="submit"
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                            >
                                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {saving ? t.profile.saving : t.profile.saveChanges}
                            </button>
                            <Link
                                href={routes.settings.root}
                                className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-blue-600"
                            >
                                <Settings className="w-4 h-4" />
                                {t.profile.securitySettings}
                            </Link>
                        </div>
                    </form>
                </div>
            </div>

            {cropSrc && (
                <AvatarCropModal
                    imageSrc={cropSrc}
                    open={cropOpen}
                    title={t.profile.cropTitle}
                    confirmLabel={t.profile.cropConfirm}
                    cancelLabel={t.profile.cropCancel}
                    onClose={() => {
                        setCropOpen(false);
                        setCropSrc(null);
                    }}
                    onConfirm={handleCropConfirm}
                />
            )}

            <Toast toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}