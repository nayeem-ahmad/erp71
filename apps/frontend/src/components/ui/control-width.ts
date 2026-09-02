/**
 * The form primitives default to `w-full`, which is right for the stacked
 * `Field` layout they were built for but wrong inside a flex row, where a
 * caller wants a fixed `w-24`. Tailwind emits `.w-full` *after* the numeric
 * widths, so on a specificity tie the base class wins and the caller's width is
 * silently ignored — the control expands to the whole row and squeezes whatever
 * shares it down to nothing.
 *
 * So the default is applied only when the caller has not brought a width of
 * their own. A *responsive* override (`md:w-44`) is left alone deliberately: it
 * lives in a media query that already outranks the base rule, and those callers
 * mean "full width on mobile, 11rem from `md` up".
 */
const HAS_UNPREFIXED_WIDTH = /(?:^|\s)!?w-\S/;

export function controlWidthClass(className: string): string {
    return HAS_UNPREFIXED_WIDTH.test(className) ? '' : 'w-full';
}
