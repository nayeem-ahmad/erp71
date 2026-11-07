import { render, screen } from '@testing-library/react';
import { mockBranchScope } from '@/test-utils/branch-scope';
import StorefrontOrdersPage from './page';

jest.mock('@/lib/branch-scope', () => require('@/test-utils/branch-scope').branchScopeModuleMock());

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/storefront',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
}));

jest.mock('./StorefrontOrdersPanel', () => ({
    __esModule: true,
    default: ({ storeId }: { storeId?: string }) => (
        <div data-testid="storefront-orders-panel">Online orders for {storeId ?? 'default'}</div>
    ),
}), { virtual: true });

describe('StorefrontOrdersPage', () => {
    beforeEach(() => {
        mockBranchScope({
            branches: [
                { id: 'store-1', name: 'Dhaka Branch' },
                { id: 'online-store', name: 'Online Store', is_online: true },
            ],
        });
    });

    it('hosts the online-orders queue instead of bouncing to Sales Orders', () => {
        const navigation = require('next/navigation');
        const replace = jest.fn();
        const spy = jest.spyOn(navigation, 'useRouter').mockReturnValue({
            push: jest.fn(),
            back: jest.fn(),
            replace,
        });

        render(<StorefrontOrdersPage />);

        expect(screen.getByRole('heading', { name: 'Online Orders' })).toBeInTheDocument();
        expect(screen.getByText('Online orders from your public store')).toBeInTheDocument();
        expect(screen.getByTestId('storefront-orders-panel')).toHaveTextContent('Online orders for online-store');
        expect(replace).not.toHaveBeenCalled();

        spy.mockRestore();
    });
});
