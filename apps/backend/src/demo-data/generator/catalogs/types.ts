/**
 * Demo catalog types. These are richer than the admin catalog-import template:
 * the generator needs a sell price alongside purchase cost, a reorder level, a
 * popularity weight (so the sales mix has head and tail products rather than
 * uniform noise), and a realistic unit_type — none of which the import template
 * carries.
 */
export interface DemoCatalogProduct {
    sku: string;
    name: string;
    group: string;
    subgroup: string;
    brand?: string;
    /** Cost the shop pays a supplier, BDT per unit. Seeds ProductPrice.cost. */
    purchaseCost: number;
    /** Retail price, BDT per unit. Seeds Product.price + ProductPrice.price. */
    sellPrice: number;
    /** Stock level at/below which the simulator triggers a replenishment purchase. */
    reorderLevel: number;
    /** Relative sales weight; higher = sells more often. */
    popularityWeight: number;
    /** e.g. 'kg', 'litre', 'pcs', 'box', 'pack'. */
    unitType: string;
}

export interface DemoCatalog {
    businessType: string;
    products: DemoCatalogProduct[];
}
