import { round2 } from './money';

/** Bangladesh Bank notes in circulation, largest first. */
export const BDT_NOTES = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export interface NoteCount {
    denomination: number;
    count: number;
    amount: number;
}

export function countNotes(counts: Record<number, number>, coins: number): { rows: NoteCount[]; notesTotal: number; pieces: number; total: number } {
    const rows = BDT_NOTES.map((denomination) => {
        const count = Math.max(0, Math.floor(counts[denomination] ?? 0));
        return { denomination, count, amount: denomination * count };
    });
    const notesTotal = rows.reduce((sum, row) => sum + row.amount, 0);
    return {
        rows,
        notesTotal,
        pieces: rows.reduce((sum, row) => sum + row.count, 0),
        total: round2(notesTotal + Math.max(0, coins)),
    };
}
