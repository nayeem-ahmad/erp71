import { render, screen, waitFor } from '@testing-library/react';
import PaymentSection from './PaymentSection';

jest.mock('@/lib/api', () => ({
    api: {
        getPaymentMethods: jest.fn().mockResolvedValue([
            { id: 'pm-1', name: 'Cash', type: 'CASH', is_active: true },
            { id: 'pm-2', name: 'bKash', type: 'MOBILE_WALLET', is_active: true },
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
});