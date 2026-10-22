import { urlWithWidth } from '@/components/ui/image-width';

/**
 * Where a file shows up besides the Attachments tab.
 *
 * A pasted image is an attachment that the description or a comment also
 * shows. The tab is the inventory; the text is one more place the same file
 * is drawn. These say which, so removing the file can take it out of the
 * text, and removing it from the text can take it out of the inventory.
 */
export type ImagePlace = 'description' | 'comment' | 'both';

/** An image this editor uploaded and is still responsible for. */
export type UploadedImage = { id: string; url: string };

/**
 * The identity of an image url, ignoring the `?w=` this app uses for display
 * width. The attachment row stores the bare url; the markdown may carry `?w=`.
 */
export function imageKey(url: string): string {
    const bare = urlWithWidth(url, null);
    const hash = bare.indexOf('#');
    return hash === -1 ? bare : bare.slice(0, hash);
}

/** Every image url in a markdown string, in the order they are written. */
export function imageUrlsIn(markdown: string): string[] {
    const urls: string[] = [];
    const pattern = /!\[[^\]]*\]\(([^)\s]+)\)/g;
    let match = pattern.exec(markdown);
    while (match) {
        urls.push(match[1]);
        match = pattern.exec(markdown);
    }
    return urls;
}

/** Image urls that `before` showed and `after` does not. */
export function urlsDropped(before: string, after: string): string[] {
    const kept = new Set(imageUrlsIn(after).map(imageKey));
    const dropped: string[] = [];
    const seen = new Set<string>();
    for (const url of imageUrlsIn(before)) {
        const key = imageKey(url);
        if (kept.has(key) || seen.has(key)) continue;
        seen.add(key);
        dropped.push(url);
    }
    return dropped;
}

/**
 * The markdown with those images taken out.
 *
 * An image pasted into the editor sits on a line of its own, so removing it
 * leaves a blank line. That blank line is collapsed; the words around an
 * image that shared a line keep a single space.
 */
export function withoutImages(markdown: string, keys: Set<string>): string {
    if (keys.size === 0) return markdown;
    const stripped = markdown.replace(/!\[[^\]]*\]\(([^)\s]+)\)/g, (whole, url: string) =>
        keys.has(imageKey(url)) ? '' : whole,
    );
    return stripped
        .replace(/[^\S\n]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Where this file is drawn, from the description and the comment bodies. */
export function imagePlace(
    url: string,
    description: string,
    commentBodies: string[],
): ImagePlace | null {
    const key = imageKey(url);
    const inDescription = imageUrlsIn(description).some((item) => imageKey(item) === key);
    const inComment = commentBodies.some((body) =>
        imageUrlsIn(body).some((item) => imageKey(item) === key),
    );
    if (inDescription && inComment) return 'both';
    if (inDescription) return 'description';
    if (inComment) return 'comment';
    return null;
}

/**
 * The candidates nobody still shows.
 *
 * A file added from the Attachments tab is not a candidate: it was never in
 * the text, so it is not in this list, and it stays until someone removes it
 * there. Deduped by url, first occurrence kept.
 */
export function unreferencedImages<T extends { url: string }>(
    candidates: T[],
    referencedMarkdown: string[],
): T[] {
    const referenced = new Set<string>();
    for (const markdown of referencedMarkdown) {
        for (const url of imageUrlsIn(markdown)) referenced.add(imageKey(url));
    }
    const seen = new Set<string>();
    const doomed: T[] = [];
    for (const candidate of candidates) {
        const key = imageKey(candidate.url);
        if (referenced.has(key) || seen.has(key)) continue;
        seen.add(key);
        doomed.push(candidate);
    }
    return doomed;
}
