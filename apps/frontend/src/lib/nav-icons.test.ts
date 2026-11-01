import { NAV_ICON_MAP } from './nav-icons';

describe('NAV_ICON_MAP', () => {
    it('NAV_ICON_MAP has Video', () => {
        expect(NAV_ICON_MAP).toHaveProperty('Video');
        expect(NAV_ICON_MAP.Video).toBeDefined();
    });
});
