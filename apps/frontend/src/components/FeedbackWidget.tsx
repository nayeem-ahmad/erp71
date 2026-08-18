'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { usePlatformFeatures } from '@/contexts/PlatformFeaturesContext';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import SupportComposer from '@/components/SupportComposer';
import { routes } from '@/lib/routes';

export default function FeedbackWidget() {
    const { t } = useI18n();
    const m = t.components.feedbackWidget;
    const { support, feedback } = usePlatformFeatures();
    const router = useRouter();
    const [open, setOpen] = useState(false);

    if (!support && !feedback) return null;

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="relative p-2 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors rounded-lg hover:bg-gray-100 min-h-touch min-w-touch inline-flex items-center justify-center"
                aria-label={m.openAria}
            >
                <MessageSquare className="w-5 h-5" />
            </button>

            {open && (
                <ModalShell size="sm" onBackdropClick={() => setOpen(false)}>
                    <ModalHeader title={m.title} onClose={() => setOpen(false)} />
                    <div className="p-4">
                        <SupportComposer
                            supportEnabled={support}
                            feedbackEnabled={feedback}
                            capturePage
                            onCancel={() => setOpen(false)}
                            onCreated={(threadId) => {
                                setOpen(false);
                                router.push(`${routes.support}?thread=${threadId}`);
                            }}
                        />
                    </div>
                </ModalShell>
            )}
        </>
    );
}
