import {
    imageKey,
    imagePlace,
    imageUrlsIn,
    unreferencedImages,
    urlsDropped,
    withoutImages,
} from './task-image-refs';

describe('task image refs', () => {
    it('treats a display width as the same image', () => {
        expect(imageKey('https://cdn/shot.png?w=420')).toBe(imageKey('https://cdn/shot.png'));
    });

    it('reads the image urls out of markdown', () => {
        expect(imageUrlsIn('See\n\n![shot.png](https://cdn/shot.png?w=420)\n\nand ![b](https://cdn/b.png)')).toEqual([
            'https://cdn/shot.png?w=420',
            'https://cdn/b.png',
        ]);
    });

    it('names the urls a rewrite stopped showing', () => {
        const before = '![shot.png](https://cdn/shot.png?w=200)\n\n![keep.png](https://cdn/keep.png)';
        const after = '![keep.png](https://cdn/keep.png?w=80)';
        expect(urlsDropped(before, after)).toEqual(['https://cdn/shot.png?w=200']);
    });

    it('takes an image out of the text and leaves the words', () => {
        expect(withoutImages('Before\n\n![shot.png](https://cdn/shot.png?w=420)\n\nAfter', new Set([imageKey('https://cdn/shot.png')]))).toBe(
            'Before\n\nAfter',
        );
        expect(withoutImages('See ![shot.png](https://cdn/shot.png) here', new Set([imageKey('https://cdn/shot.png')]))).toBe(
            'See here',
        );
    });

    it('says where a file is shown', () => {
        const description = '![shot.png](https://cdn/shot.png)';
        const comments = ['no image', '![other.png](https://cdn/other.png)'];
        expect(imagePlace('https://cdn/shot.png?w=10', description, comments)).toBe('description');
        expect(imagePlace('https://cdn/other.png', description, comments)).toBe('comment');
        expect(imagePlace('https://cdn/shot.png', description, ['![shot.png](https://cdn/shot.png)'])).toBe('both');
        expect(imagePlace('https://cdn/plain.pdf', description, comments)).toBeNull();
    });

    it('keeps a file that some text still shows', () => {
        const candidates = [
            { id: 'a1', url: 'https://cdn/gone.png' },
            { id: 'a2', url: 'https://cdn/stay.png?w=80' },
        ];
        expect(unreferencedImages(candidates, ['![stay.png](https://cdn/stay.png)'])).toEqual([
            { id: 'a1', url: 'https://cdn/gone.png' },
        ]);
    });
});
