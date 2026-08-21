/**
 * The vocabulary of an LC import, in one place so the DTO, the service and the
 * frontend cannot drift on it.
 */

/**
 * The life of a shipment, in order. Movement is forward-only except for
 * CANCELLED, which any pre-receipt state can reach — see `canTransition`.
 *
 * These are stored as strings rather than a Prisma enum deliberately: a tenant
 * who imports by air never sees CUSTOMS the way a sea importer does, and
 * loosening the sequence later must not need a migration on a live enum.
 */
export const ShipmentStatus = {
    /** Being prepared. Items and terms editable, nothing posted. */
    DRAFT: 'DRAFT',
    /** LC application lodged with the bank. */
    LC_APPLIED: 'LC_APPLIED',
    /** Bank has issued the LC. Margin normally paid at this point. */
    LC_ISSUED: 'LC_ISSUED',
    /** Goods on the water or in the air; BL issued. */
    SHIPPED: 'SHIPPED',
    /** Shipping documents received, usually against payment or acceptance. */
    DOCS_RECEIVED: 'DOCS_RECEIVED',
    /** Bill of Entry lodged; duty, VAT and AIT assessed. */
    CUSTOMS: 'CUSTOMS',
    /** Goods received into stock. A Purchase now exists. */
    RECEIVED: 'RECEIVED',
    /** Everything settled, including a usance acceptance. */
    CLOSED: 'CLOSED',
    CANCELLED: 'CANCELLED',
} as const;

export type ShipmentStatus = (typeof ShipmentStatus)[keyof typeof ShipmentStatus];

export const SHIPMENT_STATUSES = Object.values(ShipmentStatus);

/** Ordered, so "has it got at least as far as X" is a comparison. */
export const SHIPMENT_FLOW: ShipmentStatus[] = [
    ShipmentStatus.DRAFT,
    ShipmentStatus.LC_APPLIED,
    ShipmentStatus.LC_ISSUED,
    ShipmentStatus.SHIPPED,
    ShipmentStatus.DOCS_RECEIVED,
    ShipmentStatus.CUSTOMS,
    ShipmentStatus.RECEIVED,
    ShipmentStatus.CLOSED,
];

/**
 * Whether a status change is allowed.
 *
 * Forward-only, and skipping ahead is permitted: an air shipment against a
 * telegraphic transfer never touches LC_APPLIED, and forcing a tenant to click
 * through states their business does not have is how status fields become
 * meaningless. What is refused is going backwards, because costs and postings
 * attach to states, and reopening a received shipment would leave a Purchase
 * whose stock is already on the shelf.
 *
 * CANCELLED is reachable from anything before RECEIVED. After receipt the goods
 * exist and the answer is a purchase return, not a cancellation.
 */
export function canTransition(from: string, to: string): boolean {
    if (from === to) return true;
    if (to === ShipmentStatus.CANCELLED) {
        return from !== ShipmentStatus.RECEIVED && from !== ShipmentStatus.CLOSED && from !== ShipmentStatus.CANCELLED;
    }
    if (from === ShipmentStatus.CANCELLED) return false;

    const fromIndex = SHIPMENT_FLOW.indexOf(from as ShipmentStatus);
    const toIndex = SHIPMENT_FLOW.indexOf(to as ShipmentStatus);
    if (fromIndex === -1 || toIndex === -1) return false;
    return toIndex > fromIndex;
}

/**
 * RECEIVED is set by the receive endpoint, which writes a Purchase and moves
 * stock. Letting it be set through a plain status PATCH would leave a shipment
 * claiming to be received with no goods and no purchase behind it.
 */
export const STATUS_SET_BY_ACTION: string[] = [ShipmentStatus.RECEIVED];

export const LcType = {
    /** Payable on presentation of documents. */
    SIGHT: 'SIGHT',
    DEFERRED: 'DEFERRED',
    /** Payable N days after acceptance — the tenor. Creates a bank payable. */
    USANCE: 'USANCE',
} as const;

export const LC_TYPES = Object.values(LcType);

/**
 * What a shipment can be charged for.
 *
 * `capitalized: false` marks a charge that is a receivable rather than part of
 * what the goods cost. Getting this wrong in either direction misstates every
 * subsequent sale of the shipment, so it is a property of the cost type rather
 * than a per-entry choice — though `is_capitalized` on the row can still
 * override it for the unusual case (an unregistered importer who cannot claim
 * VAT back, for instance).
 */
