import {
    DiziItem,
    DiziPayment,
    DiziPurchaseDetail,
    DiziPurchaseHeader,
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
        // Dizi gives only the party's *current* net balance, not a pre-history
        // opening figure. It is used as an opening balance only when posting is
        // off (the default) and the tenant is not replaying documents — see the
        // note in external-sync.service.ts.
        previousDue: toMoney(row.Balance),
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
        previousDue: toMoney(row.Balance),
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
 * Direction is fixed by which endpoint the row came from: the customer-payment
 * list is money in, the supplier-payment list is money out. Dizi does not fold
 * refunds into these summaries as negatives, so there is no per-row direction
 * to read. Returns null (with a warning) only when the amount is unusable.
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

    const amount = toMoney(row.Amount);
    if (amount <= 0) {
        warnings.push({
            entity,
            externalId,
            code: 'PAYMENT_AMOUNT_INVALID',
            message: `Payment ${slip}: amount ${row.Amount ?? 'null'} is not a positive number — skipped`,
        });
        return null;
    }

    const method = emptyToNull(row.MethodName);
    const noteParts = [emptyToNull(row.Narration), method ? `via ${method}` : null].filter(Boolean);

    return {
        externalId,
        paymentNumber: buildDocumentNumber(documentPrefix, slip),
        referenceNumber: emptyToNull(row.SlipNo ?? row.TransactionNo ?? null),
        externalPartyId: emptyToNull(row.TraderId),
        direction: party === 'CUSTOMER' ? 'IN' : 'OUT',
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
