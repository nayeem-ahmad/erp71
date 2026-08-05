import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// `@testing-library/user-event` is NOT installed in this repo — the house pattern
// is fireEvent from @testing-library/react. Do not add the dependency.
import ShortLinkManager from './ShortLinkManager';

const link = (overrides = {}) => ({
    id: 'link-1',
    code: 'aB3xK9m',
    target_url: 'https://example.com/',
    label: 'Campaign',
    click_count: 4,
    created_at: '2026-08-04T00:00:00.000Z',
    revoked_at: null,
    ...overrides,
});

describe('ShortLinkManager', () => {
    it('lists links returned by fetchLinks', async () => {
        render(
            <ShortLinkManager
                fetchLinks={jest.fn().mockResolvedValue([link()])}
                createLink={jest.fn()}
                revokeLink={jest.fn()}
            />,
        );

        expect(await screen.findByText('/s/aB3xK9m')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('unwraps a { data } envelope', async () => {
        render(
            <ShortLinkManager
                fetchLinks={jest.fn().mockResolvedValue({ data: [link()] })}
                createLink={jest.fn()}
                revokeLink={jest.fn()}
            />,
        );

        expect(await screen.findByText('/s/aB3xK9m')).toBeInTheDocument();
    });

    it('shows an empty state when there are no links', async () => {
        render(
            <ShortLinkManager
                fetchLinks={jest.fn().mockResolvedValue([])}
                createLink={jest.fn()}
                revokeLink={jest.fn()}
            />,
        );

        expect(await screen.findByText(/no short links yet/i)).toBeInTheDocument();
    });

    it('creates a link and reloads the list', async () => {
        const createLink = jest.fn().mockResolvedValue({});
        const fetchLinks = jest
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([link()]);

        render(<ShortLinkManager fetchLinks={fetchLinks} createLink={createLink} revokeLink={jest.fn()} />);
        await screen.findByText(/no short links yet/i);

        fireEvent.change(screen.getByPlaceholderText(/https/i), {
            target: { value: 'https://example.com' },
        });
        fireEvent.click(screen.getByRole('button', { name: /shorten/i }));

        await waitFor(() => expect(createLink).toHaveBeenCalledWith({ target_url: 'https://example.com' }));
        expect(await screen.findByText('/s/aB3xK9m')).toBeInTheDocument();
    });

    it('shows the rejection reason inline when the target is refused', async () => {
        // isSafeTarget names the rule it rejected on, and that reason is the only
        // thing telling the user why a URL they consider fine was refused.
        const createLink = jest.fn().mockRejectedValue(new Error('Only http and https links are allowed.'));

        render(
            <ShortLinkManager
                fetchLinks={jest.fn().mockResolvedValue([])}
                createLink={createLink}
                revokeLink={jest.fn()}
            />,
        );
        await screen.findByText(/no short links yet/i);

        fireEvent.change(screen.getByPlaceholderText(/https/i), {
            target: { value: 'javascript:alert(1)' },
        });
        fireEvent.click(screen.getByRole('button', { name: /shorten/i }));

        expect(await screen.findByText('Only http and https links are allowed.')).toBeInTheDocument();
    });

    it('revokes a link and reloads', async () => {
        const revokeLink = jest.fn().mockResolvedValue({});
        const fetchLinks = jest
            .fn()
            .mockResolvedValueOnce([link()])
            .mockResolvedValueOnce([link({ revoked_at: '2026-08-05T00:00:00.000Z' })]);

        render(<ShortLinkManager fetchLinks={fetchLinks} createLink={jest.fn()} revokeLink={revokeLink} />);
        await screen.findByText('/s/aB3xK9m');

        fireEvent.click(screen.getByRole('button', { name: /revoke/i }));

        await waitFor(() => expect(revokeLink).toHaveBeenCalledWith('link-1'));
        expect(await screen.findByText(/revoked/i)).toBeInTheDocument();
    });

    it('offers no revoke control on an already-revoked link', async () => {
        render(
            <ShortLinkManager
                fetchLinks={jest.fn().mockResolvedValue([link({ revoked_at: '2026-08-05T00:00:00.000Z' })])}
                createLink={jest.fn()}
                revokeLink={jest.fn()}
            />,
        );
        await screen.findByText('/s/aB3xK9m');

        expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
    });

    it('renders the description when one is given', async () => {
        render(
            <ShortLinkManager
                description="Shared across your business."
                fetchLinks={jest.fn().mockResolvedValue([])}
                createLink={jest.fn()}
                revokeLink={jest.fn()}
            />,
        );

        expect(await screen.findByText('Shared across your business.')).toBeInTheDocument();
    });
});
