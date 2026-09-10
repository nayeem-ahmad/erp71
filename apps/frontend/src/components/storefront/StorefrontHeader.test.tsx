import React from 'react';
import { render, screen } from '@testing-library/react';
import StorefrontHeader from './StorefrontHeader';

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
