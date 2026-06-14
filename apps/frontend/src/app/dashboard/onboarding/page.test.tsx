import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OnboardingPage from './page';

const pushMock = jest.fn();
const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

jest.mock('lucide-react', () => ({
    Package: () => <span />,
    ShoppingCart: () => <span />,
    CheckCircle2: () => <span />,
    ArrowRight: () => <span />,
    Plus: () => <span />,
    Zap: () => <span />,
    Store: () => <span />,
    Loader2: () => <span data-testid="loader" />,
    Stethoscope: () => <span />,
    ShoppingBag: () => <span />,
    Computer: () => <span />,
    Pill: () => <span />,
}));

jest.mock('../../../lib/api', () => ({
    api: {
        getMe: jest.fn(),
        setupTenant: jest.fn(),
        createProduct: jest.fn(),
        getSales: jest.fn(),
    },
}));

describe('OnboardingPage', () => {
    beforeEach(() => {
        localStorage.clear();
        pushMock.mockReset();
        replaceMock.mockReset();
        const { api } = require('../../../lib/api');
        api.getMe.mockResolvedValue({
            tenants: [{
                id: 'tenant-1',
                name: 'Dhaka Retail Co.',
                stores: [{ id: 'store-1', name: 'Gulshan Branch' }],
            }],
        });
        api.getSales.mockResolvedValue([]);
        api.createProduct.mockResolvedValue({ id: 'product-1' });
        api.setupTenant.mockResolvedValue({
            tenant: { id: 'tenant-2' },
            store: { id: 'store-2' },
        });
    });

    async function goToProductsStep() {
        fireEvent.click(await screen.findByRole('button', { name: /^continue$/i }));
        expect(await screen.findByText('Add your first product')).toBeInTheDocument();
    }

    async function goToPosStep() {
        await goToProductsStep();
        fireEvent.change(screen.getByPlaceholderText(/plain t-shirt/i), { target: { value: 'Test Shirt' } });
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '500' } });
        fireEvent.click(screen.getByRole('button', { name: /add product/i }));
        fireEvent.click(await screen.findByRole('button', { name: /^continue$/i }));
        await waitFor(() => {
            expect(
                screen.queryByText('Open the Point of Sale') || screen.queryByText('First sale recorded!'),
            ).toBeTruthy();
        });
    }

    it('shows store confirmation when tenant already exists', async () => {
        render(<OnboardingPage />);

        expect(await screen.findByText('Your store is ready')).toBeInTheDocument();
        expect(screen.getByText('Dhaka Retail Co.')).toBeInTheDocument();
        expect(screen.getAllByText('Gulshan Branch').length).toBeGreaterThan(0);
    });

    it('advances from store to product step', async () => {
        render(<OnboardingPage />);
        await goToProductsStep();
    });

    it('creates a product and advances to POS step', async () => {
        const { api } = require('../../../lib/api');
        render(<OnboardingPage />);
        await goToPosStep();

        await waitFor(() => {
            expect(api.createProduct).toHaveBeenCalledWith({
                name: 'Test Shirt',
                sku: undefined,
                price: 500,
            });
        });
    });

    it('shows sale detected when sales exist', async () => {
        const { api } = require('../../../lib/api');
        api.getSales.mockResolvedValue([{ id: 'sale-1' }]);

        render(<OnboardingPage />);
        await goToPosStep();

        expect(await screen.findByText('First sale recorded!')).toBeInTheDocument();
    });

    it('redirects to dashboard when onboarding already complete', async () => {
        localStorage.setItem('onboarding_complete', '1');
        render(<OnboardingPage />);

        await waitFor(() => {
            expect(replaceMock).toHaveBeenCalledWith('/dashboard');
        });
    });

    it('creates store when user has no tenant', async () => {
        const { api } = require('../../../lib/api');
        api.getMe.mockResolvedValue({ tenants: [] });

        render(<OnboardingPage />);

        expect(await screen.findByText('Create your store')).toBeInTheDocument();
        fireEvent.change(screen.getByPlaceholderText(/dhaka retail/i), { target: { value: 'New Biz' } });
        fireEvent.change(screen.getByPlaceholderText(/gulshan branch/i), { target: { value: 'Main Branch' } });
        fireEvent.click(screen.getByRole('button', { name: /create store/i }));

        await waitFor(() => {
            expect(api.setupTenant).toHaveBeenCalledWith({
                tenantName: 'New Biz',
                name: 'Main Branch',
                address: undefined,
                planCode: 'FREE',
            });
        });
    });
});