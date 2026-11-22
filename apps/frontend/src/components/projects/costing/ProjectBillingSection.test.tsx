import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectBillingSection from './ProjectBillingSection';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
jest.mock('@/lib/api', () => ({
    api: {
        getProjectBilling: jest.fn(),
        getProjectBillingProducts: jest.fn(),
        createProjectInvoice: jest.fn(),
        createProjectMilestone: jest.fn(),
        setProjectMemberBillRate: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = jest.requireMock('@/lib/api') as { api: Record<string, jest.Mock> };
const { toast } = jest.requireMock('@/lib/toast') as { toast: { success: jest.Mock } };

const billing = (overrides: Record<string, any> = {}) => ({
    project: { billingType: 'FIXED_PRICE', contractValue: 12000, billRate: null, customer: { id: 'c1', name: 'Rahim Traders' } },
    billingProductId: 'svc-1',
    invoices: [],
    milestones: [
        { id: 'm1', name: 'Foundation', targetDate: '2026-08-30', completed: true, amount: 4000, invoice: { id: 's1', serialNumber: 'INV-1' } },
        { id: 'm2', name: 'Roof', targetDate: null, completed: false, amount: 3000, invoice: null },
    ],
    unbilledHours: { hours: 0, amount: 0, unratedHours: 0, people: [] },
    ...overrides,
});

describe('ProjectBillingSection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.getProjectBilling.mockResolvedValue(billing());
        api.getProjectBillingProducts.mockResolvedValue([{ id: 'svc-1', name: 'Project services', vatRate: 15 }]);
        api.createProjectInvoice.mockResolvedValue({ saleId: 's2', serialNumber: 'INV-2', totalAmount: 3450 });
        api.createProjectMilestone.mockResolvedValue({ id: 'm3' });
        api.setProjectMemberBillRate.mockResolvedValue({ id: 'mem-1', billRate: 900 });
    });

    it('links a billed milestone to its invoice, and invoices the next one before VAT by default', async () => {
        const onChanged = jest.fn();
        render(<ProjectBillingSection projectId="p1" onChanged={onChanged} />);

        expect(await screen.findByRole('link', { name: 'INV-1' })).toHaveAttribute('href', '/sales/s1');
        fireEvent.click(screen.getByRole('button', { name: 'Invoice' }));

        expect(await screen.findByText('To Rahim Traders')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByLabelText('Billing product')).toHaveValue('svc-1'));
        fireEvent.click(screen.getByRole('button', { name: 'Raise invoice' }));

        await waitFor(() =>
            expect(api.createProjectInvoice).toHaveBeenCalledWith('p1', expect.objectContaining({
                kind: 'MILESTONE', milestoneId: 'm2', productId: 'svc-1', amountIncludesVat: false,
            })),
        );
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('INV-2'));
        expect(onChanged).toHaveBeenCalled();
    });

    it('adds a milestone to the billing plan', async () => {
        render(<ProjectBillingSection projectId="p1" onChanged={jest.fn()} />);

        fireEvent.change(await screen.findByLabelText('Milestone'), { target: { value: 'Handover' } });
        fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '5000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add milestone' }));

        await waitFor(() =>
            expect(api.createProjectMilestone).toHaveBeenCalledWith('p1', { name: 'Handover', amount: 5000 }),
        );
    });

    it('invoices unbilled hours on time and materials, and sets a member\'s own rate', async () => {
        api.getProjectBilling.mockResolvedValue(billing({
            project: { billingType: 'TIME_AND_MATERIALS', contractValue: null, billRate: 500, customer: { id: 'c1', name: 'Rahim Traders' } },
            milestones: [],
            unbilledHours: {
                hours: 6,
                amount: 4200,
                unratedHours: 0,
                people: [
                    { key: 'employee:e1', name: 'Karim Uddin', memberId: 'mem-1', hours: 4, rate: 800, rateSource: 'MEMBER', amount: 3200 },
                    { key: 'user:u2', name: 'Abdul', memberId: null, hours: 2, rate: 500, rateSource: 'PROJECT', amount: 1000 },
                ],
            },
        }));
        render(<ProjectBillingSection projectId="p1" onChanged={jest.fn()} />);

        const rate = await screen.findByLabelText('Bill rate per hour — Karim Uddin');
        fireEvent.change(rate, { target: { value: '900' } });
        fireEvent.blur(rate);
        await waitFor(() => expect(api.setProjectMemberBillRate).toHaveBeenCalledWith('p1', 'mem-1', 900));

        fireEvent.click(screen.getByRole('button', { name: 'Invoice these hours' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Raise invoice' }));

        await waitFor(() =>
            expect(api.createProjectInvoice).toHaveBeenCalledWith('p1', expect.objectContaining({ kind: 'HOURS' })),
        );
    });

    it('will not invoice hours some of which have no rate', async () => {
        api.getProjectBilling.mockResolvedValue(billing({
            project: { billingType: 'TIME_AND_MATERIALS', contractValue: null, billRate: null, customer: { id: 'c1', name: 'Rahim Traders' } },
            milestones: [],
            unbilledHours: {
                hours: 2, amount: 0, unratedHours: 2,
                people: [{ key: 'user:u2', name: 'Abdul', memberId: null, hours: 2, rate: null, rateSource: null, amount: 0 }],
            },
        }));
        render(<ProjectBillingSection projectId="p1" onChanged={jest.fn()} />);

        expect(await screen.findByText(/2 h have no bill rate/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Invoice these hours' })).toBeDisabled();
    });

    it('says why a project cannot be invoiced yet', async () => {
        api.getProjectBilling.mockResolvedValue(billing({
            project: { billingType: 'FIXED_PRICE', contractValue: 12000, billRate: null, customer: null },
        }));
        render(<ProjectBillingSection projectId="p1" onChanged={jest.fn()} />);

        expect(await screen.findByText(/Set the project's customer/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Invoice an amount' })).not.toBeInTheDocument();
    });

    it('offers no invoicing on an internal project', async () => {
        api.getProjectBilling.mockResolvedValue(billing({
            project: { billingType: 'INTERNAL', contractValue: null, billRate: null, customer: null },
            milestones: [],
        }));
        render(<ProjectBillingSection projectId="p1" onChanged={jest.fn()} />);

        expect(await screen.findByText('This project is not billed.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Invoice' })).not.toBeInTheDocument();
    });

    it('needs a description to invoice a plain amount', async () => {
        render(<ProjectBillingSection projectId="p1" onChanged={jest.fn()} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Invoice an amount' }));
        const dialogAmount = await screen.findByLabelText('Amount', { selector: '#invoice-amount' });
        fireEvent.change(dialogAmount, { target: { value: '2000' } });
        await waitFor(() => expect(screen.getByLabelText('Billing product')).toHaveValue('svc-1'));
        expect(screen.getByRole('button', { name: 'Raise invoice' })).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Advance' } });
        fireEvent.click(screen.getByRole('button', { name: 'Raise invoice' }));

        await waitFor(() =>
            expect(api.createProjectInvoice).toHaveBeenCalledWith('p1', expect.objectContaining({
                kind: 'AMOUNT', amount: 2000, description: 'Advance',
            })),
        );
    });
});
