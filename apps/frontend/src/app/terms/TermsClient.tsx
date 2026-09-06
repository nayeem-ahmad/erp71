'use client';

import { useSearchParams } from 'next/navigation';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import LegalSections from '@/components/legal/LegalSections';
import { TERMS_SECTIONS } from '@/lib/legal/terms-content';
import { useI18n } from '@/lib/i18n';
import { PLAN_TERMS_ADDENDA, resolvePlanTermsSlug } from '@/lib/marketing/plan-terms';
import { CURRENT_TERMS_VERSION } from '@erp71/shared-types';

export default function TermsClient() {
    const { t } = useI18n();
    const searchParams = useSearchParams();
    const m = t.marketing.legal;
    const p = m.terms;
    // Signup links here as `/terms?plan=<tier>` so the addendum someone is about
    // to accept is the one highlighted. Every addendum still renders either way:
    // this document is the whole agreement, and hiding the tiers a reader did
    // not arrive on would misrepresent what they are agreeing to.
    const highlightedSlug = resolvePlanTermsSlug(searchParams.get('plan'));

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">

            <MarketingNav />

            {/* Content */}
            <main className="pt-32 pb-24 px-6">
                <div className="max-w-3xl mx-auto">

                    <h1 className="text-4xl font-black tracking-tight text-gray-900 mb-2">{p.title}</h1>
                    <p className="text-sm text-gray-400 mb-12">
                        {m.lastUpdated}
                        {/* The version a signup records against. Printed so a stored
                            acceptance can be matched to the document it names. */}
                        <span className="ms-2 text-gray-300">·</span>
                        <span className="ms-2 font-mono text-xs">v{CURRENT_TERMS_VERSION}</span>
                    </p>

                    <LegalSections
                        sections={TERMS_SECTIONS}
                        addenda={PLAN_TERMS_ADDENDA}
                        highlightedSlug={highlightedSlug}
                        highlightLabel="The plan you are signing up for"
                    />

                </div>
            </main>

            <MarketingFooter />
        </div>
    );
}
