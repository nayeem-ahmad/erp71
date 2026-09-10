import React from 'react';
import { render, screen } from '@testing-library/react';
import StorefrontHeader, { type StorefrontMenuLink } from './StorefrontHeader';

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({ push: jest.fn() })),
    usePathname: jest.fn(() => '/store/demo-shop'),
    useSearchParams: jest.fn(() => ({ get: jest.fn().mockReturnValue(null) })),
    useParams: jest.fn(() => ({ slug: 'demo-shop' })),
}));

const BASE_PROPS = {
    slug: 'demo-shop',
    storeName: 'Demo Shop',
    activeNav: 'home' as const,
    session: null,
    accountMenuOpen: false,
    onAccountMenuToggle: jest.fn(),
    onSignOut: jest.fn(),
    cartCount: 0,
    onCartOpen: jest.fn(),
};

const PAGE_LINK: StorefrontMenuLink = {
    id: 'link-1',
    label: 'About us',
    href: '/store/demo-shop/pages/about',
    external: false,
    open_in_new_tab: false,
};

const EXTERNAL_LINK: StorefrontMenuLink = {
    id: 'link-2',
    label: 'Our Facebook',
    href: 'https://facebook.com/demo',
    external: true,
    open_in_new_tab: true,
};

describe('StorefrontHeader', () => {
    it('keeps Home and Shop whatever the shop adds', () => {
        render(<StorefrontHeader {...BASE_PROPS} menuLinks={[PAGE_LINK]} />);

        // Twice each: the desktop nav and the (hidden) mobile drawer.
        expect(screen.getAllByRole('link', { name: 'Home' }).length).toBeGreaterThan(0);
        expect(screen.getAllByRole('link', { name: 'Shop' }).length).toBeGreaterThan(0);
    });

    it('renders a shop-authored page link', () => {
        render(<StorefrontHeader {...BASE_PROPS} menuLinks={[PAGE_LINK]} />);

        const [link] = screen.getAllByRole('link', { name: 'About us' });
        expect(link).toHaveAttribute('href', '/store/demo-shop/pages/about');
        expect(link).not.toHaveAttribute('target');
    });

    it('opens an external link safely', () => {
        render(<StorefrontHeader {...BASE_PROPS} menuLinks={[EXTERNAL_LINK]} />);

        const [link] = screen.getAllByRole('link', { name: 'Our Facebook' });
        expect(link).toHaveAttribute('href', 'https://facebook.com/demo');
        expect(link).toHaveAttribute('target', '_blank');
        // `noopener` is what stops the opened page reaching back through
        // `window.opener` — it is not decoration.
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('marks the same-tab external link noopener too', () => {
        // A shopper middle-clicking a same-tab link opens it in a tab all the
        // same, so the guard cannot be conditional on `target`.
        render(
            <StorefrontHeader
                {...BASE_PROPS}
                menuLinks={[{ ...EXTERNAL_LINK, open_in_new_tab: false }]}
            />,
        );

        const [link] = screen.getAllByRole('link', { name: 'Our Facebook' });
        expect(link).not.toHaveAttribute('target');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders nothing extra when the shop has added no links', () => {
        render(<StorefrontHeader {...BASE_PROPS} />);

        expect(screen.queryByRole('link', { name: 'About us' })).not.toBeInTheDocument();
    });
});
