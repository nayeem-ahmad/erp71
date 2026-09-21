import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WriteOffDebtModal from './WriteOffDebtModal';

jest.mock('@/lib/api', () => ({
    api: { writeOffCustomerDebt: jest.fn() },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toast } = require('@/lib/toast');

const onClose = jest.fn();
const onSuccess = jest.fn();

function renderModal(due = 10_000, open = true) {
    return render(
        <WriteOffDebtModal
            open={open}
            customerId="cust-1"
            customerName="Alice Corp"
            dueBalance={due}
            onClose={onClose}
            onSuccess={onSuccess}
        />,
    );
}

/** The textarea is the only multiline control in the modal. */
const notesBox = () => screen.getByRole('textbox');
const amountBox = () => screen.getByRole('spinbutton');

beforeEach(() => {
    jest.clearAllMocks();
    api.writeOffCustomerDebt.mockResolvedValue({ id: 'wo-1', payment_number: 'CWO-00001' });
});

describe('WriteOffDebtModal', () => {
    it('renders nothing when closed', () => {
        const { container } = renderModal(10_000, false);
        expect(container).toBeEmptyDOMElement();
    });

    it('prefills the whole outstanding amount, the common case', () => {
        renderModal(7500);
        expect(amountBox()).toHaveValue(7500);
    });

    it('submits the amount, reason, note and credit flag', async () => {
        renderModal(10_000);
        fireEvent.change(notesBox(), { target: { value: 'Shop shut, phone dead.' } });
        fireEvent.click(screen.getByRole('button', { name: /write off/i }));

        await waitFor(() => expect(api.writeOffCustomerDebt).toHaveBeenCalled());
        const [customerId, payload] = api.writeOffCustomerDebt.mock.calls[0];
        expect(customerId).toBe('cust-1');
        expect(payload).toMatchObject({
            amount: 10_000,
            reason: 'UNTRACEABLE',
            notes: 'Shop shut, phone dead.',
            disableCredit: true,
        });
        expect(onSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    // Would conjure a credit balance out of nothing; the API refuses it too.
    it('refuses to write off more than is owed, without calling the API', async () => {
        renderModal(1000);
        fireEvent.change(amountBox(), { target: { value: '5000' } });
        fireEvent.change(notesBox(), { target: { value: 'Gone.' } });
        fireEvent.click(screen.getByRole('button', { name: /write off/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/more than/i);
        expect(api.writeOffCustomerDebt).not.toHaveBeenCalled();
    });

    it('rejects a zero amount', async () => {
        renderModal(1000);
        fireEvent.change(amountBox(), { target: { value: '0' } });
        fireEvent.change(notesBox(), { target: { value: 'Gone.' } });
        fireEvent.click(screen.getByRole('button', { name: /write off/i }));

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(api.writeOffCustomerDebt).not.toHaveBeenCalled();
    });

    // The write-off is the one AR action with no document from the other side,
    // so the note is the only record of why it happened.
    it('will not submit without an explanation', async () => {
        renderModal(1000);
        fireEvent.click(screen.getByRole('button', { name: /write off/i }));

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(api.writeOffCustomerDebt).not.toHaveBeenCalled();
    });

    it('lets the caller keep the customer on credit', async () => {
        renderModal(1000);
        fireEvent.change(notesBox(), { target: { value: 'Settled short.' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /write off/i }));

        await waitFor(() => expect(api.writeOffCustomerDebt).toHaveBeenCalled());
        expect(api.writeOffCustomerDebt.mock.calls[0][1].disableCredit).toBe(false);
    });

    it('surfaces an API refusal as a toast and stays open', async () => {
        api.writeOffCustomerDebt.mockRejectedValue(new Error('Period is locked'));
        renderModal(1000);
        fireEvent.change(notesBox(), { target: { value: 'Gone.' } });
        fireEvent.click(screen.getByRole('button', { name: /write off/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Period is locked'));
        expect(onClose).not.toHaveBeenCalled();
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('says the original sale and its VAT are not reversed', () => {
        renderModal(1000);
        expect(screen.getByText(/not reversed/i)).toBeInTheDocument();
    });
});
