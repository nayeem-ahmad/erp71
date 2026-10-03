import {
    DiziItem,
    DiziPayment,
    DiziPurchaseDetail,
    DiziPurchaseHeader,
    DiziQuotationDetail,
    DiziQuotationHeader,
    DiziSaleDetail,
    DiziSaleHeader,
    DiziSaleReturnDetail,
    DiziTrader,
} from './dizi-cashier.client';
import {
    MappedCustomer,
    MappedPayment,
    MappedProduct,
    MappedPurchase,
    MappedPurchaseItem,
    MappedQuotation,
    MappedQuotationItem,
    MappedSale,
    MappedSaleItem,
    MappedSaleReturn,
    MappedSaleReturnItem,
    MappedSupplier,
    PaymentParty,
    SyncWarning,
    buildDocumentNumber,
    dedupeCode,
    emptyToNull,
    parseProviderDate,
    parseTimestamp,
    resolvePaymentStatus,
    resolveQuantity,
    toMoney,
} from './external-sync.mapper';

/**
 * Pure mapping from Dizi Cashier payloads onto our own shapes — the sibling of
 * external-sync.mapper.ts, which does the same for Express Retail Pro. Both
 * produce the identical `Mapped*` types the service persists, so everything
 * downstream (dedupe, adoption, impacts, ledger) is provider-agnostic.
 *
 * Dizi differs from Express in ways that shape the code here:
 *  - ids are GUIDs, so `externalId` is `row.Id` verbatim;
 *  - amounts arrive as JSON numbers, not strings, but `toMoney` handles both;
 *  - product/customer codes are frequently null, so `dedupeCode` leans on its
 *    `EXT-<id>` fallback more than it does for Express;
 *  - line items live on a per-document detail call, so the sale/purchase/return
 *    mappers take the fetched detail rather than a separate lines array.
 */

export function mapDiziProduct(row: DiziItem, claimedSkus: Set<string>): MappedProduct {
    const externalId = String(row.Id);
    // Dizi has no per-item VAT percentage — tax is a TaxCategory reference — so
    // vatRate stays null and the reorder point comes from MinimumStock.
    const minStock = toMoney(row.MinimumStock);
    const purchaseRate = toMoney(row.BuyingPriceIncludingTax) || toMoney(row.WeightedAvgCost);

    return {
        externalId,
        sku: dedupeCode((row.SKU || row.Barcode || '').trim(), externalId, claimedSkus),
        name: (row.Name || '').trim() || `Unnamed product ${externalId}`,
        price: toMoney(row.PriceIncludingTax),
        purchaseRate,
        vatRate: null,
        reorderLevel: minStock > 0 ? Math.round(minStock) : null,
        isService: row.IsService === true,
        externalUpdatedAt: parseTimestamp(row.UpdatedOn),
    };
}

export function mapDiziCustomer(row: DiziTrader, claimedCodes: Set<string>): MappedCustomer {
    const externalId = String(row.Id);

    return {
        externalId,
        customerCode: dedupeCode((row.Code || '').trim(), externalId, claimedCodes),
        name: (row.Name || '').trim() || `Unnamed customer ${externalId}`,
        ownerName: emptyToNull(row.ContactPerson),
        phone: emptyToNull(row.ContactNo),
        email: emptyToNull(row.Email),
        address: emptyToNull(row.Location),
        // Dizi exposes no credit limit on the trader row.
        creditLimit: null,
        // Deliberately zero, where Express sends a real `previous_due`.
        //
        // Dizi's `Balance` is the party's *current* net position, which already
        // includes every sale and payment this import is about to replay.
        // `applyOpeningBalance` hard-sets `due_balance` to what it is given and
        // the replayed documents then move it again, so carrying this over
        // leaves roughly double the true debt. Letting the balance build from
        // the documents is correct for a full-history import, and is the reason
        // a Dizi connection wants `history_start_date` at the beginning of its
        // data rather than a rolling window — a party whose debt predates the
        // window would otherwise come out short.
        previousDue: 0,
        externalUpdatedAt: parseTimestamp(row.UpdatedOn),
    };
}

export function mapDiziSupplier(row: DiziTrader, claimedNames: Set<string>): MappedSupplier {
    const externalId = String(row.Id);
    // Supplier is unique on [tenant_id, name] in our schema, so the name is the
    // value that has to be disambiguated.
    const name = dedupeCode((row.Name || '').trim() || `Unnamed supplier ${externalId}`, externalId, claimedNames);

    return {
        externalId,
        name,
        phone: emptyToNull(row.ContactNo),
        email: emptyToNull(row.Email),
        address: emptyToNull(row.Location),
        // Zero for the same reason as the customer above: Dizi's Balance is a
        // current figure, and the replayed purchases and payments rebuild it.
        previousDue: 0,
        externalUpdatedAt: parseTimestamp(row.UpdatedOn),
    };
}

