import { BadRequestException } from '@nestjs/common';

/**
 * A list filter on an amount: "greater than 1,000", "between 500 and 2,000".
 *
 * Sent as one query param, `<op>:<value>` or `between:<from>,<to>` —
 * `total=gt:1000`, `paid=between:500,2000`. Between takes both ends.
 */
export type NumberConditionOp = 'gt' | 'lt' | 'eq' | 'between';

export interface NumberCondition {
    op: NumberConditionOp;
    value: number;
    /** The upper end, for `between` only. */
    to?: number;
}

const OPS: readonly NumberConditionOp[] = ['gt', 'lt', 'eq', 'between'];

function parseAmount(text: string): number | null {
    const cleaned = text.trim();
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    return Number(cleaned);
}

/**
 * Reads the param; `undefined` when it is absent or blank. A malformed one is a
 * 400 rather than no filter — a list quietly showing every sale when asked for
 * the big ones reads as an answer.
 */
export function readNumberConditionQuery(raw: unknown, name: string): NumberCondition | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const invalid = () => new BadRequestException(`${name} must look like gt:100, lt:100, eq:100 or between:100,500`);
    if (typeof raw !== 'string') throw invalid();
    const separator = raw.indexOf(':');
    if (separator === -1) throw invalid();
    const op = raw.slice(0, separator) as NumberConditionOp;
    if (!OPS.includes(op)) throw invalid();
    const operands = raw.slice(separator + 1).split(',');
    if (op === 'between') {
        if (operands.length !== 2) throw invalid();
        const [a, b] = operands.map(parseAmount);
        if (a === null || b === null) throw invalid();
        // Typed the wrong way round still means the span between them.
        return { op, value: Math.min(a, b), to: Math.max(a, b) };
    }
    if (operands.length !== 1) throw invalid();
    const value = parseAmount(operands[0]);
    if (value === null) throw invalid();
    return { op, value };
}

/** The Prisma filter for one numeric column. */
export function numberConditionFilter(condition: NumberCondition) {
    switch (condition.op) {
        case 'gt':
            return { gt: condition.value };
        case 'lt':
            return { lt: condition.value };
        case 'eq':
            return { equals: condition.value };
        case 'between':
            return { gte: condition.value, lte: condition.to ?? condition.value };
    }
}

/** A comma-separated id list, blanks dropped; `undefined` when nothing is left. */
export function readIdListQuery(raw: unknown): string[] | undefined {
    if (typeof raw !== 'string') return undefined;
    const ids = raw.split(',').map((value) => value.trim()).filter(Boolean);
    return ids.length ? ids : undefined;
}
