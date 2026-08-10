'use client';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CrmCampaignsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getCrmCampaigns: jest.fn(),
        getCrmCampaign: jest.fn(),
        previewCampaignRecipients: jest.fn(),
        createCrmCampaign: jest.fn(),
        updateCrmCampaign: jest.fn(),
        cancelCrmCampaign: jest.fn(),
        sendCrmCampaign: jest.fn(),
        deleteCrmCampaign: jest.fn(),
    },
}));

jest.mock('@/lib/toast', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

// DataTable drops hideOnMobile columns when the viewport reports narrow, and the
// global matchMedia mock always reports non-matching.
jest.mock('@/hooks/useMediaQuery', () => ({
    useMediaQuery: () => true,
    useIsMdUp: () => true,
}));

const uploadCampaign = {
    id: 'camp-upload',
    name: 'Eid blast',
    description: null,
    status: 'DRAFT',
    channel: 'EMAIL',
    subject: null,
    target_segment: null,
    // An UPLOAD campaign has no campaign-level body — each row carries its own.
    message: null,
    scheduled_at: null,
    sent_at: null,
    recipient_count: 2,
    delivered_count: 0,
    failed_count: 0,
    attributed_revenue: null,
    attributed_orders: null,
    created_at: '2026-08-01T04:00:00.000Z',
    creator: { name: 'Rahim', email: 'rahim@example.com' },
    recipient_source: 'UPLOAD',
    body_format: 'TEXT',
};

const segmentCampaign = {
    ...uploadCampaign,
    id: 'camp-segment',
    name: 'Winter sale',
    channel: 'SMS',
    target_segment: 'VIP',
    message: 'Winter discounts are live',
    recipient_source: 'SEGMENT',
};

/** Opens the detail modal from the list and waits for the fetched campaign. */
const openDetail = async (name: string) => {
    fireEvent.click(await screen.findByRole('button', { name }));
    // Two controls are named Close: the header's X and the footer's button.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Close' })).not.toHaveLength(0));
    const { api } = require('@/lib/api');
    await waitFor(() => expect(api.getCrmCampaign).toHaveBeenCalled());
};

describe('CrmCampaignsPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        api.getCrmCampaigns.mockResolvedValue([uploadCampaign, segmentCampaign]);
        api.getCrmCampaign.mockImplementation((id: string) =>
            Promise.resolve({
                ...(id === 'camp-upload' ? uploadCampaign : segmentCampaign),
                progress: { total: 2, sent: 0, failed: 0, pending: 2 },
                recipients: [],
            }),
        );
        api.previewCampaignRecipients.mockResolvedValue({ count: 2, sample: [] });
        api.updateCrmCampaign.mockResolvedValue({});
    });

    afterEach(() => jest.clearAllMocks());

    // M8: `message` was typed `string`, so a null body was interpolated as the
    // literal "null" and the detail modal rendered an always-empty grey panel.
    describe('an uploaded campaign has no campaign-level message', () => {
        it('never renders the string "null" in the list', async () => {
            render(<CrmCampaignsPage />);
            await screen.findByText('Eid blast');
            expect(screen.queryByText('null')).not.toBeInTheDocument();
        });

        it('is not matched by searching for "null"', async () => {
            render(<CrmCampaignsPage />);
            await screen.findByText('Eid blast');

            fireEvent.change(screen.getByPlaceholderText('Search campaigns...'), {
                target: { value: 'null' },
            });

            await waitFor(() => expect(screen.queryByText('Eid blast')).not.toBeInTheDocument());
        });

        it('omits the message panel in the detail modal', async () => {
            const { container } = render(<CrmCampaignsPage />);
            await screen.findByText('Eid blast');

            await openDetail('Eid blast');

            expect(container.querySelector('.whitespace-pre-wrap')).toBeNull();
        });

        it('still shows the panel for a campaign that does have a message', async () => {
            const { container } = render(<CrmCampaignsPage />);
            await screen.findByText('Winter sale');

            await openDetail('Winter sale');

            expect(container.querySelector('.whitespace-pre-wrap')).toHaveTextContent(
                'Winter discounts are live',
            );
        });
    });

    describe('scheduling from the detail modal', () => {
        // M9: the control rendered only for SCHEDULED, so a DRAFT could never be
        // given a schedule after it was created — even though update() allows it.
        it('offers a schedule control on a DRAFT campaign', async () => {
            render(<CrmCampaignsPage />);
            await screen.findByText('Eid blast');

            await openDetail('Eid blast');

            expect(screen.getByRole('button', { name: 'Reschedule' })).toBeInTheDocument();
        });

        it('sends the picked time as a Dhaka-stamped instant', async () => {
            const { api } = require('@/lib/api');
            render(<CrmCampaignsPage />);
            await screen.findByText('Eid blast');
            await openDetail('Eid blast');

            const picker = document.querySelector('input[type="datetime-local"]')!;
            fireEvent.change(picker, { target: { value: '2026-08-20T09:00' } });
            fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));

            await waitFor(() =>
                expect(api.updateCrmCampaign).toHaveBeenCalledWith('camp-upload', {
                    scheduled_at: '2026-08-20T09:00:00+06:00',
                }),
            );
        });

        // M10: an empty picker produced `null ?? undefined`, and an undefined key
        // is dropped from the PATCH body — so the schedule could never be cleared.
        it('sends an explicit null when the field is cleared', async () => {
            const { api } = require('@/lib/api');
            api.getCrmCampaigns.mockResolvedValue([
                { ...uploadCampaign, status: 'SCHEDULED', scheduled_at: '2026-08-20T03:00:00.000Z' },
            ]);
            api.getCrmCampaign.mockResolvedValue({
                ...uploadCampaign,
                status: 'SCHEDULED',
                scheduled_at: '2026-08-20T03:00:00.000Z',
                progress: { total: 2, sent: 0, failed: 0, pending: 2 },
                recipients: [],
            });
            render(<CrmCampaignsPage />);
            await screen.findByText('Eid blast');
            await openDetail('Eid blast');

            const picker = document.querySelector('input[type="datetime-local"]')!;
            expect(picker).toHaveValue('2026-08-20T09:00');
            fireEvent.change(picker, { target: { value: '' } });
            fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));

            await waitFor(() =>
                expect(api.updateCrmCampaign).toHaveBeenCalledWith('camp-upload', {
                    scheduled_at: null,
                }),
            );
        });
    });

    // M11: an unhandled rejection left the modal open on the stale list row.
    describe('when loading the campaign detail fails', () => {
        it('reports the failure and closes the modal instead of showing stale data', async () => {
            const { api } = require('@/lib/api');
            const { toast } = require('@/lib/toast');
            api.getCrmCampaign.mockRejectedValueOnce(new Error('Network down'));

            render(<CrmCampaignsPage />);
            await screen.findByText('Eid blast');
            fireEvent.click(screen.getByRole('button', { name: 'Eid blast' }));

            await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network down'));
            expect(screen.queryAllByRole('button', { name: 'Close' })).toHaveLength(0);
        });
    });
});
