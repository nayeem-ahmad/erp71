import { Injectable } from '@nestjs/common';
import {
    BILL_SCAN_MAX_EDGE_PX,
    BILL_SCAN_MAX_OUTPUT_TOKENS,
    estimateBillScanCredits,
    type BillScanLine,
    type BillScanResult,
} from '@erp71/shared-types';
import { AiService } from '../ai/ai.service';
import { DatabaseService } from '../database/database.service';
import { TenantContext } from '../database/tenant.decorator';
import { ScanBillDto } from './bill-scan.dto';

const MAX_LINES = 60;

/** Words that say nothing about which product a bill line is. */
const NOISE = new Set(['pcs', 'pc', 'kg', 'gm', 'g', 'ltr', 'l', 'ml', 'pkt', 'packet', 'box', 'dozen', 'doz', 'nos', 'x', 'the', 'and']);

/** The words of a name worth matching on: lower-cased, without sizes and units. */
export function significantWords(value: string): string[] {
    return value
        .toLowerCase()
        .replace(/[()[\],.\-_/\\:;'"*+]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 1 && !NOISE.has(word) && !/^\d+([.,]\d+)?(kg|g|gm|ml|l|ltr|pcs)?$/.test(word));
}

/** Share of `query`'s words found in `candidate` — 1 when every one is there. */
export function wordOverlap(query: string, candidate: string): number {
    const wanted = significantWords(query);
    if (wanted.length === 0) return 0;
    const have = new Set(significantWords(candidate));
    const haveText = candidate.toLowerCase();
    const hits = wanted.filter((word) => have.has(word) || haveText.includes(word)).length;
    return hits / wanted.length;
}

/** Best candidate by overlap, if it clears `threshold`. Ties go to the shorter name — the closer fit. */
export function bestMatch<T>(query: string, candidates: T[], nameOf: (row: T) => string, threshold = 0.5): T | null {
    let best: { row: T; score: number; length: number } | null = null;
    for (const row of candidates) {
        const name = nameOf(row);
        const score = wordOverlap(query, name);
        if (score < threshold) continue;
        if (!best || score > best.score || (score === best.score && name.length < best.length)) {
            best = { row, score, length: name.length };
        }
    }
    return best?.row ?? null;
}

const num = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/[,৳\s]|tk/gi, ''));
        return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
    }
    return null;
};
const str = (value: unknown, max = 300): string | null =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const day = (value: unknown): string | null => {
    const text = str(value, 20);
    if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    return Number.isNaN(new Date(`${text}T00:00:00Z`).getTime()) ? null : text;
};

/** The model's JSON, coerced to the result's shape. Anything unreadable is null, never a guess. */
export function normalizeBillFields(fields: Record<string, unknown>) {
    const lines: BillScanLine[] = (Array.isArray(fields.lines) ? fields.lines : [])
        .slice(0, MAX_LINES)
        .map((raw): BillScanLine | null => {
            if (!raw || typeof raw !== 'object') return null;
            const line = raw as Record<string, unknown>;
            const description = str(line.description, 200);
            if (!description) return null;
            const unitPrice = num(line.unit_price);
            const lineTotal = num(line.line_total);
            let quantity = num(line.quantity);
            if (!quantity || quantity <= 0) {
                quantity = unitPrice && lineTotal ? Math.round((lineTotal / unitPrice) * 1000) / 1000 : 1;
            }
            return {
                description,
                quantity,
                unitPrice: unitPrice ?? (lineTotal !== null ? Math.round((lineTotal / quantity) * 100) / 100 : null),
                lineTotal,
            };
        })
        .filter((line): line is BillScanLine => line !== null);

    return {
        vendorName: str(fields.vendor_name, 200),
        vendorPhone: str(fields.vendor_phone, 40),
        vendorAddress: str(fields.vendor_address, 300),
        billNumber: str(fields.bill_number, 60),
        billDate: day(fields.bill_date),
        lines,
        subtotal: num(fields.subtotal),
        discount: num(fields.discount),
        tax: num(fields.tax),
        freight: num(fields.freight),
        total: num(fields.total),
        summary: str(fields.summary, 300),
    };
}

