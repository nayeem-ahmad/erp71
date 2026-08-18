import { render } from '@testing-library/react';
import CrmConversationsRedirect from './page';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

/**
 * This page used to be the cross-lead conversations list. R2 merged it into
 * /crm/activities, which shows the same rows alongside the planned work they
 * belong to, so what is left here is a redirect for old bookmarks and saved
 * sidebar layouts. The list's own coverage moved with it.
 */
describe('CRM conversations page', () => {
    beforeEach(() => replace.mockClear());

    it('redirects to the merged activities page', () => {
        render(<CrmConversationsRedirect />);
        expect(replace).toHaveBeenCalledWith('/crm/activities');
    });

    it('renders nothing of its own', () => {
        const { container } = render(<CrmConversationsRedirect />);
        expect(container).toBeEmptyDOMElement();
    });
});