export function mapDiziSale(
    header: DiziSaleHeader,
    detail: DiziSaleDetail | null,
    documentPrefix: string,
    warnings: SyncWarning[],
): MappedSale {
    const externalId = String(header.Id);
    const slip = (header.SlipNo || detail?.SlipNo || externalId).toString();

    const items: MappedSaleItem[] = (detail?.SalesItems ?? []).map((line) => {
        const { quantity, rounded, originalQuantity } = resolveQuantity(line.Quantity);
        if (rounded) {
            warnings.push({
                entity: 'SALE',
                externalId,
                code: 'QUANTITY_ROUNDED',
                message: `Invoice ${slip}: quantity ${originalQuantity} rounded to ${quantity} (our line quantities are whole numbers)`,
            });
        }
        const unitCost = toMoney(line.CostPrice);
        // The tax-inclusive, post-discount unit price is what the customer
        // actually paid; fall back through the less-specific fields.
        const price = toMoney(line.DiscountedPricePerUnitWithTax) || toMoney(line.PricePerUnitWithTax) || toMoney(line.PricePerUnit);
        return {
            externalProductId: String(line.ItemId ?? ''),
            quantity,
            priceAtSale: price,
            unitCostAtSale: unitCost > 0 ? unitCost : null,
        };
    });

    return {
        externalId,
        serialNumber: buildDocumentNumber(documentPrefix, slip),
        referenceNumber: emptyToNull(header.SlipNo ?? detail?.SlipNo ?? null),
        externalCustomerId: emptyToNull(header.TraderId ?? detail?.CustomerId ?? null),
        totalAmount: toMoney(header.TotalAmount),
        amountPaid: toMoney(header.ReceivedAmount),
        // Dizi records the settling account by name rather than a cash/bank
        // flag; treat anything that names a bank as bank, else cash.
        paymentMode: /bank/i.test(detail?.CashOrBankAccount ?? '') ? 'bank' : 'cash',
        saleDate: parseProviderDate(header.TransactionDate),
        note: emptyToNull(detail?.Narration ?? null),
        externalUpdatedAt: parseTimestamp(detail?.UpdatedOn),
        items,
    };
}

export function mapDiziPurchase(
    header: DiziPurchaseHeader,
    detail: DiziPurchaseDetail | null,
    documentPrefix: string,
    warnings: SyncWarning[],
): MappedPurchase {
    const externalId = String(header.Id);
    const slip = (header.SlipNo || detail?.SlipNo || externalId).toString();

    const items: MappedPurchaseItem[] = (detail?.PurchaseItems ?? []).map((line) => {
        const { quantity, rounded, originalQuantity } = resolveQuantity(line.Quantity);
        if (rounded) {
            warnings.push({
                entity: 'PURCHASE',
                externalId,
                code: 'QUANTITY_ROUNDED',
                message: `Purchase ${slip}: quantity ${originalQuantity} rounded to ${quantity} (our line quantities are whole numbers)`,
            });
        }
        const unitCost = toMoney(line.DiscountedPricePerUnit) || toMoney(line.PricePerUnit);
        return {
            externalProductId: String(line.ItemId ?? ''),
            quantity,
            unitCost,
            lineTotal: Math.round(unitCost * quantity * 100) / 100,
        };
    });

    const totalAmount = toMoney(header.TotalAmount);
    const paidAmount = toMoney(header.ReceivedAmount) || toMoney(detail?.PaidAmount);

    return {
        externalId,
        purchaseNumber: buildDocumentNumber(documentPrefix, slip),
        referenceNumber: emptyToNull(header.SlipNo ?? detail?.SlipNo ?? null),
        externalSupplierId: emptyToNull(header.TraderId ?? detail?.SupplierId ?? null),
        subtotalAmount: toMoney(detail?.BasePriceAmount),
        taxAmount: toMoney(detail?.TaxAmount),
        discountAmount: toMoney(detail?.DiscountAmount),
        // Dizi carries freight as separate PurchaseAdditionalCosts rows we do
        // not import; the header total still reflects them.
        freightAmount: 0,
        totalAmount,
        paidAmount,
        paymentStatus: resolvePaymentStatus(totalAmount, paidAmount),
        notes: emptyToNull(detail?.Narration ?? null),
        purchaseDate: parseProviderDate(header.TransactionDate),
        externalUpdatedAt: parseTimestamp(detail?.UpdatedOn),
        items,
    };
}

