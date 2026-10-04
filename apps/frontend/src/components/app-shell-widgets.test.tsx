import { render, screen } from '@testing-library/react';
import { PlatformFeaturesProvider } from '@/contexts/PlatformFeaturesContext';
import { DEFAULT_PLATFORM_FEATURES } from '@erp71/shared-types';
import { FeedbackWidget } from './app-shell-widgets';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

describe('app-shell widgets', () => {
    it('holds a header button\'s place while the widget\'s chunk loads, then draws the widget there', async () => {
        const { container } = render(
            <PlatformFeaturesProvider features={{ ...DEFAULT_PLATFORM_FEATURES, feedback: true }}>
                <FeedbackWidget />
            </PlatformFeaturesProvider>,
        );

        // Same footprint as the button, so the header does not shift when it lands.
        expect(container.firstElementChild).toHaveClass('min-h-touch', 'min-w-touch');
        expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');

        expect(await screen.findByRole('button', { name: 'Open support' }, { timeout: 10000 })).toHaveClass(
            'min-h-touch',
            'min-w-touch',
        );
    }, 15000);
});
