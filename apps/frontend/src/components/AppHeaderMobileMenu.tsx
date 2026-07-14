'use client';

import { useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import VoiceNavWidget from '@/components/VoiceNavWidget';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { usePlatformFeatures } from '@/contexts/PlatformFeaturesContext';
import { useTenantLocales } from '@/contexts/TenantLocaleContext';
import { useI18n } from '@/lib/i18n';
import { useDismissable } from '@/hooks/useDismissable';

export default function AppHeaderMobileMenu() {
    const { t } = useI18n();
    const { voice } = usePlatformFeatures();
    const { showLanguageSwitcher } = useTenantLocales();
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useDismissable(rootRef, () => setOpen(false), open);

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
                        {voice ? (
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                    {t.components.voiceNavWidget.hintTitle}
                                </p>
                                <VoiceNavWidget />
                            </div>
                        ) : null}
                        {showLanguageSwitcher ? (
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                    {t.common.language}
                                </p>
                                <LanguageSwitcher />
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}