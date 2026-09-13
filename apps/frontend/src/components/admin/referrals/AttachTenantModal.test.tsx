'use client';

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AttachTenantModal from './AttachTenantModal';

const getAdminAttachableTenants = jest.fn();
const attachAdminRefereeTenant = jest.fn();

jest.mock('@/lib/api', () => ({
    api: {
        getAdminAttachableTenants: (...args: unknown[]) => getAdminAttachableTenants(...args),
        attachAdminRefereeTenant: (...args: unknown[]) => attachAdminRefereeTenant(...args),
    },
}));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../../lib/localization/messages/en');
    const fill = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce(
            (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
            template,
        );
    return {
        useI18n: () => ({ t: enMessages, fmt: fill }),
        formatMessage: fill,
    };
});

// ModalShell and the form pull in their own icons, so stub the whole module
// rather than naming each one.
jest.mock('lucide-react', () => new Proxy({}, {
    get: () => () => <span data-testid="icon" />,
}));

const tenant = (overrides: Record<string, unknown> = {}) => ({
    id: 'tenant-1',
    name: 'Karim Store',
    created_at: '2026-03-02T00:00:00.000Z',
    owner_name: 'Karim',
    owner_email: 'karim@example.com',
    plan_code: 'PRO',
    plan_name: 'Pro',
    subscription_status: 'ACTIVE',
    billing_cycle: 'MONTHLY',
    attached_to: null,
    ...overrides,
});

/**
 * This form is the only way a business that never typed a referral code gets
 * credited to a partner, so the cases below pin the two things that would pay the
 * wrong person: a business somebody else already holds must not be selectable, and
 * the rates the admin actually sees must be the rates that get sent.
 */
describe('AttachTenantModal', () => {
    const onClose = jest.fn();
    const onSuccess = jest.fn();

    const renderModal = () =>
        render(
            <AttachTenantModal
                open
                refereeId="referee-1"
                refereeName="Rahman Traders"
                defaultDiscountPct={5}
                defaultCommissionPct={10}
                onClose={onClose}
                onSuccess={onSuccess}
            />,
        );

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        getAdminAttachableTenants.mockResolvedValue([tenant()]);
        attachAdminRefereeTenant.mockResolvedValue({ id: 'commission-1' });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /** The picker is debounced, so nothing is on screen until the timer fires. */
    const settleSearch = async () => {
        await waitFor(() => {
            jest.advanceTimersByTime(400);
            expect(getAdminAttachableTenants).toHaveBeenCalled();
        });
    };

    it("sends the partner's current terms when the admin leaves them alone", async () => {
        renderModal();
        await settleSearch();

        fireEvent.click(await screen.findByText('Karim Store'));
        fireEvent.click(screen.getByRole('button', { name: /^attach$/i }));

        await waitFor(() => expect(attachAdminRefereeTenant).toHaveBeenCalled());
        expect(attachAdminRefereeTenant).toHaveBeenCalledWith('referee-1', {
            tenant_id: 'tenant-1',
            discount_pct: 5,
            commission_pct: 10,
        });
    });

    it('sends a zeroed discount for a business that already paid list price', async () => {
        renderModal();
        await settleSearch();

        fireEvent.click(await screen.findByText('Karim Store'));
        fireEvent.change(screen.getByLabelText(/signup discount/i), { target: { value: '0' } });
        fireEvent.click(screen.getByRole('button', { name: /^attach$/i }));

        await waitFor(() => expect(attachAdminRefereeTenant).toHaveBeenCalled());
        expect(attachAdminRefereeTenant).toHaveBeenCalledWith(
            'referee-1',
            expect.objectContaining({ discount_pct: 0, commission_pct: 10 }),
        );
    });

    it('shows who holds an already-credited business and refuses to select it', async () => {
        getAdminAttachableTenants.mockResolvedValue([
            tenant({
                attached_to: {
                    signup_id: 'commission-9',
                    status: 'EARNED',
                    referee_id: 'referee-2',
                    referee_name: 'Other Partner',
                    referral_code: 'OTHR1234',
                },
            }),
        ]);
        renderModal();
        await settleSearch();

        expect(await screen.findByText(/already credited to other partner/i)).toBeInTheDocument();
        const row = screen.getByText('Karim Store').closest('button');
        expect(row).toBeDisabled();
        expect(screen.getByRole('button', { name: /^attach$/i })).toBeDisabled();
    });

    it('surfaces the conflict the server reports rather than closing', async () => {
        attachAdminRefereeTenant.mockRejectedValue(
            new Error('Karim Store is already attached to Other Partner. Detach that first.'),
        );
        renderModal();
        await settleSearch();

        fireEvent.click(await screen.findByText('Karim Store'));
        fireEvent.click(screen.getByRole('button', { name: /^attach$/i }));

        expect(await screen.findByText(/already attached to other partner/i)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('reports the attachment back with both names once it lands', async () => {
        renderModal();
        await settleSearch();

        fireEvent.click(await screen.findByText('Karim Store'));
        fireEvent.click(screen.getByRole('button', { name: /^attach$/i }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalled());
        expect(onSuccess).toHaveBeenCalledWith('Karim Store attached to Rahman Traders');
        expect(onClose).toHaveBeenCalled();
    });
});
