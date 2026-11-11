/**
 * Remaining-hours heat against the busiest cell in the current matrix,
 * not against a guessed capacity. Classes are written out so the scale
 * stays in the one blue family.
 */
export function staffingHeatClass(hours: number, maxHours: number): string {
    if (hours <= 0 || maxHours <= 0) return 'bg-blue-50 text-gray-700';
    const index = Math.min(4, Math.floor((hours / maxHours) * 5));
    const scale = [
        'bg-blue-50 text-gray-700',
        'bg-blue-100 text-gray-800',
        'bg-blue-200 text-gray-900',
        'bg-blue-400 text-white',
        'bg-blue-600 text-white',
    ];
    return scale[index];
}
