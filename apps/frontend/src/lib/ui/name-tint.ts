/**
 * A stable colour per name for the COLORFUL style: the same product, category
 * or customer always lands on the same hue, so people learn it by colour.
 */

const SOFT = [
    'bg-violet-100 text-violet-700', 'bg-emerald-100 text-emerald-700', 'bg-orange-100 text-orange-700',
    'bg-sky-100 text-sky-700', 'bg-pink-100 text-pink-700', 'bg-amber-100 text-amber-800', 'bg-teal-100 text-teal-700',
];

const GRADIENT = [
    'from-violet-500 to-indigo-600', 'from-emerald-500 to-teal-600', 'from-orange-400 to-red-500',
    'from-sky-500 to-blue-600', 'from-pink-500 to-rose-600', 'from-amber-400 to-orange-500',
    'from-cyan-500 to-sky-600', 'from-lime-500 to-emerald-600',
];

function hash(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return h;
}

/** Light background and dark text, for a monogram on a white row. */
export function softTint(key: string): string {
    return SOFT[hash(key) % SOFT.length];
}

/** Gradient stops for `bg-gradient-to-br`, for a monogram tile with white text. */
export function gradientTint(key: string): string {
    return GRADIENT[hash(key) % GRADIENT.length];
}
