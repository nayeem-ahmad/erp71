'use client';

import { render, screen, waitFor } from '@testing-library/react';
import WarrantyClaimsPage from './page';

jest.mock('../../../lib/api', () => ({
    api: {
        getWarrantyClaims: jest.fn(),
        lookupWarrantySerial: jest.fn(),
        createWarrantyClaim: jest.fn(),
        updateWarrantyClaimStatus: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/dashboard/warranty-claims',
    useSearchParams: () => ({ get: jest.fn() }),
}));

describe('WarrantyClaimsPage', () => {
    beforeEach(() => {
        const { api } = require('../../../lib/api');
        api.getWarrantyClaims.mockResolvedValue([]);
        jest.clearAllMocks();
    });

    it('renders the page heading', async () => {
        const { api } = require('../../../lib/api');
        api.getWarrantyClaims.mockResolvedValue([]);
        render(<WarrantyClaimsPage />);
        await waitFor(() => {
            expect(screen.getByText('Warranty Claims')).toBeInTheDocument();
        });
    });

    it('displays loaded warranty claims', async () => {
        const { api } = require('../../../lib/api');
        api.getWarrantyClaims.mockResolvedValue([
            {
                id: '1',
                claim_number: 'WC-0001',
                serial_number: 'SN123456',
                status: 'SUBMITTED',
                reason: 'Device not working',
                description: null,
                resolution_notes: null,
                replacement_serial_number: null,
                created_at: '2025-01-01T00:00:00Z',
                product: { name: 'Samsung TV 32"' },
                customer: { name: 'Rahim Mia' },
            },
        ]);
        render(<WarrantyClaimsPage />);
        await waitFor(() => {
            expect(screen.getByText('WC-0001')).toBeInTheDocument();
        });
    });

    it('handles empty claims list', async () => {
        const { api } = require('../../../lib/api');
        api.getWarrantyClaims.mockResolvedValue([]);
        render(<WarrantyClaimsPage />);
        await waitFor(() => {
            expect(screen.getByText('Warranty Claims')).toBeInTheDocument();
        });
    });

    it('renders the New Claim button', async () => {
        const { api } = require('../../../lib/api');
        api.getWarrantyClaims.mockResolvedValue([]);
        render(<WarrantyClaimsPage />);
        await waitFor(() => {
            expect(screen.getByText('New Claim')).toBeInTheDocument();
        });
    });
});
