'use client';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewLeadPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
let searchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: (...args: unknown[]) => push(...args) }),
    useSearchParams: () => searchParams,
}));

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Nayeem' }),
        getCrmAssignees: jest.fn().mockResolvedValue([
            { userId: 'user-1', name: 'Nayeem' },
            { userId: 'user-2', name: 'Rifat' },
        ]),
        getCustomFields: jest.fn().mockResolvedValue([]),
        getLeadTaxonomy: jest.fn().mockResolvedValue([]),
        createLead: jest.fn(),
        getContact: jest.fn(),
    },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/lib/api');

function fieldControl(label: string): HTMLElement {
    const labelEl = screen.getByText((_, el) => (
        el?.tagName === 'LABEL' && (el.textContent ?? '').trim().startsWith(label)
    ));
    const control = labelEl.parentElement?.querySelector('input, select, textarea');
    if (!control) throw new Error(`No control under label "${label}"`);
    return control as HTMLElement;
}

describe('NewLeadPage — initial status', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.createLead.mockResolvedValue({ id: 'lead-1' });
    });

    it('shows Status, defaulting to New, and sends the chosen value on create', async () => {
        render(<NewLeadPage />);

        const status = fieldControl('Status') as HTMLSelectElement;
        expect(status.value).toBe('NEW');

        fireEvent.change(fieldControl('Name'), { target: { value: 'Karim Traders' } });
        fireEvent.change(status, { target: { value: 'CONTACTED' } });
        fireEvent.click(screen.getByRole('button', { name: /new lead/i }));

        await waitFor(() => expect(api.createLead).toHaveBeenCalled());
        expect(api.createLead).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Karim Traders', status: 'CONTACTED' }),
        );
        expect(push).toHaveBeenCalledWith('/crm/leads/lead-1');
    });

    it('asks for a lost reason when the initial status is Lost', async () => {
        render(<NewLeadPage />);

        fireEvent.change(fieldControl('Status'), { target: { value: 'LOST' } });
        expect(fieldControl('Lost Reason')).toBeInTheDocument();

        fireEvent.change(fieldControl('Name'), { target: { value: 'Karim Traders' } });
        fireEvent.click(screen.getByRole('button', { name: /new lead/i }));

        expect(await screen.findByText('Please provide a reason for marking this lead as lost.')).toBeInTheDocument();
        expect(api.createLead).not.toHaveBeenCalled();
    });
});

describe('NewLeadPage — lead owner', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        api.createLead.mockResolvedValue({ id: 'lead-1' });
    });

    it('files the lead against the current user by default', async () => {
        render(<NewLeadPage />);

        await waitFor(() => expect((fieldControl('Lead Owner') as HTMLSelectElement).value).toBe('user-1'));

        fireEvent.change(fieldControl('Name'), { target: { value: 'Karim Traders' } });
        fireEvent.click(screen.getByRole('button', { name: /new lead/i }));

        await waitFor(() => expect(api.createLead).toHaveBeenCalled());
        expect(api.createLead).toHaveBeenCalledWith(expect.objectContaining({ assigned_to: 'user-1' }));
    });

    // Was 'points the opening next step at the new owner too', asserting that
    // moving Lead Owner dragged the next-step Assigned To select with it. That
    // select is gone — `showNextStep` defaults to false — so the assertion had
    // nothing to read. `setLeadOwner` still does the dragging and is still
    // covered, as a pure function, in lead-form-fields.test.ts.
    it('collects no next step: the form has no such section any more', async () => {
        render(<NewLeadPage />);

        await waitFor(() => expect((fieldControl('Lead Owner') as HTMLSelectElement).value).toBe('user-1'));

        expect(screen.queryByText('Next Step')).toBeNull();
        expect(screen.queryByText('Next Step Date')).toBeNull();
        expect(() => fieldControl('Assigned To')).toThrow();
    });

    it('sends no next-step key, not even the assignee the owner seeds', async () => {
        render(<NewLeadPage />);

        await waitFor(() => expect((fieldControl('Lead Owner') as HTMLSelectElement).value).toBe('user-1'));
        fireEvent.change(fieldControl('Name'), { target: { value: 'Karim Traders' } });
        fireEvent.click(screen.getByRole('button', { name: /new lead/i }));

        await waitFor(() => expect(api.createLead).toHaveBeenCalled());
        const payload = api.createLead.mock.calls[0][0];
        expect(payload).not.toHaveProperty('next_step');
        expect(payload).not.toHaveProperty('next_step_date');
        expect(payload).not.toHaveProperty('next_step_assigned_to');
    });

    it('sends the address the form collects', async () => {
        render(<NewLeadPage />);

        fireEvent.change(fieldControl('Name'), { target: { value: 'Karim Traders' } });
        fireEvent.change(fieldControl('Address'), { target: { value: '12 Gulshan Ave, Dhaka' } });
        fireEvent.click(screen.getByRole('button', { name: /new lead/i }));

        await waitFor(() => expect(api.createLead).toHaveBeenCalled());
        expect(api.createLead).toHaveBeenCalledWith(
            expect.objectContaining({ address: '12 Gulshan Ave, Dhaka' }),
        );
    });
});

describe('NewLeadPage — converting a contact', () => {
    const contact = {
        id: 'contact-7',
        name: 'Karim Uddin',
        company: 'Karim Traders',
        mobile: '01712-345678',
        phone: null,
        email: 'karim@shop.com',
        address: 'Mirpur, Dhaka',
        linkedin_url: null,
        website_url: null,
        assigned_to: 'user-2',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        searchParams = new URLSearchParams('contactId=contact-7');
        api.createLead.mockResolvedValue({ id: 'lead-1' });
    });

    afterEach(() => {
        searchParams = new URLSearchParams();
    });

    it('starts from the contact and links the new lead to it', async () => {
        api.getContact.mockResolvedValue(contact);
        render(<NewLeadPage />);

        await waitFor(() => expect((fieldControl('Name') as HTMLInputElement).value).toBe('Karim Uddin'));
        expect(api.getContact).toHaveBeenCalledWith('contact-7');
        expect((fieldControl('Mobile') as HTMLInputElement).value).toBe('01712-345678');
        expect((fieldControl('Email') as HTMLInputElement).value).toBe('karim@shop.com');
        expect((fieldControl('Lead Owner') as HTMLSelectElement).value).toBe('user-2');
        expect(screen.getByText(/will be linked to contact/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Karim Uddin' })).toHaveAttribute('href', '/crm/contacts/contact-7');

        fireEvent.click(screen.getByRole('button', { name: /new lead/i }));

        await waitFor(() => expect(api.createLead).toHaveBeenCalled());
        expect(api.createLead).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Karim Uddin',
            mobile: '01712-345678',
            email: 'karim@shop.com',
            address: 'Mirpur, Dhaka',
            assigned_to: 'user-2',
            contact_id: 'contact-7',
        }));
    });

    it('falls back to a blank form, unlinked, when the contact cannot be loaded', async () => {
        api.getContact.mockRejectedValue(new Error('Contact not found'));
        render(<NewLeadPage />);

        expect(await screen.findByText(/could not load that contact/i)).toBeInTheDocument();

        fireEvent.change(fieldControl('Name'), { target: { value: 'Karim Traders' } });
        fireEvent.click(screen.getByRole('button', { name: /new lead/i }));

        await waitFor(() => expect(api.createLead).toHaveBeenCalled());
        expect(api.createLead.mock.calls[0][0]).not.toHaveProperty('contact_id');
    });
});
