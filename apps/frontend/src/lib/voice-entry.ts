export type VoiceEntryType =
    | 'sale'
    | 'purchase'
    | 'sales_order'
    | 'sales_quote'
    | 'purchase_order'
    | 'purchase_quote'
    | 'sales_return'
    | 'purchase_return';

export interface VoiceEntryProduct {
    id: string;
    name: string;
    price: number;
    group?: { name: string };
    subgroup?: { name: string };
}

export interface VoiceEntryParsedItem {
    matched: boolean;
    productName: string;
    quantity: number;
    product?: VoiceEntryProduct;
}

export interface VoiceEntryResult {
    transcript: string;
    entryType: VoiceEntryType;
    items: VoiceEntryParsedItem[];
    unmatched: string[];
    note?: string;
}

export function buildVoiceEntryMessages(result: VoiceEntryResult, added: number, action = 'Added'): string[] {
    const messages: string[] = [];
    if (added > 0) {
        messages.push(`${action} ${added} item${added === 1 ? '' : 's'} from voice.`);
    }
    if (result.unmatched.length > 0) {
        messages.push(`Could not find: ${result.unmatched.join(', ')}`);
    }
    return messages;
}

function normalizeName(value: string): string {
    return value.toLowerCase().trim();
}

export function applyVoiceEntryReturnQuantities(
    result: VoiceEntryResult,
    lines: Array<{
        id: string;
        productId?: string;
        productName?: string;
    }>,
    getMaxQty: (lineId: string) => number,
): { quantities: Record<string, number>; unmatched: string[] } {
    const quantities: Record<string, number> = {};
    const unmatched = [...result.unmatched];

    for (const parsed of result.items) {
        if (!parsed.matched || !parsed.product) {
            continue;
        }

        const productId = parsed.product.id;
        const spoken = normalizeName(parsed.productName);

        const line = lines.find((candidate) => {
            if (candidate.productId === productId) {
                return true;
            }
            const name = candidate.productName ?? '';
            const normalized = normalizeName(name);
            return normalized === spoken
                || normalized.includes(spoken)
                || spoken.includes(normalized);
        });

        if (!line) {
            unmatched.push(parsed.productName);
            continue;
        }

        const maxQty = getMaxQty(line.id);
        if (maxQty <= 0) {
            unmatched.push(parsed.productName);
            continue;
        }

        quantities[line.id] = Math.min(parsed.quantity, maxQty);
    }

    return { quantities, unmatched: [...new Set(unmatched)] };
}