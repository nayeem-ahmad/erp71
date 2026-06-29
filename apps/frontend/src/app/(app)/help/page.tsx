'use client';

import { useMemo, useState } from 'react';
import { HelpCircle, ChevronDown, ChevronRight, ExternalLink, BookOpen, MessageCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function HelpPage() {
    const { t } = useI18n();
    const h = t.help;
    const sections = useMemo(
        () => [
            h.sections.gettingStarted,
            h.sections.pos,
            h.sections.inventory,
            h.sections.accounting,
            h.sections.billing,
            h.sections.storefront,
            h.sections.security,
        ],
        [h],
    );

    const [openSections, setOpenSections] = useState<Set<string>>(new Set([h.sections.gettingStarted.title]));
    const [openFaqs, setOpenFaqs] = useState<Set<string>>(new Set());

    function toggleSection(title: string) {
        setOpenSections((prev) => {
            const next = new Set(prev);
            if (next.has(title)) next.delete(title);
            else next.add(title);
            return next;
        });
    }

    function toggleFaq(key: string) {
        setOpenFaqs((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    return (
        <div className="p-6 max-w-3xl space-y-6">
            <div className="flex items-center gap-3">
                <HelpCircle className="h-7 w-7 text-blue-600" />
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{h.title}</h1>
                    <p className="text-gray-500 text-sm">{h.description}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <a
                    href="mailto:support@erp71.com"
                    className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
                >
                    <MessageCircle className="h-5 w-5 text-blue-600 flex-shrink-0" />
                    <div>
                        <div className="font-medium text-sm text-blue-900">{h.quickLinks.emailSupport.title}</div>
                        <div className="text-xs text-blue-600">{h.quickLinks.emailSupport.subtitle}</div>
                    </div>
                </a>
                <a
                    href="/contact"
                    className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition-colors"
                >
                    <BookOpen className="h-5 w-5 text-green-600 flex-shrink-0" />
                    <div>
                        <div className="font-medium text-sm text-green-900">{h.quickLinks.contact.title}</div>
                        <div className="text-xs text-green-600">{h.quickLinks.contact.subtitle}</div>
                    </div>
                </a>
                <a
                    href="/status"
                    target="_blank"
                    className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors"
                >
                    <ExternalLink className="h-5 w-5 text-gray-600 flex-shrink-0" />
                    <div>
                        <div className="font-medium text-sm text-gray-900">{h.quickLinks.status.title}</div>
                        <div className="text-xs text-gray-500">{h.quickLinks.status.subtitle}</div>
                    </div>
                </a>
            </div>

            <div className="space-y-3">
                {sections.map((section) => {
                    const isOpen = openSections.has(section.title);
                    return (
                        <div key={section.title} className="border border-gray-200 rounded-xl overflow-hidden">
                            <button
                                onClick={() => toggleSection(section.title)}
                                className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="text-lg">{section.icon}</span>
                                    <span className="font-semibold text-gray-800">{section.title}</span>
                                    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                                        {section.faqs.length}
                                    </span>
                                </div>
                                {isOpen ? (
                                    <ChevronDown className="h-4 w-4 text-gray-500" />
                                ) : (
                                    <ChevronRight className="h-4 w-4 text-gray-500" />
                                )}
                            </button>

                            {isOpen && (
                                <div className="divide-y divide-gray-100">
                                    {section.faqs.map((faq, idx) => {
                                        const key = `${section.title}-${idx}`;
                                        const faqOpen = openFaqs.has(key);
                                        return (
                                            <div key={key} className="bg-white">
                                                <button
                                                    onClick={() => toggleFaq(key)}
                                                    className="w-full flex items-start justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                                                >
                                                    <span className="font-medium text-gray-800 text-sm pr-4">{faq.q}</span>
                                                    {faqOpen ? (
                                                        <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                                                    ) : (
                                                        <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                                                    )}
                                                </button>
                                                {faqOpen && (
                                                    <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">
                                                        {faq.a}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="text-center text-sm text-gray-400 py-4">
                {h.footerPrefix}{' '}
                <a href="mailto:support@erp71.com" className="text-blue-600 hover:underline">
                    {h.footerLink}
                </a>
            </div>
        </div>
    );
}