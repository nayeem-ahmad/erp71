import { BlogStatus, canTransition, isInAppAudience, isPublicAudience } from './blog-status';

describe('canTransition', () => {
    it('allows the ordinary path from draft to live', () => {
        expect(canTransition(BlogStatus.DRAFT, BlogStatus.PUBLISHED)).toBe(true);
        expect(canTransition(BlogStatus.DRAFT, BlogStatus.SCHEDULED)).toBe(true);
        expect(canTransition(BlogStatus.SCHEDULED, BlogStatus.PUBLISHED)).toBe(true);
    });

    it('lets a live post be taken down', () => {
        expect(canTransition(BlogStatus.PUBLISHED, BlogStatus.DRAFT)).toBe(true);
        expect(canTransition(BlogStatus.PUBLISHED, BlogStatus.ARCHIVED)).toBe(true);
    });

    it('makes an archived post go back through draft rather than straight live', () => {
        expect(canTransition(BlogStatus.ARCHIVED, BlogStatus.PUBLISHED)).toBe(false);
        expect(canTransition(BlogStatus.ARCHIVED, BlogStatus.SCHEDULED)).toBe(false);
        expect(canTransition(BlogStatus.ARCHIVED, BlogStatus.DRAFT)).toBe(true);
    });

    it('treats a no-op as allowed so a save that does not move status is not rejected', () => {
        expect(canTransition(BlogStatus.PUBLISHED, BlogStatus.PUBLISHED)).toBe(true);
    });

    it('rejects an unknown source status rather than defaulting to permissive', () => {
        expect(canTransition('NONSENSE', BlogStatus.PUBLISHED)).toBe(false);
    });
});

describe('audience predicates', () => {
    it('sends BOTH to each surface and each other audience to only its own', () => {
        expect(isPublicAudience('PUBLIC')).toBe(true);
        expect(isPublicAudience('BOTH')).toBe(true);
        expect(isPublicAudience('IN_APP')).toBe(false);

        expect(isInAppAudience('IN_APP')).toBe(true);
        expect(isInAppAudience('BOTH')).toBe(true);
        expect(isInAppAudience('PUBLIC')).toBe(false);
    });

    it('does not admit an unrecognised audience to either surface', () => {
        expect(isPublicAudience('EVERYONE')).toBe(false);
        expect(isInAppAudience('EVERYONE')).toBe(false);
    });
});
