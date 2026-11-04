/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SupportCallControl from './SupportCallControl';
import { ApiError, api } from '@/lib/api';
import { placeMeet71Call } from '@/lib/meet71-dialer';

jest.mock('@/lib/api', () => {
    const actual = jest.requireActual('@/lib/api');
    return {
        ...actual,
        api: {
            getMeet71Directory: jest.fn(),
            getMeet71Presence: jest.fn(),
        },
    };
});

jest.mock('@/lib/meet71-dialer', () => {
    const actual = jest.requireActual('@/lib/meet71-dialer');
    return {
        ...actual,
        placeMeet71Call: jest.fn(),
    };
});

jest.mock('@/hooks/useVisibleInterval', () => ({
    useVisibleInterval: () => undefined,
}));

describe('SupportCallControl', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (api.getMeet71Directory as jest.Mock).mockResolvedValue([
            { email: 'support@erp71.com', displayName: 'Support' },
            { email: 'offline@erp71.com', displayName: 'Offline' },
        ]);
        (api.getMeet71Presence as jest.Mock).mockResolvedValue({ online: ['support@erp71.com'] });
        (placeMeet71Call as jest.Mock).mockResolvedValue(undefined);
    });

    it('hides when the account is not on the Meet71 list', async () => {
        (api.getMeet71Directory as jest.Mock).mockRejectedValue(
            new ApiError('Nope', 403, 'MEET71_NOT_ALLOWED'),
        );

        const { container } = render(<SupportCallControl />);
        await waitFor(() => expect(api.getMeet71Directory).toHaveBeenCalled());
        expect(container).toBeEmptyDOMElement();
    });

    it('disables Call when nobody is online', async () => {
        (api.getMeet71Presence as jest.Mock).mockResolvedValue({ online: [] });
        render(<SupportCallControl />);

        const button = await screen.findByRole('button', { name: /unavailable|Call unavailable/i });
        expect(button).toBeDisabled();
    });

    it('enables Call when a platform user is online and can place a voice call', async () => {
        render(<SupportCallControl />);

        const call = await screen.findByRole('button', { name: /^Call$/i });
        expect(call).toBeEnabled();
        fireEvent.click(call);

        expect(await screen.findByText('Call support')).toBeInTheDocument();
        expect(screen.getByText('Support')).toBeInTheDocument();
        expect(screen.queryByText('Offline')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Voice$/i }));
        await waitFor(() =>
            expect(placeMeet71Call).toHaveBeenCalledWith('support@erp71.com', 'voice'),
        );
    });
});
