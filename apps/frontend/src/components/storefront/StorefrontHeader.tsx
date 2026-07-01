'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, ShoppingCart, User, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type CustomerSession = {
    customer: { name: string; email: string };
};

type StorefrontHeaderProps = {
    slug: string;
    storeName: string;
    activeNav: 'home' | 'shop';
    session: CustomerSession | null;
    accountMenuOpen: boolean;
    onAccountMenuToggle: () => void;
    onSignOut: () => void;
    cartCount: number;
    onCartOpen: () => void;
};

export default function StorefrontHeader({
    slug,
    storeName,
    activeNav,
    session,
    accountMenuOpen,
    onAccountMenuToggle,
    onSignOut,
    cartCount,
    onCartOpen,
}: StorefrontHeaderProps) {
    const { t } = useI18n();
    const m = t.storefront.public;
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const navLinkCls =
        'block py-3 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors border-b border-gray-100 last:border-0';

    const closeMobileMenu = () => setMobileMenuOpen(false);

    return (
        <header className="border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-md z-40">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-20 gap-4">
                    <Link
                        href={`/store/${slug}`}
                        className="text-xl sm:text-2xl font-black tracking-tighter truncate min-w-0"
                    >
                        {storeName}
                    </Link>

                    <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
                        <Link
                            href={`/store/${slug}`}
                            className={activeNav === 'home' ? 'text-gray-900' : 'text-gray-500 hover:text-gray-900 transition-colors'}
                        >
                            {m.nav.home}
                        </Link>
                        <Link
                            href={`/store/${slug}/shop`}
                            className={activeNav === 'shop' ? 'text-gray-900' : 'text-gray-500 hover:text-gray-900 transition-colors'}
                        >
                            {m.nav.shop}
                        </Link>
                        <a href="#contact" className="text-gray-500 hover:text-gray-900 transition-colors">
                            {m.nav.contact}
                        </a>
                    </nav>

                    <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                        {session ? (
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={onAccountMenuToggle}
                                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
                                >
                                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-900 text-white text-xs font-bold">
                                        {session.customer.name.charAt(0).toUpperCase()}
                                    </span>
                                    <span className="hidden sm:block">{session.customer.name.split(' ')[0]}</span>
                                </button>
                                {accountMenuOpen ? (
                                    <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                                        <p className="px-4 py-2 text-xs text-gray-400 truncate">{session.customer.email}</p>
                                        <hr className="border-gray-100" />
                                        <button
                                            type="button"
                                            onClick={onSignOut}
                                            className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                                        >
                                            {m.signOut}
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <Link
                                href={`/store/${slug}/auth/signin`}
                                className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
                            >
                                <User className="w-4 h-4" />
                                <span className="hidden sm:block">{m.signIn}</span>
                            </Link>
                        )}

                        <button
                            type="button"
                            onClick={onCartOpen}
                            className="relative inline-flex items-center justify-center min-h-11 min-w-11 text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
                            aria-label={m.addToCart}
                        >
                            <ShoppingCart className="w-6 h-6" />
                            {cartCount > 0 ? (
                                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-5 h-5 px-1 text-[10px] font-bold text-white bg-blue-600 rounded-full">
                                    {cartCount}
                                </span>
                            ) : null}
                        </button>

                        <button
                            type="button"
                            className="md:hidden min-h-11 min-w-11 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors"
                            onClick={() => setMobileMenuOpen((value) => !value)}
                            aria-label="Toggle menu"
                            aria-expanded={mobileMenuOpen}
                        >
                            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
            </div>

            {mobileMenuOpen ? (
                <div className="md:hidden bg-white border-t border-gray-100 px-4 sm:px-6 py-2">
                    <Link
                        href={`/store/${slug}`}
                        className={`${navLinkCls} ${activeNav === 'home' ? 'text-gray-900 font-semibold' : ''}`}
                        onClick={closeMobileMenu}
                    >
                        {m.nav.home}
                    </Link>
                    <Link
                        href={`/store/${slug}/shop`}
                        className={`${navLinkCls} ${activeNav === 'shop' ? 'text-gray-900 font-semibold' : ''}`}
                        onClick={closeMobileMenu}
                    >
                        {m.nav.shop}
                    </Link>
                    <a href="#contact" className={navLinkCls} onClick={closeMobileMenu}>
                        {m.nav.contact}
                    </a>
                </div>
            ) : null}
        </header>
    );
}