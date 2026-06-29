import { act, render, screen } from '@testing-library/react';
import Toaster from './Toaster';
import { toast, useToastStore } from '@/lib/toast';

describe('Toaster', () => {
    beforeEach(() => {
        useToastStore.setState({ toasts: [] });
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('renders a success toast and auto-dismisses without user action', () => {
        render(<Toaster />);

        act(() => {
            toast.success('Sale created');
        });

        expect(screen.getByRole('status')).toHaveTextContent('Sale created');

        act(() => {
            jest.advanceTimersByTime(4000);
        });

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('renders multiline error messages', () => {
        render(<Toaster />);

        act(() => {
            toast.error('First issue\nSecond issue');
        });

        expect(screen.getByRole('status')).toHaveTextContent('First issue');
        expect(screen.getByRole('status')).toHaveTextContent('Second issue');
    });

    it('allows optional early dismiss via the close button', () => {
        render(<Toaster />);

        act(() => {
            toast.error('Payment short');
        });

        act(() => {
            screen.getByLabelText('Dismiss notification').click();
        });

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});