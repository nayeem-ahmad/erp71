'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import VoiceNavWidget from '@/components/VoiceNavWidget';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useI18n } from '@/lib/i18n';

export default function AppHeaderMobileMenu() {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        const onPointer = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        window.addEventListener('keydown', onKey);
        const id = window.setTimeout(() => document.addEventListener('mousedown', onPointer), 0);

        return () => {
            window.removeEventListener('keydown', onKey);
            window.clearTimeout(id);
            document.removeEventListener('mousedown', onPointer);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative md:hidden">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="min-h-touch min-w-touch flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors"
                aria-label={t.dashboardLayout.headerMoreMenuAria}
                aria-expanded={open}
            >
                <MoreHorizontal className="w-5 h-5" />
            </button>

            {open ? (
                <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
                    <div className="space-y-4">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                {t.components.voiceNavWidget.hintTitle}
                            </p>
                            <VoiceNavWidget />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                {t.common.language}
                            </p>
                            <LanguageSwitcher />
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}