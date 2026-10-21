import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PaymentLayoutModal, { type PaymentLayoutModalLabels } from './PaymentLayoutModal';
import { useToastStore } from '@/lib/toast';
import type { PaymentMethodRow } from '@/lib/api';

const row = (id: string, name: string, sort_order: number): PaymentMethodRow =>
    ({
        id,
        name,
        type: 'Cash',
        account_id: null,
        is_active: true,
        sort_order,
        show_on_entry: true,
        all_branches: true,
        store_ids: [],
    }) as PaymentMethodRow;

const CASH = row('pm-cash', 'Cash', 1);
const BKASH = row('pm-bkash', 'bKash', 2);
const CARD = row('pm-card', 'Card', 3);

const labels: PaymentLayoutModalLabels = {
    customiseTitle: 'Payment methods on this screen',
    resetLayout: 'Reset to default',
    saveLayout: 'Save',
    cancelLayout: 'Cancel',
    moveUp: 'Move {method} up',
    moveDown: 'Move {method} down',
    showMethod: 'Show {method}',
    layoutSaveFailed: 'Could not save the layout',
};

function renderModal(over: Partial<React.ComponentProps<typeof PaymentLayoutModal>> = {}) {
    const props = {
        methods: [CASH, BKASH, CARD],
        hiddenIds: [] as string[],
        onSave: jest.fn().mockResolvedValue(undefined),
        onReset: jest.fn().mockResolvedValue(undefined),
        onClose: jest.fn(),
        labels,
        ...over,
    };
    render(<PaymentLayoutModal {...props} />);
    return props;
}

/** Method names in the order the modal lists them. */
const listed = () =>
    screen
        .getAllByRole('checkbox')
        .map((box) => (box.getAttribute('aria-label') ?? '').replace('Show ', ''));

beforeEach(() => {
    useToastStore.setState({ toasts: [] });
});

describe('PaymentLayoutModal', () => {
    it('moving a method up and saving sends the new order', async () => {
        const props = renderModal();

        fireEvent.click(screen.getByLabelText('Move bKash up'));
        expect(listed()).toEqual(['bKash', 'Cash', 'Card']);
        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
        expect(props.onSave).toHaveBeenCalledWith({ order: ['pm-bkash', 'pm-cash', 'pm-card'], hidden: [] });
        await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    });

    it('unchecking hides it on save', async () => {
        const props = renderModal();

        fireEvent.click(screen.getByLabelText('Show bKash'));
        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => expect(props.onSave).toHaveBeenCalled());
        expect(props.onSave).toHaveBeenCalledWith({
            order: ['pm-cash', 'pm-bkash', 'pm-card'],
            hidden: ['pm-bkash'],
        });
    });

    it('starts with the hidden methods unchecked', () => {
        renderModal({ hiddenIds: ['pm-card'] });

        expect(screen.getByLabelText('Show Cash')).toBeChecked();
        expect(screen.getByLabelText('Show Card')).not.toBeChecked();
    });

    it('↑ is disabled on the first row, ↓ on the last', () => {
        renderModal();

        expect(screen.getByLabelText('Move Cash up')).toBeDisabled();
        expect(screen.getByLabelText('Move Cash down')).toBeEnabled();
        expect(screen.getByLabelText('Move Card down')).toBeDisabled();
        expect(screen.getByLabelText('Move Card up')).toBeEnabled();
    });

    it('Reset calls the reset handler and closes', async () => {
        const props = renderModal();

        fireEvent.click(screen.getByText('Reset to default'));

        await waitFor(() => expect(props.onReset).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(props.onClose).toHaveBeenCalled());
        expect(props.onSave).not.toHaveBeenCalled();
    });

    it('a failed save keeps the modal open and toasts', async () => {
        const props = renderModal({ onSave: jest.fn().mockRejectedValue(new Error('Server said no')) });

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
        expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'Server said no' });
        expect(props.onClose).not.toHaveBeenCalled();
        // Still there, and usable again.
        expect(screen.getByText('Save')).toBeEnabled();
    });

    it('a failed reset keeps the modal open and toasts the fallback copy', async () => {
        const props = renderModal({ onReset: jest.fn().mockRejectedValue('nope') });

        fireEvent.click(screen.getByText('Reset to default'));

        await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
        expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'Could not save the layout' });
        expect(props.onClose).not.toHaveBeenCalled();
    });

    it('Cancel closes without saving', () => {
        const props = renderModal();

        fireEvent.click(screen.getByText('Cancel'));

        expect(props.onClose).toHaveBeenCalled();
        expect(props.onSave).not.toHaveBeenCalled();
    });
});
