import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PaymentSection from './PaymentSection';

jest.mock('@/lib/api', () => ({
    api: {
        getPaymentMethods: jest.fn().mockResolvedValue([
            { id: 'pm-1', name: 'Cash', type: 'CASH', is_active: true, show_on_entry: true, sort_order: 1 },
            { id: 'pm-2', name: 'bKash', type: 'MOBILE_WALLET', is_active: true, show_on_entry: false, sort_order: 2 },
        ]),
    },
}));

describe('PaymentSection', () => {
    it('stops re-rendering after payment methods load', async () => {
        const onPaymentChange = jest.fn();
        const { container } = render(
            <PaymentSection payments={[]} total={100} onPaymentChange={onPaymentChange} />,
        );

        await waitFor(() => {
            expect(screen.getByLabelText('Cash amount')).toBeInTheDocument();
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        let mutationCount = 0;
        const observer = new MutationObserver(() => {
            mutationCount += 1;
        });
        observer.observe(container, {
            subtree: true,
            attributes: true,
            childList: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 200));
        observer.disconnect();

        expect(mutationCount).toBeLessThan(5);
    });

    it('shows only show_on_entry methods by default, revealing others via the Add method picker', async () => {
        const onPaymentChange = jest.fn();
        render(
            <PaymentSection payments={[]} total={100} onPaymentChange={onPaymentChange} />,
        );

        await waitFor(() => {
            expect(screen.getByLabelText('Cash amount')).toBeInTheDocument();
        });

        expect(screen.queryByLabelText('bKash amount')).not.toBeInTheDocument();

        const picker = screen.getByLabelText('Add payment method');
        fireEvent.change(picker, { target: { value: 'pm-2' } });

        await waitFor(() => {
            expect(screen.getByLabelText('bKash amount')).toBeInTheDocument();
        });
    });

    it('falls back to generic methods when all defined methods are inactive', async () => {
        const { api } = require('@/lib/api');
        (api.getPaymentMethods as jest.Mock).mockResolvedValueOnce([
            { id: 'pm-1', name: 'Cash', type: 'CASH', is_active: false, show_on_entry: true, sort_order: 1 },
            { id: 'pm-2', name: 'bKash', type: 'MOBILE_WALLET', is_active: false, show_on_entry: true, sort_order: 2 },
        ]);

        render(
            <PaymentSection payments={[]} total={100} onPaymentChange={jest.fn()} />,
        );

        // Generic fallback keeps payment possible even though every defined method is inactive.
        await waitFor(() => {
            expect(screen.getByLabelText('Cash amount')).toBeInTheDocument();
        });
        expect(screen.getByLabelText('Card amount')).toBeInTheDocument();
        expect(screen.getByLabelText('Bank amount')).toBeInTheDocument();
    });
});
