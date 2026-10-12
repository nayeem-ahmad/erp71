/** Badge colours for a quotation's status, shared by the list and the detail view. */
export const quoteStatusColors: Record<string, string> = {
    DRAFT: 'bg-gray-50 text-gray-600 border-gray-200',
    SENT: 'bg-blue-50 text-blue-700 border-blue-200',
    ACCEPTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REJECTED: 'bg-red-50 text-red-700 border-red-200',
    CONVERTED: 'bg-success-light text-success-text border-emerald-200',
    REVISED: 'bg-amber-50 text-amber-700 border-amber-200',
    EXPIRED: 'bg-gray-100 text-gray-500 border-gray-200',
};

/**
 * Deliberately the same neutral/blue pair the status badges use rather than a
 * new accent: the document kind is a classification, not a state, and giving it
 * its own colour would compete with the status badge beside it.
 */
export const quoteDocKindColors: Record<string, string> = {
    QUOTE: 'bg-gray-50 text-gray-600 border-gray-200',
    PROFORMA: 'bg-blue-50 text-blue-700 border-blue-200',
};