/**
 * Tools → Scan a bill. The AI reads the photo; this matches what it read
 * against the workspace — the supplier, the products, the expense head — so
 * the review form opens with as much already picked as can be trusted.
 */
@Injectable()
export class BillScanService {
    constructor(
        private readonly ai: AiService,
        private readonly db: DatabaseService,
    ) {}

    async scan(ctx: TenantContext, dto: ScanBillDto): Promise<BillScanResult> {
        const estimate = estimateBillScanCredits(dto.width ?? BILL_SCAN_MAX_EDGE_PX, dto.height ?? BILL_SCAN_MAX_EDGE_PX);
        const { fields, creditsUsed } = await this.ai.scanBill(ctx.tenantId, {
            imageBase64: dto.imageBase64,
            mimeType: dto.mimeType,
            target: dto.target,
            maxTokens: BILL_SCAN_MAX_OUTPUT_TOKENS,
        });
        const read = normalizeBillFields(fields);

        const result: BillScanResult = {
            target: dto.target,
            ...read,
            credits_used: Math.round(creditsUsed * 100) / 100,
            credits_estimate: estimate,
        };

        if (dto.target === 'purchase') {
            result.supplier = await this.matchSupplier(ctx.tenantId, read.vendorName, read.vendorPhone);
            result.lines = await this.matchProducts(ctx.tenantId, read.lines);
        } else {
            result.expenseHead = await this.matchExpenseHead(ctx.tenantId, [read.summary, read.vendorName, ...read.lines.map((l) => l.description)]);
        }
        return result;
    }

    private async matchSupplier(tenantId: string, name: string | null, phone: string | null) {
        const digits = (phone ?? '').replace(/\D/g, '').slice(-10);
        if (digits.length >= 8) {
            const byPhone = await this.db.supplier.findFirst({
                where: { tenant_id: tenantId, phone: { contains: digits } },
                select: { id: true, name: true, phone: true },
            });
            if (byPhone) return byPhone;
        }
        const words = significantWords(name ?? '');
        if (words.length === 0) return null;
        const candidates = await this.db.supplier.findMany({
            where: { tenant_id: tenantId, OR: words.slice(0, 4).map((word) => ({ name: { contains: word, mode: 'insensitive' as const } })) },
            select: { id: true, name: true, phone: true },
            take: 25,
        });
        return bestMatch(name ?? '', candidates, (row) => row.name, 0.6);
    }

    private async matchProducts(tenantId: string, lines: BillScanLine[]): Promise<BillScanLine[]> {
        const matched: BillScanLine[] = [];
        for (const line of lines) {
            const words = significantWords(line.description);
            if (words.length === 0) {
                matched.push({ ...line, product: null });
                continue;
            }
            const candidates = await this.db.product.findMany({
                where: {
                    tenant_id: tenantId,
                    deleted_at: null,
                    OR: [
                        { sku: { equals: line.description.trim(), mode: 'insensitive' as const } },
                        ...words.slice(0, 4).map((word) => ({ name: { contains: word, mode: 'insensitive' as const } })),
                    ],
                },
                select: { id: true, name: true, sku: true, unit_type: true },
                take: 30,
            });
            const bySku = candidates.find((row) => row.sku && row.sku.toLowerCase() === line.description.trim().toLowerCase());
            matched.push({ ...line, product: bySku ?? bestMatch(line.description, candidates, (row) => row.name) });
        }
        return matched;
    }

    private async matchExpenseHead(tenantId: string, hints: Array<string | null>) {
        const text = hints.filter(Boolean).join(' ');
        if (!text.trim()) return null;
        const heads = await this.db.expenseHead.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, name: true, category: { select: { name: true } } },
            take: 300,
        });
        // Each head is scored by how many of its own words the bill mentions:
        // "Electricity bill" against a DESCO receipt reading "electricity".
        let best: { head: (typeof heads)[number]; score: number } | null = null;
        for (const head of heads) {
            const score = wordOverlap(`${head.name} ${head.category?.name ?? ''}`, text);
            if (score > 0 && (!best || score > best.score)) best = { head, score };
        }
        return best ? { id: best.head.id, name: best.head.name, categoryName: best.head.category?.name ?? null } : null;
    }
}
