'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import StorefrontHeader, { type StorefrontMenuLink } from '@/components/storefront/StorefrontHeader';
import { storefrontTheme, storefrontThemeStyle } from '@/lib/storefront/storefront-theme';
import { useI18n, formatMessage } from '@/lib/i18n';
import { browserApiBase } from '@/lib/api-base';

const API_BASE = browserApiBase();

type CustomerSession = {
    access_token: string;
    customer: { name: string; email: string };
};

export type StorefrontDocumentShop = {
    name: string;
    slug: string;
    storefront_banner: string | null;
    storefront_logo: string | null;
    storefront_logo_show_name: boolean;
    brand_primary_color: string | null;
};

type StorefrontDocumentShellProps = {
    slug: string;
    shop: StorefrontDocumentShop;
    menuLinks?: StorefrontMenuLink[];
    activeHref?: string;
    children: React.ReactNode;
};

function sessionKey(slug: string) {
    return `storefront_customer_${slug}`;
}

/**
 * Homepage chrome around a server-rendered document — a shop's About page,
 * a blog post. Banner, logo, menu, sign-in and footer match `/store/:slug`;
 * the article stays in the initial HTML so a crawler still sees it.
 *
 * The cart icon goes to the shop rather than opening an empty drawer: these
 * pages cannot add a line, and the home/shop cart lives in that tree's state.
 */
export default function StorefrontDocumentShell({
    slug,
    shop,
    menuLinks = [],
    activeHref,
    children,
}: StorefrontDocumentShellProps) {
    const { t } = useI18n();
    const m = t.storefront.public;
    const footer = m.footer;
    const router = useRouter();

    const [session, setSession] = useState<CustomerSession | null>(null);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(sessionKey(slug));
            if (raw) setSession(JSON.parse(raw) as CustomerSession);
        } catch {
            // A corrupt key is the same as signed out.
        }
    }, [slug]);

    const handleSignOut = () => {
        const token = session?.access_token;
        if (token) {
            fetch(`${API_BASE}/storefront/${slug}/auth/logout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
        }
        localStorage.removeItem(sessionKey(slug));
        setSession(null);
        setAccountMenuOpen(false);
    };

    const footerLinks = menuLinks.filter(
        (link) => link.href !== `/store/${slug}` && link.href !== `/store/${slug}/shop`,
    );

    return (
        <div
            className="min-h-screen bg-white text-gray-900 selection:bg-black selection:text-white"
            style={storefrontThemeStyle(storefrontTheme(shop.brand_primary_color))}
        >
            {shop.storefront_banner ? (
                <div className="bg-black text-white text-center py-2 px-4 text-sm tracking-wide">
                    {shop.storefront_banner}
                </div>
            ) : null}

            <StorefrontHeader
                slug={slug}
                storeName={shop.name}
                logoUrl={shop.storefront_logo}
                showStoreName={shop.storefront_logo_show_name}
                activeNav="page"
                menuLinks={menuLinks}
                activeHref={activeHref}
                session={session}
                accountMenuOpen={accountMenuOpen}
                onAccountMenuToggle={() => setAccountMenuOpen((value) => !value)}
                onSignOut={handleSignOut}
                cartCount={0}
                onCartOpen={() => router.push(`/store/${slug}/shop`)}
            />

            <main className="py-14 sm:py-16">{children}</main>

            <footer className="bg-gray-900 text-white pt-20 pb-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
                        <div className="col-span-1 md:col-span-2">
                            <Link href={`/store/${slug}`} className="text-2xl font-bold tracking-tight mb-6 block">
                                {shop.name}
                            </Link>
                            <p className="text-gray-400 max-w-md leading-relaxed">{footer.tagline}</p>
                        </div>

                        <div>
                            <h4 className="font-bold text-lg mb-6">{footer.shop}</h4>
                            <ul className="space-y-4 text-gray-400">
                                <li>
                                    <Link href={`/store/${slug}/shop`} className="hover:text-white transition-colors">
                                        {m.allProducts}
                                    </Link>
                                </li>
                            </ul>
                        </div>

                        <div>
                            <h4 className="font-bold text-lg mb-6">{footer.information}</h4>
                            <ul className="space-y-4 text-gray-400">
                                {footerLinks.map((link) => (
                                    <li key={link.id}>
                                        {link.external ? (
                                            <a
                                                href={link.href}
                                                target={link.open_in_new_tab ? '_blank' : undefined}
                                                rel="noopener noreferrer"
                                                className="hover:text-white transition-colors"
                                            >
                                                {link.label}
                                            </a>
                                        ) : (
                                            <Link href={link.href} className="hover:text-white transition-colors">
                                                {link.label}
                                            </Link>
                                        )}
                                    </li>
                                ))}
                                <li>
                                    <Link href={`/store/${slug}#contact`} className="hover:text-white transition-colors">
                                        {footer.contactUs}
                                    </Link>
                                </li>
                            </ul>
                        </div>
                    </div>

                    <div className="pt-8 border-t border-gray-800 text-center md:text-start flex flex-col md:flex-row justify-between items-center text-gray-400 text-sm">
                        <p>
                            {formatMessage(footer.allRightsReserved, {
                                year: new Date().getFullYear(),
                                name: shop.name,
                            })}
                        </p>
                        <p className="mt-4 md:mt-0">{formatMessage(footer.poweredBy, { brand: 'ERP71' })}</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
