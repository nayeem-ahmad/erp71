export function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export function buildTenders(
    gross: number,
    payments: Array<{ method: string; amount: number }>,
): Array<{ method: string; amount: number }> {
    const rows = payments
        .filter((p) => p.amount !== 0)
        .map((p) => ({ method: p.method, amount: round2(p.amount) }));
    const paid = round2(rows.reduce((sum, row) => sum + row.amount, 0));
    const credit = round2(gross - paid);
    if (credit > 0) {
        rows.push({ method: 'Credit', amount: credit });
    }
    return rows;
}
