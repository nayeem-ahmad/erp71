import { storefrontMetadata, type StorefrontMeta } from './storefront-meta';

function meta(overrides: Partial<StorefrontMeta> = {}): StorefrontMeta {
    return {
        name: 'Karim Hardware',
        slug: 'karim-hardware',
        storefront_hero_image: 'https://cdn.example/hero.jpg',
        storefront_hero_headline: 'Tools that outlast the job',
        storefront_logo: 'https://cdn.example/logo.png',
        brand_primary_color: '#1d4ed8',
        ...overrides,
    };
}

describe('storefrontMetadata', () => {
    it('titles the home page with the shop name alone', () => {
        const result = storefrontMetadata(meta(), { description: 'fallback' });

        expect(result.title).toBe('Karim Hardware');
        expect(result.openGraph?.title).toBe('Karim Hardware');
    });

    it('suffixes a sub-page', () => {
        const result = storefrontMetadata(meta(), { suffix: 'Shop', description: 'fallback' });

        expect(result.title).toBe('Karim Hardware — Shop');
    });

    it("prefers the shop's own headline over a composed description", () => {
        const result = storefrontMetadata(meta(), { description: 'Shop online with Karim Hardware.' });

        expect(result.description).toBe('Tools that outlast the job');
    });

    it.each([null, '', '   '])('falls back to the composed description when the headline is %p', (headline) => {
        const result = storefrontMetadata(meta({ storefront_hero_headline: headline }), {
            description: 'Shop online with Karim Hardware.',
        });

        expect(result.description).toBe('Shop online with Karim Hardware.');
    });

    it('uses the hero image as the OG card', () => {
        const result = storefrontMetadata(meta(), { description: 'fallback' });

        expect(result.openGraph?.images).toEqual([{ url: 'https://cdn.example/hero.jpg' }]);
    });

    it('falls back to the logo when the shop has uploaded no hero', () => {
        const result = storefrontMetadata(meta({ storefront_hero_image: null }), { description: 'fallback' });

        expect(result.openGraph?.images).toEqual([{ url: 'https://cdn.example/logo.png' }]);
    });

    it('omits the image entirely rather than emitting an empty one', () => {
        const result = storefrontMetadata(
            meta({ storefront_hero_image: null, storefront_logo: null }),
            { description: 'fallback' },
        );

        expect(result.openGraph).not.toHaveProperty('images');
    });

    // A wrong slug, or a storefront switched off: the page renders its own "not
    // available" state, and a crawler that got here should not bank the URL.
    it('noindexes a shop that could not be resolved', () => {
        const result = storefrontMetadata(null, { description: 'fallback' });

        expect(result.title).toBe('Shop not available');
        expect(result.robots).toEqual({ index: false, follow: false });
    });
});
