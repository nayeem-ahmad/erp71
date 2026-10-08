'use client';

import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { usePlatformFeatures } from '@/contexts/PlatformFeaturesContext';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import SupportComposer from '@/components/SupportComposer';
import { routes } from '@/lib/routes';

/**
 * The quick support / feedback composer, opened from the avatar menu's Support
 * item. It captures the page it was opened on, which is what a bug report
 * needs; the full conversation list is the sidebar's Support page.
 */
export default function SupportDialog({ onClose }: { onClose: () => void }) {
    const { t } = useI18n();
    const m = t.components.feedbackWidget;
    const { support, feedback } = usePlatformFeatures();
    const router = useRouter();

    if (!support && !feedback) return null;

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={m.title} onClose={onClose} />
            <div className="p-4">
                <SupportComposer
                    supportEnabled={support}
                    feedbackEnabled={feedback}
                    capturePage
                    onCancel={onClose}
                    onCreated={(created) => {
                        onClose();
                        router.push(`${routes.support}?thread=${created.id}`);
                    }}
                />
            </div>
        </ModalShell>
    );
}
