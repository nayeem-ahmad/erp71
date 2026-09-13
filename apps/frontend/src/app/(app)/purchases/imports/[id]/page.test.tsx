import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ImportShipmentDetailPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getImportShipment: jest.fn(),
        getAccounts: jest.fn().mockResolvedValue([]),
        updateImportShipmentStatus: jest.fn().mockResolvedValue({}),
        receiveImportShipment: jest.fn().mockResolvedValue({ purchase_number: 'PUR-IMP-2526-00001' }),
        acceptImportShipment: jest.fn().mockResolvedValue({}),
        cancelImportShipment: jest.fn().mockResolvedValue({ written_off_bdt: 0 }),
        deleteImportShipment: jest.fn().mockResolvedValue({}),
        deleteImportCost: jest.fn().mockResolvedValue({}),
        payImportCost: jest.fn().mockResolvedValue({}),
        addImportDocument: jest.fn().mockResolvedValue({}),
        deleteImportDocument: jest.fn().mockResolvedValue({}),
        settleImportShipment: jest.fn().mockResolvedValue({}),
    },
}));

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    );
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'ship-1' }),
    useRouter: () => ({ push, back: jest.fn() }),
    usePathname: () => '/purchases/imports/ship-1',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const shipment = (overrides: Record<string, unknown> = {}) => ({
    id: 'ship-1',
    reference_number: 'IMP-2526-00001',
    status: 'CUSTOMS',
    currency: 'USD',
    fx_rate_at_open: '120.000000',
    fx_rate_at_settle: null,
    invoice_value_fc: '4000.00',
    purchase_id: null,
    purchase_number: null,
    accepted_at: null,
    acceptance_due_date: null,
    tenor_days: null,
    lc_number: 'LC-991',
    supplier: { name: 'Shenzhen Trading Co' },
    items: [],
    costs: [],
    documents: [],
    cost_sheet: {
        goods_value_bdt: 480000,
        capitalized_charges_bdt: 0,
        non_capitalized_bdt: 0,
        total_landed_bdt: 480000,
        items: [],
    },
    ...overrides,
});

