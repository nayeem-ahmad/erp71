/** Chip colours a lead's priority and score are shown in, on the list and the board alike. */
export const LEAD_PRIORITY_COLORS: Record<string, string> = {
    LOW: 'bg-gray-50 text-gray-600',
    MEDIUM: 'bg-blue-50 text-blue-700',
    HIGH: 'bg-amber-50 text-amber-700',
    URGENT: 'bg-danger-light text-danger-text',
};

export function leadPriorityColor(priority: string): string {
    return LEAD_PRIORITY_COLORS[priority] ?? 'bg-gray-100 text-gray-700';
}

export function leadScoreColor(score: number): string {
    if (score >= 70) return 'bg-emerald-50 text-emerald-700';
    if (score >= 40) return 'bg-amber-50 text-amber-700';
    return 'bg-gray-100 text-gray-600';
}
