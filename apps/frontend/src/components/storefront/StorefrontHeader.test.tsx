import React from 'react';
import { render, screen } from '@testing-library/react';
import StorefrontHeader, { type StorefrontMenuLink } from './StorefrontHeader';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

function renderHeader(props: Partial<React.ComponentProps<typeof StorefrontHeader>> = {}) {
    return render(
        <StorefrontHeader
            slug="my-store"
            storeName="Rahim Traders"
            activeNav="home"
            session={null}
            accountMenuOpen={false}
            onAccountMenuToggle={jest.fn()}
            onSignOut={jest.fn()}
            cartCount={0}
            onCartOpen={jest.fn()}
            {...props}
        />,
    );
}

describe('StorefrontHeader branding', () => {
    it('shows the store name when there is no logo', () => {
        renderHeader();

        expect(screen.getByText('Rahim Traders')).toBeInTheDocument();
        expect(document.querySelector('header img')).toBeNull();
    });

    it('shows the logo beside the name when both are wanted', () => {
        renderHeader({ logoUrl: 'https://cdn.example/logo.png', showStoreName: true });

        expect(screen.getByText('Rahim Traders')).toBeInTheDocument();
        expect(document.querySelector('header img')).toHaveAttribute(
            'src',
            'https://cdn.example/logo.png',
        );
    });

    it('drops the name when the logo is meant to stand alone', () => {
        renderHeader({ logoUrl: 'https://cdn.example/logo.png', showStoreName: false });

        expect(screen.queryByText('Rahim Traders')).not.toBeInTheDocument();
        // The name still reaches a screen reader, through the logo's alt text.
        expect(screen.getByAltText('Rahim Traders')).toBeInTheDocument();
    });

    it('keeps the name when the preference says hide it but no logo was uploaded', () => {
        renderHeader({ logoUrl: null, showStoreName: false });

        expect(screen.getByText('Rahim Traders')).toBeInTheDocument();
    });
});

const PAGE_LINK: StorefrontMenuLink = {
    id: 'link-1',
    label: 'About us',
    href: '/store/my-store/pages/about',
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

describe('StorefrontHeader shop-authored menu links', () => {
    it('keeps Home and Shop whatever the shop adds', () => {
        renderHeader({ menuLinks: [PAGE_LINK] });

        // At least once each: the desktop nav, plus the mobile drawer when open.
        expect(screen.getAllByRole('link', { name: 'Home' }).length).toBeGreaterThan(0);
        expect(screen.getAllByRole('link', { name: 'Shop' }).length).toBeGreaterThan(0);
    });

    it('renders a shop-authored page link', () => {
        renderHeader({ menuLinks: [PAGE_LINK] });

        const [link] = screen.getAllByRole('link', { name: 'About us' });
        expect(link).toHaveAttribute('href', '/store/my-store/pages/about');
        expect(link).not.toHaveAttribute('target');
    });

    it('opens an external link safely', () => {
        renderHeader({ menuLinks: [EXTERNAL_LINK] });

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
        renderHeader({ menuLinks: [{ ...EXTERNAL_LINK, open_in_new_tab: false }] });

        const [link] = screen.getAllByRole('link', { name: 'Our Facebook' });
        expect(link).not.toHaveAttribute('target');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders nothing extra when the shop has added no links', () => {
        renderHeader();

        expect(screen.queryByRole('link', { name: 'About us' })).not.toBeInTheDocument();
    });
});