export const ImportCostType = {
    LC_MARGIN: 'LC_MARGIN',
    LC_COMMISSION: 'LC_COMMISSION',
    BANK_CHARGE: 'BANK_CHARGE',
    FREIGHT: 'FREIGHT',
    INSURANCE: 'INSURANCE',
    CUSTOMS_DUTY: 'CUSTOMS_DUTY',
    /** Regulatory duty. */
    RD: 'RD',
    /** Supplementary duty. */
    SD: 'SD',
    VAT: 'VAT',
    AIT: 'AIT',
    CF_AGENT: 'CF_AGENT',
    PORT: 'PORT',
    TRANSPORT: 'TRANSPORT',
    OTHER: 'OTHER',
} as const;

export type ImportCostType = (typeof ImportCostType)[keyof typeof ImportCostType];

export const IMPORT_COST_TYPES = Object.values(ImportCostType);

/**
 * Whether a cost type is part of the goods' cost by default.
 *
 * Not capitalised, and why:
 *
 * - **VAT** — import VAT is rebatable against output VAT for a VAT-registered
 *   importer. It is money the government will give back, not a cost of the
 *   goods.
 * - **AIT** — advance income tax, creditable against the year's income tax
 *   liability. Same argument.
 * - **LC_MARGIN** — not a cost at all. It is the tenant's own cash lodged with
 *   the bank, released against the supplier's invoice. It moves between two
 *   asset accounts and must never touch inventory.
 * - **LC_COMMISSION / BANK_CHARGE** — the cost of *financing* the import, not
 *   of the goods. Capitalising financing costs into inventory is how a slow
 *   shipment starts looking like an expensive product.
 */
export const CAPITALIZED_BY_DEFAULT: Record<ImportCostType, boolean> = {
    LC_MARGIN: false,
    LC_COMMISSION: false,
    BANK_CHARGE: false,
    FREIGHT: true,
    INSURANCE: true,
    CUSTOMS_DUTY: true,
    RD: true,
    SD: true,
    VAT: false,
    AIT: false,
    CF_AGENT: true,
    PORT: true,
    TRANSPORT: true,
    OTHER: true,
};

/** The allocation basis that fits each charge, when the caller does not say. */
export const DEFAULT_BASIS_BY_COST_TYPE: Record<ImportCostType, 'VALUE' | 'QTY' | 'WEIGHT' | 'CBM'> = {
    LC_MARGIN: 'VALUE',
    LC_COMMISSION: 'VALUE',
    BANK_CHARGE: 'VALUE',
    // Freight is billed on weight, so allocating it on value would put an air
    // shipment's freight on the expensive line rather than the heavy one.
    FREIGHT: 'WEIGHT',
    INSURANCE: 'VALUE',
    CUSTOMS_DUTY: 'VALUE',
    RD: 'VALUE',
    SD: 'VALUE',
    VAT: 'VALUE',
    AIT: 'VALUE',
    CF_AGENT: 'VALUE',
    PORT: 'CBM',
    TRANSPORT: 'WEIGHT',
    OTHER: 'VALUE',
};

export const ImportDocType = {
    LC_COPY: 'LC_COPY',
    COMMERCIAL_INVOICE: 'COMMERCIAL_INVOICE',
    PACKING_LIST: 'PACKING_LIST',
    BL: 'BL',
    COO: 'COO',
    INSURANCE: 'INSURANCE',
    BILL_OF_ENTRY: 'BILL_OF_ENTRY',
    RELEASE_ORDER: 'RELEASE_ORDER',
    OTHER: 'OTHER',
} as const;

export const IMPORT_DOC_TYPES = Object.values(ImportDocType);

/**
 * Account names looked up in the tenant's chart of accounts, seeded by
 * `bootstrap-accounting.ts`. Names rather than codes, matching how
 * `autoPostFromRules` resolves rule accounts — a tenant may renumber their
 * chart but the seeded names are stable.
 */
export const ImportAccount = {
    LC_MARGIN: 'LC Margin & Advance to Bank',
    GOODS_IN_TRANSIT: 'Goods in Transit',
    AIT: 'Advance Income Tax (AIT)',
    VAT_REBATE: 'VAT Rebate Receivable',
    LC_ACCEPTANCE_PAYABLE: 'LC Acceptance Payable',
    BANK_CHARGES: 'LC & Bank Charges',
    FX_GAIN: 'FX Gain',
    FX_LOSS: 'FX Loss',
} as const;

/** Where a non-capitalised charge goes when the caller does not name an account. */
export const RECEIVABLE_ACCOUNT_BY_COST_TYPE: Partial<Record<ImportCostType, string>> = {
    VAT: ImportAccount.VAT_REBATE,
    AIT: ImportAccount.AIT,
    LC_MARGIN: ImportAccount.LC_MARGIN,
    LC_COMMISSION: ImportAccount.BANK_CHARGES,
    BANK_CHARGE: ImportAccount.BANK_CHARGES,
};
