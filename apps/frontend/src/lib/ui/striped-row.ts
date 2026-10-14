/**
 * Alternating row fill plus a hover wash, for a list the reader scans by row.
 *
 * `hover` is ordered after `even` in Tailwind's variant list, so the wash
 * replaces the stripe while the pointer is on the row and the stripe returns
 * when it leaves. Kept as one string so the activities table and the agenda
 * list cannot drift apart.
 */
export const stripedRowClass =
    'odd:bg-white even:bg-gray-50 hover:bg-blue-50 transition-colors';
