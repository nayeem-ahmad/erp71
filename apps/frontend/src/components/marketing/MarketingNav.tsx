'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type MarketingNavProps = {
    active?: 'home' | 'pricing';
};

export default function MarketingNav({ active = 'home' }: MarketingNavProps) {
    const { t } = useI18n();
    const m = t.components.marketingNav;
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const navLinkCls = 'block py-3 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors border-b border-gray-100 last:border-0';

    return (
        <header className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
            <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                <Link href="/" className="text-xl font-black tracking-tight text-blue-600">
                    {m.brand}
                </Link>

                {/* Desktop nav */}
                <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
                    <Link href="/#features" className="hover:text-gray-900 transition-colors">{m.features}</Link>
                    <Link
                        href="/pricing"
                        className={active === 'pricing' ? 'text-blue-600 font-semibold' : 'hover:text-gray-900 transition-colors'}
                    >
                        {m.pricing}
                    </Link>
                    <Link href="/#testimonials" className="hover:text-gray-900 transition-colors">{m.reviews}</Link>
                    <Link href="/contact" className="hover:text-gray-900 transition-colors">{m.contact}</Link>
                </nav>

                <div className="flex items-center gap-2">
                    {/* Desktop auth buttons */}
                    <Link href="/login" className="hidden sm:block text-sm font-semibold text-gray-700 hover:text-gray-900 px-4 py-2">
                        {m.signIn}
                    </Link>
                    <Link
                        href="/signup"
                        className="hidden md:block bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-5 py-2 rounded-xl transition-colors"
                    >
                        {m.startFreeTrial}
                    </Link>

                    {/* Mobile hamburger */}
                    <button
                        className="md:hidden p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        aria-label="Toggle menu"
                    >
                        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile dropdown menu */}
            {mobileMenuOpen && (
                <div className="md:hidden bg-white border-t border-gray-100 px-6 py-2">
                    <Link href="/#features" className={navLinkCls} onClick={() => setMobileMenuOpen(false)}>{m.features}</Link>
                    <Link
                        href="/pricing"
                        className={`${navLinkCls} ${active === 'pricing' ? 'text-blue-600 font-semibold' : ''}`}
                        onClick={() => setMobileMenuOpen(false)}
                    >
                        {m.pricing}
                    </Link>
                    <Link href="/#testimonials" className={navLinkCls} onClick={() => setMobileMenuOpen(false)}>{m.reviews}</Link>
                    <Link href="/contact" className={navLinkCls} onClick={() => setMobileMenuOpen(false)}>{m.contact}</Link>
                    <div className="pt-3 pb-2 flex flex-col gap-2">
                        <Link
                            href="/login"
                            className="text-center text-sm font-semibold text-gray-700 hover:text-gray-900 py-2.5 border border-gray-200 rounded-xl transition-colors"
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            {m.signIn}
                        </Link>
                        <Link
                            href="/signup"
                            className="text-center bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2.5 rounded-xl transition-colors"
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            {m.startFreeTrial}
                        </Link>
                    </div>
                </div>
            )}
        </header>
    );
}