/**
 * Direction starts from the endpoint the row came from — the customer-payment
 * list is money in, the supplier-payment list is money out — and flips when the
 * amount is negative, which is how Dizi records a refund against that party.
 * Dropping those would lose real money movement, so the sign is read as
 * direction and the magnitude becomes the amount. Returns null (with a
 * warning) only when the amount is zero or unparseable.
 */
export function mapDiziPayment(
    row: DiziPayment,
    party: PaymentParty,
    documentPrefix: string,
    warnings: SyncWarning[],
): MappedPayment | null {
    const externalId = String(row.Id);
    const entity = party === 'CUSTOMER' ? 'CUSTOMER_PAYMENT' : 'SUPPLIER_PAYMENT';
    const slip = (row.SlipNo || row.TransactionNo || externalId).toString();

    const signedAmount = toMoney(row.Amount);
    if (signedAmount === 0) {
        warnings.push({
            entity,
            externalId,
            code: 'PAYMENT_AMOUNT_INVALID',
            message: `Payment ${slip}: amount ${row.Amount ?? 'null'} is not a usable number — skipped`,
        });
        return null;
    }

    // A negative row reverses the direction its endpoint implies: money paid
    // back to a customer, or recovered from a supplier.
    const isRefund = signedAmount < 0;
    const amount = Math.abs(signedAmount);
    const forward = party === 'CUSTOMER' ? 'IN' : 'OUT';
    const reversed = party === 'CUSTOMER' ? 'OUT' : 'IN';

    const method = emptyToNull(row.MethodName);
    const noteParts = [
        emptyToNull(row.Narration),
        method ? `via ${method}` : null,
        isRefund ? 'refund (negative amount in Dizi)' : null,
    ].filter(Boolean);

    return {
        externalId,
        paymentNumber: buildDocumentNumber(documentPrefix, slip),
        referenceNumber: emptyToNull(row.SlipNo ?? row.TransactionNo ?? null),
        externalPartyId: emptyToNull(row.TraderId),
        direction: isRefund ? reversed : forward,
        amount,
        date: parseProviderDate(row.Date),
        method,
        // Dizi does not report a party's prior due on the payment row.
        previousDue: null,
        note: noteParts.length ? noteParts.join(' — ') : null,
        externalUpdatedAt: null,
    };
}

/**
 * Sale returns are mapped from their *detail* payload: the list row carries no
 * parent-sale id, and the line items (and the SalesId link) only appear on
 * `api/SalesReturn/{id}`.
 */
export function mapDiziSaleReturn(
    detail: DiziSaleReturnDetail,
    documentPrefix: string,
    warnings: SyncWarning[],
): MappedSaleReturn {
    const externalId = String(detail.Id);
    const slip = (detail.ReturnSlipNo || externalId).toString();

    const items: MappedSaleReturnItem[] = (detail.ReturnItems ?? []).map((line) => {
        const { quantity, rounded, originalQuantity } = resolveQuantity(line.Quantity);
        if (rounded) {
            warnings.push({
                entity: 'SALE_RETURN',
                externalId,
                code: 'QUANTITY_ROUNDED',
                message: `Return ${slip}: quantity ${originalQuantity} rounded to ${quantity} (our line quantities are whole numbers)`,
            });
        }
        const lineAmount = toMoney(line.TotalAmount);
        return {
            externalProductId: String(line.ItemId ?? ''),
            quantity,
            refundAmount: lineAmount > 0 ? lineAmount : Math.round(toMoney(line.PricePerItem) * quantity * 100) / 100,
        };
    });

    return {
        externalId,
        returnNumber: buildDocumentNumber(documentPrefix, slip),
        referenceNumber: emptyToNull(detail.ReturnSlipNo),
        externalSaleId: emptyToNull(detail.SalesId),
        totalRefund: toMoney(detail.GrossAmount) || toMoney(detail.TotalAmount),
        reason: emptyToNull(detail.Narration),
        returnDate: parseProviderDate(detail.ReturnDate),
        externalUpdatedAt: parseTimestamp(detail.UpdatedOn),
        items,
    };
}

