import { round2 } from './money';

export type TapeOp = '+' | '-' | '×' | '÷';

export interface TapeLine {
    id: string;
    op: TapeOp;
    value: number;
    label: string;
}

/**
 * The running total of a tape, the way an adding machine works: each line
 * applies to the total so far, left to right — no operator precedence, which
 * is what a shopkeeper adding up a bill expects. Dividing by zero leaves the
 * total unchanged rather than turning it into Infinity.
 */
export function runTape(lines: TapeLine[]): { totals: number[]; total: number } {
    let total = 0;
    const totals: number[] = [];
    lines.forEach((line, index) => {
        if (index === 0 && (line.op === '×' || line.op === '÷')) total = line.value;
        else if (line.op === '+') total += line.value;
        else if (line.op === '-') total -= line.value;
        else if (line.op === '×') total *= line.value;
        else if (line.op === '÷' && line.value !== 0) total /= line.value;
        totals.push(round2(total));
    });
    return { totals, total: round2(total) };
}

/** The tape as a markdown table, for saving to Notes. */
export function tapeToMarkdown(lines: TapeLine[], labels: { item: string; amount: string; total: string }, format: (n: number) => string): string {
    const { totals, total } = runTape(lines);
    const rows = lines.map((line, i) => `| ${line.label.replace(/\|/g, '/') || '—'} | ${line.op} ${format(line.value)} | ${format(totals[i])} |`);
    return [`| ${labels.item} | ${labels.amount} | ${labels.total} |`, '| --- | ---: | ---: |', ...rows, '', `**${labels.total}: ${format(total)}**`].join('\n');
}
