import { render } from '@testing-library/react';
import CrmFollowUpsRedirect from './page';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

/**
 * The follow-ups list is now the PLANNED half of /crm/activities. Kept as a
 * redirect rather than deleted, following the /sales/crm/tasks precedent — the
 * sidebar layouts tenants saved before the merge still point here.
 */
describe('CRM follow-ups page', () => {
    beforeEach(() => replace.mockClear());

    it('redirects to the merged activities page', () => {
        render(<CrmFollowUpsRedirect />);
        expect(replace).toHaveBeenCalledWith('/crm/activities');
    });
});
