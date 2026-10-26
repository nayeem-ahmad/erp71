/**
 * An amount filter on a list: "greater than 1,000", "between 500 and 2,000".
 * Sent as one query param the server reads back (`total=gt:1000`,
 * `total=between:500,2000`); between takes both ends.
 */
export type NumberConditionOp = 'between' | 'gt' | 'lt' | 'eq';

export const NUMBER_CONDITION_OPS: readonly NumberConditionOp[] = ['between', 'gt', 'lt', 'eq'];

export interface NumberCondition {
    op: NumberConditionOp;
    value: number;
    /** The upper end, for `between` only. */
    to?: number;
}

export function numberConditionParam(condition: NumberCondition | null | undefined): string | undefined {
    if (!condition) return undefined;
    if (condition.op === 'between') return `between:${condition.value},${condition.to ?? condition.value}`;
    return `${condition.op}:${condition.value}`;
}

/** "৳1,000 – ৳5,000", "> ৳1,000" — the chip text, with the caller's own number format. */
export function formatNumberCondition(condition: NumberCondition, format: (value: number) => string): string {
    if (condition.op === 'between') return `${format(condition.value)} – ${format(condition.to ?? condition.value)}`;
    const sign = { gt: '>', lt: '<', eq: '=' }[condition.op];
    return `${sign} ${format(condition.value)}`;
}
