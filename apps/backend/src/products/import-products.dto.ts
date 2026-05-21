// CSV row shape after parsing
export interface CsvProductRow {
    name: string;
    sku?: string;
    barcode?: string;
    selling_price: number;
    cost_price?: number;
    stock_quantity?: number;
    reorder_point?: number;
    unit?: string;
}
