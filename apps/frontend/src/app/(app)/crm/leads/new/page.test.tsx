'use client';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewLeadPage from './page';

jest.mock('next/link', () => {
    const MockLink = ({ children, href }: any) => <a href={href}>{children}</a>;
    MockLink.displayName = 'Link';
    return MockLink;
});

const push = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: (...args: unknown[]) => push(...args) }),
}));

jest.mock('@/lib/api', () => ({
    api: {
        getMe: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Nayeem' }),
        getTeamMembers: jest.fn().mockResolvedValue([
            { userId: 'user-1', name: 'Nayeem' },
            { userId: 'user-2', name: 'Rifat' },
        ]),
        getCustomFields: jest.fn().mockResolvedValue([]),
        getLeadTaxonomy: jest.fn().mockResolvedValue([]),
        createLead: jest.fn(),
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
