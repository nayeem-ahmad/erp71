import { render, waitFor } from '@testing-library/react';
import ServiceWorkerRegistrar from './ServiceWorkerRegistrar';

describe('ServiceWorkerRegistrar', () => {
    afterEach(() => {
        // jsdom has no service workers; each test adds its own stub.
        delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    });

    function stubServiceWorker(register: jest.Mock) {
        const unregister = jest.fn().mockResolvedValue(true);
        const container = {
            register,
            getRegistrations: jest.fn().mockResolvedValue([{ unregister }]),
        };
        Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
        return { container, unregister };
    }

    it('registers /sw.js once per load', () => {
        const { container } = stubServiceWorker(jest.fn().mockResolvedValue({}));

        render(<ServiceWorkerRegistrar />);

        expect(container.register).toHaveBeenCalledTimes(1);
        expect(container.register).toHaveBeenCalledWith('/sw.js');
    });

    // Tearing the worker down on every load re-ran its install — pre-cache
    // requests included — at the busiest moment of every page load.
    it('leaves the existing registration alone', async () => {
        const { container, unregister } = stubServiceWorker(jest.fn().mockResolvedValue({}));

        render(<ServiceWorkerRegistrar />);
        await Promise.resolve();

        expect(container.getRegistrations).not.toHaveBeenCalled();
        expect(unregister).not.toHaveBeenCalled();
    });

    it('does nothing in a browser without service workers', () => {
        expect('serviceWorker' in navigator).toBe(false);
        expect(() => render(<ServiceWorkerRegistrar />)).not.toThrow();
    });

    it('logs a failed registration instead of throwing', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        stubServiceWorker(jest.fn().mockRejectedValue(new Error('blocked')));

        render(<ServiceWorkerRegistrar />);

        await waitFor(() => expect(error).toHaveBeenCalledWith(
            '[ServiceWorkerRegistrar] Registration failed:',
            expect.any(Error),
        ));
        error.mockRestore();
    });
});
