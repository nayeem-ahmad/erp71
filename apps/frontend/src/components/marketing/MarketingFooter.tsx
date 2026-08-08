'use client';

import Link from 'next/link';
import { useI18n, formatMessage } from '@/lib/i18n';

export default function MarketingFooter() {
    const { t } = useI18n();
    const m = t.components.marketingFooter;

    return (
        <footer className="py-10 px-6 border-t border-gray-100 bg-white">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
                <span className="font-black text-lg text-blue-600">{m.brand}</span>
                <div className="flex flex-wrap items-center justify-center gap-6">
                    <Link href="/terms" className="hover:text-gray-700 transition-colors">{m.terms}</Link>
                    <Link href="/privacy" className="hover:text-gray-700 transition-colors">{m.privacy}</Link>
                    <Link href="/refund" className="hover:text-gray-700 transition-colors">{m.refund}</Link>
                    <Link href="/sla" className="hover:text-gray-700 transition-colors">{m.sla}</Link>
                    <Link href="/blog" className="hover:text-gray-700 transition-colors">{m.blog}</Link>
                    <Link href="/contact" className="hover:text-gray-700 transition-colors">{m.contact}</Link>
                    <Link href="/login" className="hover:text-gray-700 transition-colors">{m.signIn}</Link>
                    <Link href="/signup" className="hover:text-gray-700 transition-colors">{m.signUp}</Link>
                </div>
                <span>{formatMessage(m.copyright, { year: new Date().getFullYear() })}</span>
            </div>
        </footer>
    );
}