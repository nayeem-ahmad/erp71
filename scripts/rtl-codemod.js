#!/usr/bin/env node
/**
 * Rewrites physical Tailwind utilities to their logical equivalents so the UI
 * mirrors under `dir="rtl"` without a second stylesheet.
 *
 *   ml-4        → ms-4          left-0       → start-0
 *   mr-4        → me-4          right-0      → end-0
 *   pl-4        → ps-4          text-left    → text-start
 *   pr-4        → pe-4          text-right   → text-end
 *   border-l    → border-s      rounded-l-md → rounded-s-md
 *   border-r-0  → border-e-0    float-right  → float-end
 *
 * Tailwind 3.4 ships all of these, so the LTR rendering is byte-identical —
 * `ms-4` compiles to `margin-inline-start`, which under `dir=ltr` *is*
 * `margin-left`. That is what makes this safe to apply in one sweep: the change
 * is a no-op for the seven LTR locales and the entire behaviour change for the
 * two RTL ones.
 *
 * Matching is token-based rather than substring-based: a token only rewrites
 * when the characters either side of it are class-list separators (quote,
 * space, backtick, brace, `$`), so `mr-2` inside a className rewrites while a
 * property named `right` or a URL containing `pl-4` does not. Variant prefixes
 * (`md:`, `hover:`, `group-hover:`, `dark:`, `peer-focus:` …) and a leading `-`
 * for negative margins are carried through.
 *
 * Usage:
 *   node scripts/rtl-codemod.js --check      report only, exit 1 if any remain
 *   node scripts/rtl-codemod.js --write      apply
 *   node scripts/rtl-codemod.js --write path/to/file.tsx  apply to one file
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', 'apps', 'frontend', 'src');

/**
 * Utilities whose physical form has an exact logical counterpart.
 * Order matters: longer prefixes first so `rounded-l` is not eaten by a
 * hypothetical shorter rule.
 */
const PREFIX_MAP = [
    ['rounded-l', 'rounded-s'],
    ['rounded-r', 'rounded-e'],
    ['border-l', 'border-s'],
    ['border-r', 'border-e'],
    ['scroll-ml', 'scroll-ms'],
    ['scroll-mr', 'scroll-me'],
    ['scroll-pl', 'scroll-ps'],
    ['scroll-pr', 'scroll-pe'],
    ['ml', 'ms'],
    ['mr', 'me'],
    ['pl', 'ps'],
    ['pr', 'pe'],
    ['left', 'start'],
    ['right', 'end'],
];

/** Utilities with no numeric suffix — matched whole. */
const EXACT_MAP = new Map([
    ['text-left', 'text-start'],
    ['text-right', 'text-end'],
    ['float-left', 'float-start'],
    ['float-right', 'float-end'],
    ['clear-left', 'clear-start'],
    ['clear-right', 'clear-end'],
    ['rounded-l', 'rounded-s'],
    ['rounded-r', 'rounded-e'],
    ['border-l', 'border-s'],
    ['border-r', 'border-e'],
]);

/**
 * `rounded-lg` / `rounded-l` collide on prefix, as do `border-l` and any future
 * `border-lime`. Only these suffixes are real side-scale values; anything else
 * after `rounded-l` / `border-l` means it was a different utility.
 */
const SIDE_SUFFIX = /^(none|sm|md|lg|xl|2xl|3xl|full|0|2|4|8)$/;

const VARIANT = '(?:[a-z0-9-]+:)*';
const SEP_BEFORE = '(^|[\\s"\'`{(\\[$])';
const SEP_AFTER = '(?=$|[\\s"\'`})\\]])';

function buildPatterns() {
    const patterns = [];

    for (const [from, to] of EXACT_MAP) {
        patterns.push({
            re: new RegExp(`${SEP_BEFORE}(-?)(${VARIANT})${from}${SEP_AFTER}`, 'g'),
            replace: (_m, pre, neg, variant) => `${pre}${neg}${variant}${to}`,
        });
    }

    for (const [from, to] of PREFIX_MAP) {
        patterns.push({
            re: new RegExp(
                `${SEP_BEFORE}(-?)(${VARIANT})${from}-([a-z0-9.]+|\\[[^\\]\\s]+\\])${SEP_AFTER}`,
                'g',
            ),
            replace: (m, pre, neg, variant, value) => {
                // `rounded-lg` reaches the `rounded-l` rule as value `g`.
                if ((from === 'rounded-l' || from === 'rounded-r' ||
                     from === 'border-l' || from === 'border-r') &&
                    !SIDE_SUFFIX.test(value)) {
                    return m;
                }
                return `${pre}${neg}${variant}${to}-${value}`;
            },
        });
    }

    return patterns;
}

const PATTERNS = buildPatterns();

/**
 * `space-x-*` is physical in Tailwind 3: it puts `margin-left` on every child
 * but the first. Under RTL the visual order reverses but the margin does not,
 * so the gap lands on the outside of the last item and the first two items sit
 * flush. Tailwind's own fix is the `space-x-reverse` companion, which flips the
 * margin to the other side; pairing it with the `rtl:` variant makes it a no-op
 * in LTR.
 *
 * Idempotent: a `space-x-*` that already has the companion is left alone, so
 * the `--check` guard stays stable.
 */
const SPACE_X = new RegExp(
    `${SEP_BEFORE}((?:[a-z0-9-]+:)*)(space-x-[0-9.]+|space-x-px)${SEP_AFTER}`,
    'g',
);

function addSpaceXReverse(source) {
    return source.replace(SPACE_X, (match, pre, variant, util, offset, whole) => {
        // Already paired somewhere in the same class list? Leave it.
        const windowText = whole.slice(offset, offset + match.length + 220);
        if (windowText.includes('rtl:space-x-reverse')) return match;
        return `${pre}${variant}${util} rtl:space-x-reverse`;
    });
}

/**
 * Files where a physical direction is the intent, not an oversight.
 * Each needs a stated reason — an unexplained entry here is how an RTL bug
 * hides forever.
 */
const EXCLUDE = [
    // Print output for thermal receipt printers is physically LTR: the roll
    // feeds one way and the ESC/POS column maths assumes left-origin.
    'components/print/ReceiptPrint',
];

function shouldSkip(file) {
    return EXCLUDE.some((fragment) => file.includes(fragment));
}

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(tsx|ts|jsx|js|css)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function transform(source) {
    let out = source;
    for (const { re, replace } of PATTERNS) {
        out = out.replace(re, replace);
    }
    return addSpaceXReverse(out);
}

function main() {
    const args = process.argv.slice(2);
    const write = args.includes('--write');
    const explicit = args.filter((a) => !a.startsWith('--'));
    const files = explicit.length ? explicit.map((f) => path.resolve(f)) : walk(ROOT);

    let touched = 0;
    let totalHits = 0;

    for (const file of files) {
        if (shouldSkip(file)) continue;

        const source = fs.readFileSync(file, 'utf8');
        const next = transform(source);
        if (next === source) continue;

        const hits = source.split('\n').filter((line, i) => line !== next.split('\n')[i]).length;
        touched += 1;
        totalHits += hits;

        if (write) fs.writeFileSync(file, next);
        else console.log(`${path.relative(ROOT, file)}  (${hits} line(s))`);
    }

    console.log(
        `${write ? 'rewrote' : 'would rewrite'} ${totalHits} line(s) across ${touched} file(s)`,
    );

    if (!write && touched > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { transform, walk, shouldSkip, ROOT };
