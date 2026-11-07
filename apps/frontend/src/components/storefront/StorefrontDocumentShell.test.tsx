import { fireEvent, render, screen } from '@testing-library/react';
import StorefrontDocumentShell from './StorefrontDocumentShell';
import type { StorefrontMenuLink } from './StorefrontHeader';

const push = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href, ...rest }: any) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const SHOP = {
    name: 'KH Trading',
    slug: 'kh',
    storefront_banner: 'Visit CareForce Medical at Babu Bazar.',
    storefront_logo: 'https://cdn.example/logo.png',
    storefront_logo_show_name: false,
    brand_primary_color: '#f6691e',
};

const MENU: StorefrontMenuLink[] = [
    {
        id: 'about',
        label: 'About',
        href: '/store/kh/pages/about',
        external: false,
        open_in_new_tab: false,
    },
    {
        id: 'returns',
        label: 'Returns',
        href: '/store/kh/pages/returns',
        external: false,
        open_in_new_tab: false,
    },
];

function renderShell(
    props: Partial<React.ComponentProps<typeof StorefrontDocumentShell>> = {},
) {
    return render(
        <StorefrontDocumentShell slug="kh" shop={SHOP} menuLinks={MENU} activeHref="/store/kh/pages/about" {...props}>
            <h1>About us</h1>
        </StorefrontDocumentShell>,
    );
}

describe('StorefrontDocumentShell', () => {
    beforeEach(() => {
        localStorage.clear();
        push.mockReset();
    });

    it('paints the homepage banner, logo, and brand colour', () => {
        const { container } = renderShell();

        expect(screen.getByText('Visit CareForce Medical at Babu Bazar.')).toBeInTheDocument();
        expect(container.querySelector('header img')).toHaveAttribute('src', 'https://cdn.example/logo.png');
        expect(screen.queryByText('KH Trading', { selector: 'header *' })).not.toBeInTheDocument();
        expect(container.firstChild).toHaveStyle({ '--sf-accent': '#f6691e' });
    });

    it('uses the homepage header: Home, Shop, Contact, and the shop menu', () => {
        renderShell();

        expect(screen.getAllByRole('link', { name: 'Home' })[0]).toHaveAttribute('href', '/store/kh');
        expect(screen.getAllByRole('link', { name: 'Shop' })[0]).toHaveAttribute('href', '/store/kh/shop');
        expect(screen.getAllByRole('link', { name: 'Contact' })[0]).toHaveAttribute('href', '/store/kh#contact');
        expect(screen.getAllByRole('link', { name: 'About' })[0]).toHaveAttribute('href', '/store/kh/pages/about');
        expect(screen.getByRole('heading', { name: 'About us' })).toBeInTheDocument();
    });

    it('keeps the header at homepage width', () => {
        const { container } = renderShell();
        const inner = container.querySelector('header > div');
        expect(inner?.className).toMatch(/max-w-7xl/);
    });

    it('sends the cart icon to the shop, the way the account page does', () => {
        renderShell();

        fireEvent.click(screen.getByLabelText('Add to Cart'));
        expect(push).toHaveBeenCalledWith('/store/kh/shop');
    });

    it('points footer Contact at the homepage form, not a fragment on this page', () => {
        renderShell();

        const contact = screen.getByRole('link', { name: 'Contact Us' });
        expect(contact).toHaveAttribute('href', '/store/kh#contact');
        expect(screen.getByRole('contentinfo').textContent).toMatch(/KH Trading/);
        expect(screen.getAllByRole('link', { name: 'Returns' })[0]).toHaveAttribute(
            'href',
            '/store/kh/pages/returns',
        );
    });
});