describe('ImportShipmentDetailPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { api } = require('@/lib/api');
        api.getImportShipment.mockResolvedValue(shipment());
    });

    it('hides the status menu when there is nowhere forward to go', async () => {
        // CUSTOMS is the last state before receipt, so every remaining status is
        // set by an action. The menu used to list every intermediate state
        // regardless of where the shipment was, so picking "LC applied" from
        // here produced a 400.
        render(<ImportShipmentDetailPage />);
        await screen.findAllByText('IMP-2526-00001');

        expect(screen.queryByLabelText('Advance status')).not.toBeInTheDocument();
    });

    it('offers the states ahead of a shipment still at LC_APPLIED', async () => {
        const { api } = require('@/lib/api');
        api.getImportShipment.mockResolvedValue(shipment({ status: 'LC_APPLIED' }));

        render(<ImportShipmentDetailPage />);
        await screen.findAllByText('IMP-2526-00001');

        const advance = screen.getByLabelText('Advance status') as HTMLSelectElement;
        expect(Array.from(advance.options).map((o) => o.value).filter(Boolean)).toEqual([
            'LC_ISSUED',
            'SHIPPED',
            'DOCS_RECEIVED',
            'CUSTOMS',
        ]);
    });

    it('confirms in a dialog before receiving, not a browser confirm', async () => {
        const { api } = require('@/lib/api');
        render(<ImportShipmentDetailPage />);
        await screen.findAllByText('IMP-2526-00001');

        fireEvent.click(screen.getByRole('button', { name: /Receive into stock/i }));

        // The dialog explains what receipt does before it is irreversible.
        expect(await screen.findByText(/writes a purchase at landed cost/i)).toBeInTheDocument();
        expect(api.receiveImportShipment).not.toHaveBeenCalled();
    });

    it('names the purchase, not a raw id, once received', async () => {
        const { api } = require('@/lib/api');
        api.getImportShipment.mockResolvedValue(
            shipment({
                purchase_id: '4f8a1b2c-0000-0000-0000-000000000000',
                purchase_number: 'PUR-IMP-2526-00001',
                status: 'RECEIVED',
            }),
        );

        render(<ImportShipmentDetailPage />);

        expect(await screen.findByText(/Received as PUR-IMP-2526-00001/)).toBeInTheDocument();
        expect(screen.queryByText(/4f8a1b2c/)).not.toBeInTheDocument();
    });

    it('offers settlement only after receipt', async () => {
        const { api } = require('@/lib/api');
        const before = render(<ImportShipmentDetailPage />);
        await screen.findAllByText('IMP-2526-00001');
        expect(screen.queryByRole('button', { name: /Settle LC/i })).not.toBeInTheDocument();
        before.unmount();

        api.getImportShipment.mockResolvedValue(
            shipment({ purchase_id: 'purchase-1', purchase_number: 'PUR-1', status: 'RECEIVED' }),
        );
        render(<ImportShipmentDetailPage />);
        expect(await screen.findByRole('button', { name: /Settle LC/i })).toBeInTheDocument();
    });

    it('offers acceptance until it has happened, then stops', async () => {
        const { api } = require('@/lib/api');
        api.getImportShipment.mockResolvedValue(
            shipment({ purchase_id: 'purchase-1', purchase_number: 'PUR-1', status: 'RECEIVED' }),
        );
        const first = render(<ImportShipmentDetailPage />);
        expect(await screen.findByRole('button', { name: /Record bank acceptance/i })).toBeInTheDocument();
        first.unmount();

        api.getImportShipment.mockResolvedValue(
            shipment({
                purchase_id: 'purchase-1',
                purchase_number: 'PUR-1',
                status: 'RECEIVED',
                accepted_at: '2026-01-01T00:00:00.000Z',
            }),
        );
        render(<ImportShipmentDetailPage />);
        await screen.findAllByText('IMP-2526-00001');
        expect(screen.queryByRole('button', { name: /Record bank acceptance/i })).not.toBeInTheDocument();
    });

    it('marks an unpaid charge and offers to pay it', async () => {
        const { api } = require('@/lib/api');
        api.getImportShipment.mockResolvedValue(
            shipment({
                costs: [
                    {
                        id: 'cost-1',
                        cost_type: 'CF_AGENT',
                        description: 'Clearing agent',
                        currency: 'BDT',
                        amount: '50000.00',
                        amount_bdt: '50000.00',
                        allocation_basis: 'VALUE',
                        is_capitalized: true,
                        voucher_id: 'v1',
                        paid_from_account_id: null,
                    },
                ],
            }),
        );

        render(<ImportShipmentDetailPage />);
        await screen.findByText('C&F agent');

        expect(screen.getByText('Unpaid')).toBeInTheDocument();
        expect(screen.getByTitle('Pay')).toBeInTheDocument();
    });

    it('does not offer to pay a charge that is already paid', async () => {
        const { api } = require('@/lib/api');
        api.getImportShipment.mockResolvedValue(
            shipment({
                costs: [
                    {
                        id: 'cost-1',
                        cost_type: 'FREIGHT',
                        description: null,
                        currency: 'BDT',
                        amount: '1000.00',
                        amount_bdt: '1000.00',
                        allocation_basis: 'WEIGHT',
                        is_capitalized: true,
                        voucher_id: 'v1',
                        paid_from_account_id: 'acc-bank',
                    },
                ],
            }),
        );

        render(<ImportShipmentDetailPage />);
        await screen.findByText('Freight');

        expect(screen.queryByText('Unpaid')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Pay')).not.toBeInTheDocument();
    });

    it('lists attached documents with a link to the file', async () => {
        const { api } = require('@/lib/api');
        api.getImportShipment.mockResolvedValue(
            shipment({
                documents: [
                    {
                        id: 'doc-1',
                        doc_type: 'BL',
                        file_name: 'bill-of-lading.pdf',
                        file_url: 'https://cdn.example/bl.pdf',
                    },
                ],
            }),
        );

        render(<ImportShipmentDetailPage />);

        const link = await screen.findByRole('link', { name: 'bill-of-lading.pdf' });
        expect(link).toHaveAttribute('href', 'https://cdn.example/bl.pdf');
        expect(screen.getByText('Bill of lading')).toBeInTheDocument();
    });

    it('says so plainly when there are no documents yet', async () => {
        render(<ImportShipmentDetailPage />);
        expect(await screen.findByText('No documents attached yet')).toBeInTheDocument();
    });

    it('hides delete once a cost has been recorded, because cancel is the honest action', async () => {
        const { api } = require('@/lib/api');
        api.getImportShipment.mockResolvedValue(
            shipment({
                costs: [
                    {
                        id: 'cost-1',
                        cost_type: 'FREIGHT',
                        description: null,
                        currency: 'BDT',
                        amount: '1000.00',
                        amount_bdt: '1000.00',
                        allocation_basis: 'WEIGHT',
                        is_capitalized: true,
                        voucher_id: 'v1',
                        paid_from_account_id: 'acc-bank',
                    },
                ],
            }),
        );

        render(<ImportShipmentDetailPage />);
        await screen.findAllByText('IMP-2526-00001');

        expect(screen.queryByRole('button', { name: /^Delete$/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Cancel shipment/i })).toBeInTheDocument();
    });

    it('warns what cancelling writes off before it does it', async () => {
        const { api } = require('@/lib/api');
        api.getImportShipment.mockResolvedValue(
            shipment({
                costs: [
                    {
                        id: 'cost-1',
                        cost_type: 'CUSTOMS_DUTY',
                        description: null,
                        currency: 'BDT',
                        amount: '30000.00',
                        amount_bdt: '30000.00',
                        allocation_basis: 'VALUE',
                        is_capitalized: true,
                        voucher_id: 'v1',
                        paid_from_account_id: 'acc-bank',
                    },
                ],
            }),
        );

        render(<ImportShipmentDetailPage />);
        await screen.findAllByText('IMP-2526-00001');

        fireEvent.click(screen.getByRole('button', { name: /Cancel shipment/i }));

        // The figure, not just the warning: the person cancelling should see
        // what it costs before they do it. It appears in the cost table too,
        // so the dialog's own copy is what this asserts.
        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent(/30,000.*written off to expense/),
        );
        expect(api.cancelImportShipment).not.toHaveBeenCalled();
    });
});
