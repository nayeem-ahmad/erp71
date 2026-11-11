/**
 * Grammarly (and similar grammar extensions) draw their suggestion card
 * outside the field they are correcting. A click on that card blurs the
 * editor with either the host as relatedTarget, or — when the card lives
 * in a closed shadow root — no related target at all.
 *
 * The host is a custom element whose tag starts with `grammarly`. Walking
 * parent nodes and shadow hosts is how a click inside an open shadow root
 * still names it.
 */
export function isSpellcheckOverlay(node: EventTarget | null | undefined): boolean {
    let current: Node | null = node instanceof Node ? node : null;
    while (current) {
        if (current instanceof Element) {
            if (current.tagName.toLowerCase().startsWith('grammarly')) return true;
            if (current.hasAttribute('data-spellcheck-overlay')) return true;
        }
        const parent = current.parentNode;
        if (parent) {
            current = parent;
            continue;
        }
        const root = current.getRootNode();
        current = root instanceof ShadowRoot ? root.host : null;
    }
    return false;
}

/** Pointerdown on a Grammarly card, including one inside a closed shadow root. */
export function eventTouchesSpellcheckOverlay(event: Event): boolean {
    if (isSpellcheckOverlay(event.target)) return true;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.some((node) => isSpellcheckOverlay(node));
}