/** The quotation's business date, whichever field this Dizi build names it. */
export function diziQuotationDate(header: DiziQuotationHeader): string | null {
    return emptyToNull(header.TransactionDate ?? header.QuotationDate ?? header.Date ?? null);
}

/** Dizi's quotation states onto ours; anything unrecognised reads as sent. */
const DIZI_QUOTATION_STATUS: Record<string, string> = {
    DRAFT: 'DRAFT',
    SENT: 'SENT',
    PENDING: 'SENT',
    OPEN: 'SENT',
    ACCEPTED: 'ACCEPTED',
    APPROVED: 'ACCEPTED',
    REJECTED: 'REJECTED',
    DECLINED: 'REJECTED',
    CANCELLED: 'REJECTED',
    CANCELED: 'REJECTED',
    EXPIRED: 'EXPIRED',
    CONVERTED: 'CONVERTED',
    INVOICED: 'CONVERTED',
};

/**
 * Quotations, like sales, carry their lines only on the detail payload. A
 * quotation whose detail could not be fetched still imports as a header with
 * its total, and says so, rather than vanishing.
 *
 * The quotation payload was never recorded from the live account (see the
 * types in dizi-cashier.client.ts), so each value is read from the field names
 * Dizi uses for the same thing on its sales, with fallbacks.
 */
export function mapDiziQuotation(
    header: DiziQuotationHeader,
    detail: DiziQuotationDetail | null,
    documentPrefix: string,
    warnings: SyncWarning[],
): MappedQuotation {
    const externalId = String(header.Id);
    const number = emptyToNull(
        header.QuotationNo ?? header.SlipNo ?? detail?.QuotationNo ?? detail?.SlipNo ?? null,
    );
    const slip = number ?? externalId;

    const lines = detail?.QuotationItems ?? detail?.Items ?? null;
    if (!detail || !lines) {
        warnings.push({
            entity: 'QUOTATION',
            externalId,
            code: 'QUOTATION_LINES_MISSING',
            message: `Quotation ${slip}: line items could not be read from Dizi — imported with its total only`,
        });
    }

    const items: MappedQuotationItem[] = (lines ?? []).map((line) => {
        const { quantity, rounded, originalQuantity } = resolveQuantity(line.Quantity);
        if (rounded) {
            warnings.push({
                entity: 'QUOTATION',
                externalId,
                code: 'QUANTITY_ROUNDED',
                message: `Quotation ${slip}: quantity ${originalQuantity} rounded to ${quantity} (our line quantities are whole numbers)`,
            });
        }
        // The offered (tax-inclusive, post-discount) unit price, falling back
        // through the less specific fields and finally the line total.
        const lineTotal = toMoney(line.TotalAmount) || toMoney(line.SubTotalAmount);
        const unitPrice =
            toMoney(line.DiscountedPricePerUnitWithTax) ||
            toMoney(line.PricePerUnitWithTax) ||
            toMoney(line.DiscountedPricePerUnit) ||
            toMoney(line.PricePerUnit) ||
            (quantity > 0 ? Math.round((lineTotal / quantity) * 100) / 100 : 0);
        return { externalProductId: String(line.ItemId ?? ''), quantity, unitPrice };
    });

    const lineSum = Math.round(items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) * 100) / 100;
    const date = diziQuotationDate(header) ?? emptyToNull(detail?.Date ?? detail?.QuotationDate ?? detail?.TransactionDate ?? null);
    const validUntil = emptyToNull(detail?.ValidUntil ?? detail?.ValidTill ?? detail?.ExpiryDate ?? null);

    const converted = detail?.IsConverted === true || Boolean(emptyToNull(detail?.SalesId ?? null));
    const status = converted
        ? 'CONVERTED'
        : DIZI_QUOTATION_STATUS[(detail?.Status ?? '').trim().toUpperCase()] ?? 'SENT';

    return {
        externalId,
        quoteNumber: buildDocumentNumber(documentPrefix, slip),
        referenceNumber: number,
        externalCustomerId: emptyToNull(header.TraderId ?? header.CustomerId ?? detail?.CustomerId ?? detail?.TraderId ?? null),
        totalAmount: toMoney(header.TotalAmount) || toMoney(detail?.TotalAmount) || lineSum,
        quoteDate: parseProviderDate(date ?? ''),
        validUntil: validUntil ? parseProviderDate(validUntil) : null,
        status,
        notes: emptyToNull(detail?.Narration ?? detail?.Note ?? null),
        externalUpdatedAt: parseTimestamp(detail?.UpdatedOn),
        items,
    };
}
