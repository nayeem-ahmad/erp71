import { clearSidebarLayoutState } from './auth-session';
import { getWorkspaceItem, setWorkspaceItem } from './session-store';

describe('clearSidebarLayoutState', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('removes the persisted sidebar layout keys from localStorage', () => {
        localStorage.setItem('sidebar-open-groups', '{"accounting":true}');
        localStorage.setItem('sidebar-collapsed', 'true');
        localStorage.setItem('sidebar-width', '320');

        clearSidebarLayoutState();

        expect(localStorage.getItem('sidebar-open-groups')).toBeNull();
        expect(localStorage.getItem('sidebar-collapsed')).toBeNull();
        expect(localStorage.getItem('sidebar-width')).toBeNull();
    });

    it('clears sidebar keys from sessionStorage too', () => {
        sessionStorage.setItem('sidebar-width', '320');

        clearSidebarLayoutState();

        expect(sessionStorage.getItem('sidebar-width')).toBeNull();
    });

    it('leaves unrelated keys untouched', () => {
        setWorkspaceItem('tenant_id', 'abc');

        clearSidebarLayoutState();

        expect(getWorkspaceItem('tenant_id')).toBe('abc');
    });
});
