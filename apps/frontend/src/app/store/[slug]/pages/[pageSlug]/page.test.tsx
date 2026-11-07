import { render, screen } from '@testing-library/react';
import StorefrontContentPage from './page';
import { fetchStorefrontPage } from '@/lib/storefront/pages-api';
import { fetchStorefrontMeta } from '@/lib/storefront/storefront-meta';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href, ...rest }: any) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

jest.mock('@/lib/storefront/pages-api', () => {
    const actual = jest.requireActual('@/lib/storefront/pages-api');
    return { ...actual, fetchStorefrontPage: jest.fn() };
});

jest.mock('@/lib/storefront/storefront-meta', () => {
    const actual = jest.requireActual('@/lib/storefront/storefront-meta');
    return { ...actual, fetchStorefrontMeta: jest.fn() };
});

const fetchPage = fetchStorefrontPage as jest.MockedFunction<typeof fetchStorefrontPage>;
const fetchMeta = fetchStorefrontMeta as jest.MockedFunction<typeof fetchStorefrontMeta>;

const SHOP = {
    name: 'KH Trading',
    slug: 'kh',
    storefront_banner: 'Visit CareForce Medical at Babu Bazar.',
    storefront_logo: 'https://cdn.example/logo.png',
    storefront_logo_show_name: false,
    brand_primary_color: '#f6691e',
};

describe('StorefrontContentPage', () => {
    beforeEach(() => {
        fetchPage.mockReset();
        fetchMeta.mockReset();
        fetchMeta.mockResolvedValue(SHOP);
    });

    it('wraps a published page in the homepage chrome', async () => {
        fetchPage.mockResolvedValue({
            shop: SHOP,
            page: {
                slug: 'about',
                title: 'About us',
                body_md: 'We fit supports in Dhaka.',
                seo_title: null,
                seo_description: null,
                published_at: '2026-11-08',
                updated_at: '2026-11-08',
            },
            menu: [
                {
                    id: 'about',
                    label: 'About',
                    href: '/store/kh/pages/about',
                    external: false,
                    open_in_new_tab: false,
                },
            ],
        });

        const ui = await StorefrontContentPage({
            params: Promise.resolve({ slug: 'kh', pageSlug: 'about' }),
        });
        const { container } = render(ui);

        expect(container.querySelector('header img')).toHaveAttribute(
            'src',
            'https://cdn.example/logo.png',
        );
        expect(screen.getByText('Visit CareForce Medical at Babu Bazar.')).toBeInTheDocument();
        expect(screen.getAllByRole('link', { name: 'Home' })[0]).toHaveAttribute('href', '/store/kh');
        expect(screen.getByRole('heading', { name: 'About us' })).toBeInTheDocument();
        expect(screen.getByText('We fit supports in Dhaka.')).toBeInTheDocument();
    });

    it('fills logo and banner from /meta when the page shop is name-only', async () => {
        fetchPage.mockResolvedValue({
            shop: {
                name: 'KH Trading',
                slug: 'kh',
                storefront_banner: null,
                storefront_logo: null,
                storefront_logo_show_name: true,
                brand_primary_color: null,
            },
            page: {
                slug: 'about',
                title: 'About us',
                body_md: 'We fit supports in Dhaka.',
                seo_title: null,
                seo_description: null,
                published_at: '2026-11-08',
                updated_at: '2026-11-08',
            },
            menu: [],
        });

        const ui = await StorefrontContentPage({
            params: Promise.resolve({ slug: 'kh', pageSlug: 'about' }),
        });
        const { container } = render(ui);

        expect(container.querySelector('header img')).toHaveAttribute(
            'src',
            'https://cdn.example/logo.png',
        );
        expect(screen.getByText('Visit CareForce Medical at Babu Bazar.')).toBeInTheDocument();
    });
});
