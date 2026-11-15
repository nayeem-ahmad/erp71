'use client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContactDetailPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    usePathname: () => '/crm/contacts/contact-1',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ id: 'contact-1' }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getContact: jest.fn(),
        getCrmAssignees: jest.fn().mockResolvedValue([]),
        updateContact: jest.fn(),
        deleteContact: jest.fn(),
        deleteContactAttachment: jest.fn(),
    },
}));
jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

function contact(extra: Record<string, unknown> = {}) {
    return {
        id: 'contact-1',
        name: 'Karim Uddin',
        company: 'Karim Traders',
        mobile: '01712-345678',
        phone: null,
        email: 'karim@shop.com',
        capture_source: 'MANUAL',
        created_at: '2026-11-01T00:00:00.000Z',
        creator: null,
        organization: null,
        attachments: [],
        leads: [],
        ...extra,
    };
}

describe('ContactDetailPage — convert to lead', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('offers to convert the contact, opening a new lead filed from it', async () => {
        api.getContact.mockResolvedValue(contact());
        render(<ContactDetailPage />);

        const cta = await screen.findByRole('link', { name: /convert to lead/i });
        expect(cta).toHaveAttribute('href', '/crm/leads/new?contactId=contact-1');
        expect(screen.getByText('No leads for this contact yet.')).toBeInTheDocument();
    });

    it('lists the leads already filed for the contact, each linking to it', async () => {
        api.getContact.mockResolvedValue(contact({
            leads: [{
                id: 'lead-9',
                name: 'Karim Uddin',
                status: 'QUALIFIED',
                created_at: '2026-11-10T00:00:00.000Z',
                statusOption: { id: 'st-neg', code: 'NEGOTIATION', name: 'Negotiation', lifecycle: 'QUALIFIED', is_system: false },
            }],
        }));
        render(<ContactDetailPage />);

        const lead = await screen.findByRole('link', { name: /karim uddin/i });
        expect(lead).toHaveAttribute('href', '/crm/leads/lead-9');
        expect(screen.getByText('Negotiation')).toBeInTheDocument();
        expect(screen.queryByText('No leads for this contact yet.')).toBeNull();
    });

    it('keeps the leads on screen after saving the contact', async () => {
        const leads = [{
            id: 'lead-9',
            name: 'Karim Uddin',
            status: 'NEW',
            created_at: '2026-11-10T00:00:00.000Z',
            statusOption: null,
        }];
        api.getContact.mockResolvedValue(contact({ leads }));
        // The update response carries no leads — only the detail read does.
        api.updateContact.mockResolvedValue(contact({ leads: undefined }));
        render(<ContactDetailPage />);

        await screen.findByRole('link', { name: /karim uddin/i });
        fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(api.updateContact).toHaveBeenCalled());
        expect(await screen.findByRole('link', { name: /karim uddin/i })).toHaveAttribute('href', '/crm/leads/lead-9');
    });
});
