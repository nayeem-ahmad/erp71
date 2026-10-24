import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StorefrontAccount from './StorefrontAccount';

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

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const SHOP = {
    name: 'Dhaka Mart',
    slug: 'dhaka-mart',
    storefront_hero_image: null,
    storefront_hero_headline: null,
    storefront_logo: null,
    storefront_logo_show_name: true,
    brand_primary_color: null,
};

const PROFILE = {
    id: 'cust-1',
    name: 'Karim Uddin',
    email: 'karim@example.com',
    phone: '01700000001',
    address: null,
    loyalty_points: 120,
    total_spent: '4500.00',
    last_delivery: null,
};

const ORDER = {
    id: 'clorder0000000000abcd1234',
    status: 'SHIPPED',
    totalAmount: '1250.00',
    notes: 'Call before coming',
    deliveryAddress: 'House 5, Road 2',
    deliveryArea: 'Dhanmondi',
    created_at: '2026-10-20T10:00:00.000Z',
    items: [
        { id: 'i1', quantity: 2, priceAtOrder: '500.00', product: { id: 'p1', name: 'Rice 5kg', image_url: null } },
        { id: 'i2', quantity: 1, priceAtOrder: '250.00', product: { id: 'p2', name: 'Lentils', image_url: null } },
    ],
};

function json(body: unknown, status = 200) {
    return Promise.resolve({ ok: status < 400, status, json: async () => ({ data: body }) } as Response);
}

function signIn() {
    localStorage.setItem(
        'storefront_customer_dhaka-mart',
        JSON.stringify({ access_token: 'shopper-token', customer: { id: 'cust-1', name: 'Karim Uddin', email: 'karim@example.com', phone: '01700000001' } }),
    );
}

describe('StorefrontAccount', () => {
    beforeEach(() => {
        localStorage.clear();
        mockFetch.mockReset();
        push.mockReset();
    });

    it('asks a guest to sign in and fetches nothing personal', () => {
        render(<StorefrontAccount slug="dhaka-mart" shop={SHOP} />);

        expect(screen.getByText('Sign in to see your orders and details.')).toBeInTheDocument();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('shows the shopper\'s orders with their reference, status and delivery address', async () => {
        signIn();
        mockFetch.mockImplementation((url: string) =>
            url.includes('/customer/orders')
                ? json({ items: [ORDER], total: 1, page: 1, limit: 10, pages: 1 })
                : json(PROFILE),
        );

        render(<StorefrontAccount slug="dhaka-mart" shop={SHOP} />);

        expect(await screen.findByText('Order #ABCD1234')).toBeInTheDocument();
        expect(screen.getByText('Shipped')).toBeInTheDocument();
        expect(screen.getByText('120')).toBeInTheDocument();
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/storefront/dhaka-mart/customer/orders?page=1&limit=10'),
            expect.objectContaining({ headers: { Authorization: 'Bearer shopper-token' } }),
        );

        // Lines and address stay folded until asked for.
        expect(screen.queryByText(/House 5, Road 2/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
        expect(screen.getByText('House 5, Road 2, Dhanmondi')).toBeInTheDocument();
        expect(screen.getByText('2 × Rice 5kg')).toBeInTheDocument();
    });

    it('saves edited details and keeps the stored session in step', async () => {
        signIn();
        mockFetch.mockImplementation((url: string, init?: RequestInit) => {
            if (url.includes('/customer/orders')) return json({ items: [], total: 0, page: 1, limit: 10, pages: 1 });
            if (init?.method === 'PATCH') {
                return json({ ...PROFILE, ...JSON.parse(String(init.body)) });
            }
            return json(PROFILE);
        });

        render(<StorefrontAccount slug="dhaka-mart" shop={SHOP} />);

        const nameInput = await screen.findByDisplayValue('Karim Uddin');
        fireEvent.change(nameInput, { target: { value: 'Karim Ahmed' } });
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'House 1, Gulshan' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(await screen.findByText('Your details have been saved.')).toBeInTheDocument();
        const patch = mockFetch.mock.calls.find(([, init]) => init?.method === 'PATCH');
        expect(JSON.parse(patch[1].body)).toEqual({ name: 'Karim Ahmed', phone: '01700000001', address: 'House 1, Gulshan' });
        expect(JSON.parse(localStorage.getItem('storefront_customer_dhaka-mart')!).customer.name).toBe('Karim Ahmed');
    });

    it('drops an expired session and returns to the sign-in prompt', async () => {
        signIn();
        mockFetch.mockImplementation(() => json({ message: 'Unauthorized' }, 401));

        render(<StorefrontAccount slug="dhaka-mart" shop={SHOP} />);

        await waitFor(() => expect(screen.getByText('Sign in to see your orders and details.')).toBeInTheDocument());
        expect(localStorage.getItem('storefront_customer_dhaka-mart')).toBeNull();
    });
});
