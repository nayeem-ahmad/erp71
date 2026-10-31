'use client';

import { MARKETING_WHATSAPP_LINKS } from '@/lib/marketing/whatsapp';
import { useI18n } from '@/lib/i18n';

/** One line under the plan cards, with the WhatsApp phrase as the link. */
export default function PricingPlanHelp() {
    const { t } = useI18n();
    const m = t.marketing.pricing;

    return (
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-gray-600">
            {m.planHelpBefore}
            <a
                href={MARKETING_WHATSAPP_LINKS.pricing}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-blue-600 underline decoration-blue-600/40 underline-offset-2 hover:text-blue-700"
            >
                {m.planHelpLink}
            </a>
            {m.planHelpAfter}
        </p>
    );
}
