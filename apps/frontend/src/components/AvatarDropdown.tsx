'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    User,
    LogOut,
    ChevronDown,
    Users,
    Loader2,
} from 'lucide-react';
import { clearAuthSession } from '@/lib/auth-session';
import { routes } from '@/lib/routes';
import { useI18n } from '@/lib/i18n';

interface AvatarDropdownProps {
    userName: string;
    roleLabel?: string;
    avatarUrl?: string | null;
    canSwitchAccount?: boolean;
}

export default function AvatarDropdown({
    userName,
    roleLabel,
    avatarUrl,
    canSwitchAccount = false,
}: AvatarDropdownProps) {
    const { t } = useI18n();
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [switching, setSwitching] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    const handleSwitchAccount = () => {
        setIsOpen(false);
        setSwitching(true);
        setTimeout(() => setSwitching(false), 600);
        router.push(routes.selectAccount);
    };

    const handleMyProfile = () => {
        setIsOpen(false);
        router.push(routes.profile);
    };

    const handleSignOut = () => {
        setIsOpen(false);
        clearAuthSession();
        router.push('/login');
    };

    const initial = userName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    const avatarNode = avatarUrl ? (
        <img
            src={avatarUrl}
            alt={userName}
            className="w-8 h-8 rounded-full object-cover flex-shrink-0 ring-2 ring-white shadow-sm"
        />
    ) : (
        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0 ring-2 ring-white shadow-sm">
            {initial || 'U'}
        </div>
    );

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                className="flex items-center gap-2 hover:bg-gray-50 rounded-xl px-2 py-1.5 transition-colors"
                aria-label="User menu"
                aria-expanded={isOpen}
            >
                <div className="text-right hidden sm:block">
                    <p className="text-sm font-semibold tracking-tight leading-none text-gray-800">
                        {userName}
                    </p>
                    {roleLabel ? (
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                            {roleLabel}
                        </p>
                    ) : null}
                </div>
                {avatarNode}
                <ChevronDown
                    className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${
                        isOpen ? 'rotate-180' : ''
                    }`}
                />
            </button>

            <div
                className={`absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden transition-all duration-150 origin-top-right ${
                    isOpen
                        ? 'opacity-100 scale-100 translate-y-0'
                        : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'
                }`}
            >
                <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-bold text-gray-900 truncate">{userName}</p>
                    {roleLabel ? (
                        <p className="text-xs text-gray-400 truncate mt-0.5">{roleLabel}</p>
                    ) : null}
                </div>

                <div className="py-1">
                    {canSwitchAccount ? (
                        <button
                            type="button"
                            onClick={handleSwitchAccount}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            {switching ? (
                                <Loader2 className="w-4 h-4 text-gray-400 animate-spin flex-shrink-0" />
                            ) : (
                                <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            )}
                            <span>{t.profile.switchAccount}</span>
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={handleMyProfile}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span>{t.profile.myProfile}</span>
                    </button>
                </div>

                <div className="border-t border-gray-100 py-1">
                    <button
                        type="button"
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                        <LogOut className="w-4 h-4 flex-shrink-0" />
                        <span>{t.profile.signOut}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}