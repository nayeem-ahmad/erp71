'use client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContactsPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/crm/contacts',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
}));

jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

// The scanner reaches for a camera on mount; nothing here exercises it.
jest.mock('./BusinessCardScanner', () => ({
    __esModule: true,
    default: () => null,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getContacts: jest.fn(),
        getTeamMembers: jest.fn(),
        deleteContact: jest.fn(),
        bulkContactAction: jest.fn(),
        importContacts: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

const contacts = [
    {
        id: 'contact-1',
        name: 'Karim Rahman',
        company: 'Karim Traders',
        designation: 'Owner',
        mobile: '01700000000',
        phone: null,
        email: 'karim@example.com',
        capture_source: 'MANUAL',
        photo_url: null,
        assignee: { id: 'user-2', name: 'Rifat' },
        created_at: '2026-08-01T08:00:00.000Z',
    },
];

/** The filters are unlabelled selects, so each is found by an option only it has. */
function selectByOption(optionText: string): HTMLSelectElement {
    const option = screen.getByRole('option', { name: optionText });
    return option.closest('select') as HTMLSelectElement;
}

/**
 * The CRM-wide "only mine" scope — the same switch the leads list, the
 * activities list and the Overview carry, sharing one remembered preference.
 */
describe('ContactsPage — only mine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        api.getContacts.mockResolvedValue({ items: contacts, total: 1 });
        api.getTeamMembers.mockResolvedValue([
            { userId: 'user-1', name: 'Nayeem' },
            { userId: 'user-2', name: 'Rifat' },
        ]);
    });

    const toggle = () => screen.getByRole('button', { name: 'Only mine' });
    const lastCall = () => api.getContacts.mock.calls.at(-1)[0];

    it('shows the whole team until somebody asks for their own', async () => {
        render(<ContactsPage />);
        await screen.findByText('Karim Rahman');

        expect(lastCall().mine).toBeUndefined();
        expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    });

    it('narrows the list to the caller, letting the server resolve the id', async () => {
        render(<ContactsPage />);
        await screen.findByText('Karim Rahman');

        fireEvent.click(toggle());

        await waitFor(() => expect(lastCall().mine).toBe(true));
        // No user id is looked up or sent — that is the server's job.
        expect(lastCall().assignedTo).toBeUndefined();
    });

    it('locks the owner filter while the scope is on, rather than lying about it', async () => {
        render(<ContactsPage />);
        await screen.findByText('Karim Rahman');

        fireEvent.click(toggle());

        await waitFor(() => expect(selectByOption('Only mine')).toBeDisabled());
    });

    it('remembers the choice for the next visit', async () => {
        const first = render(<ContactsPage />);
        await screen.findByText('Karim Rahman');
        fireEvent.click(toggle());
        await waitFor(() => expect(lastCall().mine).toBe(true));
        first.unmount();

        jest.clearAllMocks();
        api.getContacts.mockResolvedValue({ items: contacts, total: 1 });
        api.getTeamMembers.mockResolvedValue([]);

        render(<ContactsPage />);
        await screen.findByText('Karim Rahman');

        expect(toggle()).toHaveAttribute('aria-pressed', 'true');
        // And never a first request for everybody's rows before the remembered
        // scope lands — that flash is what `scopeReady` exists to prevent.
        for (const call of api.getContacts.mock.calls) {
            expect(call[0].mine).toBe(true);
        }
    });
});
