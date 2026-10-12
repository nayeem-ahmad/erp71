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

    it('offers a follow-up action that runs once and closes the toast', () => {
        const onClick = jest.fn();
        render(<Toaster />);

        act(() => {
            toast.success('CPY-00012 saved', { action: { label: 'Print receipt', onClick } });
        });

        act(() => {
            screen.getByRole('button', { name: 'Print receipt' }).click();
        });

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('keeps an action toast up for twice as long', () => {
        act(() => {
            toast.success('Saved', { action: { label: 'Print', onClick: () => {} } });
            toast.success('Plain', 1500);
        });

        const [withAction, plain] = useToastStore.getState().toasts;
        expect(withAction.duration).toBe(8000);
        expect(plain.duration).toBe(1500);
    });
});
