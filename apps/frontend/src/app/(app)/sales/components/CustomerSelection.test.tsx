import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import CustomerSelection, { emptyCustomerDraft, type NewCustomerDraft } from './CustomerSelection';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

jest.mock('@/lib/api', () => ({
    api: {
        getCustomers: jest.fn(),
        createCustomer: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const EXISTING_CUSTOMER = {
    id: 'cust-1',
    name: 'Anwar Chowdhury',
    phone: '01700100057',
    address: 'Mirpur',
};

/** The draft state the entry screens own, so the picker behaves as it does there. */
function Harness() {
    const [customer, setCustomer] = useState<any>(null);
    const [draft, setDraft] = useState<NewCustomerDraft | null>(null);

    return (
        <form onSubmit={(e) => e.preventDefault()}>
            <CustomerSelection
                customer={customer}
                setCustomer={setCustomer}
                draft={draft}
                setDraft={setDraft}
            />
            <output data-testid="selected">{customer ? customer.id : 'none'}</output>
            <output data-testid="draft">{draft ? 'open' : 'closed'}</output>
        </form>
    );
}

async function openDraftForm() {
    render(<Harness />);
    await waitFor(() => expect(api.getCustomers).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('New Customer'));
    return screen.getByLabelText('Customer name');
}

describe('CustomerSelection new-customer draft', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getCustomers as jest.Mock).mockResolvedValue([EXISTING_CUSTOMER]);
    });

    it('saves and selects the drafted customer without touching the document', async () => {
        (api.createCustomer as jest.Mock).mockResolvedValue({
            id: 'cust-2',
            name: 'Rahim Mia',
            phone: '01811223344',
        });

        const nameField = await openDraftForm();
        fireEvent.change(nameField, { target: { value: 'Rahim Mia' } });
        fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '01811223344' } });

        fireEvent.click(screen.getByLabelText('Save & select customer'));

        await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('cust-2'));
        expect(api.createCustomer).toHaveBeenCalledWith({
            name: 'Rahim Mia',
            phone: '01811223344',
            email: undefined,
            address: undefined,
        });
        // Draft cleared, so the document posts a customerId rather than newCustomer.
        expect(screen.getByTestId('draft')).toHaveTextContent('closed');
        expect(toast.success).toHaveBeenCalledWith('Rahim Mia saved and selected.');
    });

    it('refuses to save a nameless draft and says so inline', async () => {
        const nameField = await openDraftForm();
        fireEvent.change(nameField, { target: { value: '   ' } });

        fireEvent.click(screen.getByLabelText('Save & select customer'));

        expect(api.createCustomer).not.toHaveBeenCalled();
        expect(screen.getByText('Customer name is required when creating a customer inline.'))
            .toBeInTheDocument();
        expect(screen.getByTestId('draft')).toHaveTextContent('open');
    });

    it('selects the customer already holding that phone instead of duplicating them', async () => {
        const nameField = await openDraftForm();
        fireEvent.change(nameField, { target: { value: 'Anwar' } });
        fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '01700100057' } });

        fireEvent.click(screen.getByLabelText('Save & select customer'));

        await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent('cust-1'));
        expect(api.createCustomer).not.toHaveBeenCalled();
        expect(toast.info).toHaveBeenCalledWith(
            'That phone is already on file — selected Anwar Chowdhury.',
        );
    });

    it('keeps the draft open and reports the failure when the save is rejected', async () => {
        (api.createCustomer as jest.Mock).mockRejectedValue(new Error('Phone number already in use'));

        const nameField = await openDraftForm();
        fireEvent.change(nameField, { target: { value: 'Rahim Mia' } });

        fireEvent.click(screen.getByLabelText('Save & select customer'));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Phone number already in use'));
        expect(screen.getByTestId('draft')).toHaveTextContent('open');
        expect(screen.getByTestId('selected')).toHaveTextContent('none');
    });

    it('drops the draft on the cross, leaving nothing to create with the document', async () => {
        const nameField = await openDraftForm();
        fireEvent.change(nameField, { target: { value: 'Rahim Mia' } });

        fireEvent.click(screen.getByLabelText('Use Existing'));

        expect(screen.getByTestId('draft')).toHaveTextContent('closed');
        expect(api.createCustomer).not.toHaveBeenCalled();
    });

    it('saves the customer on Enter rather than submitting the document', async () => {
        (api.createCustomer as jest.Mock).mockResolvedValue({ id: 'cust-3', name: 'Rahim Mia' });

        const nameField = await openDraftForm();
        fireEvent.change(nameField, { target: { value: 'Rahim Mia' } });
        fireEvent.keyDown(nameField, { key: 'Enter' });

        await waitFor(() => expect(api.createCustomer).toHaveBeenCalled());
        expect(screen.getByTestId('selected')).toHaveTextContent('cust-3');
    });

    it('starts from a blank form, so an earlier draft does not leak into the next one', async () => {
        const nameField = await openDraftForm();
        fireEvent.change(nameField, { target: { value: 'Rahim Mia' } });
        fireEvent.click(screen.getByLabelText('Use Existing'));

        fireEvent.click(screen.getByLabelText('New Customer'));

        expect(screen.getByLabelText('Customer name')).toHaveValue(emptyCustomerDraft.name);
    });
});
