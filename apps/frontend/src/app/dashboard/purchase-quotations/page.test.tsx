'use client';

import { render, screen, waitFor } from '@testing-library/react';
import PurchaseQuotationsPage from './page';

jest.mock('../../../lib/api', () => ({
    api: {
        getPurchaseQuotations: jest.fn(),
        deletePurchaseQuotation: jest.fn(),
        convertPurchaseQuotation: jest.fn(),
        getSuppliers: jest.fn(),
        getProducts: jest.fn(),
        getStores: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/purchase-quotations',
    useSearchParams: () => ({ get: jest.fn() }),
}));

jest.mock('./CreatePurchaseQuotationModal', () => {
    return function MockCreatePurchaseQuotationModal() {
        return null;
    };
});

describe('PurchaseQuotationsPage', () => {
    beforeEach(() => {
        const { api } = require('../../../lib/api');
        api.getPurchaseQuotations.mockResolvedValue([]);
        api.getSuppliers.mockResolvedValue([]);
        api.getProducts.mockResolvedValue([]);
        api.getStores.mockResolvedValue([]);
        jest.clearAllMocks();
    });

    it('renders the page heading', async () => {
        const { api } = require('../../../lib/api');
        api.getPurchaseQuotations.mockResolvedValue([]);
        render(<PurchaseQuotationsPage />);
        await waitFor(() => {
            expect(screen.getByText('Purchase Quotations (RFQ)')).toBeInTheDocument();
        });
    });

    it('displays loaded purchase quotation data', async () => {
        const { api } = require('../../../lib/api');
        api.getPurchaseQuotations.mockResolvedValue([
            {
                id: '1',
                rfq_number: 'RFQ-0001',
                status: 'DRAFT',
                valid_until: null,
                total_amount: '5000',
                created_at: '2025-01-01T00:00:00Z',
                notes: null,
                supplier: { id: 's1', name: 'Test Supplier' },
                store: { name: 'Main Store' },
                items: [{ id: 'i1' }, { id: 'i2' }],
            },
        ]);
        render(<PurchaseQuotationsPage />);
        await waitFor(() => {
            expect(screen.getByText('RFQ-0001')).toBeInTheDocument();
        });
    });

    it('handles empty state', async () => {
        const { api } = require('../../../lib/api');
        api.getPurchaseQuotations.mockResolvedValue([]);
        render(<PurchaseQuotationsPage />);
        await waitFor(() => {
            expect(screen.getByText('No purchase quotations found')).toBeInTheDocument();
        });
    });

    it('renders the New RFQ button', async () => {
        const { api } = require('../../../lib/api');
        api.getPurchaseQuotations.mockResolvedValue([]);
        render(<PurchaseQuotationsPage />);
        await waitFor(() => {
            expect(screen.getByText('New RFQ')).toBeInTheDocument();
        });
    });
});
