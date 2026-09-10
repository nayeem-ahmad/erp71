/**
 * Types, constants and helpers shared by the manufacturing screens.
 *
 * These four screens were one page with a tab strip until the tabs became
 * sidebar submenu items; the shapes below are the API contracts they all read,
 * kept in one place so the split routes cannot drift apart.
 */
import type { StatusBadgeTone } from '@/components/ui';

export interface BomComponent {
    id: string;
    productId: string;
    quantity: number;
    product: { id: string; name: string; sku: string | null };
}

export interface BomRecipe {
    id: string;
    productId: string;
    productName: string;
    productSku: string | null;
    outputQty: number;
    notes: string | null;
    componentCount: number;
    created_at: string;
    updated_at: string;
}

export interface BomRecipeDetail extends Omit<BomRecipe, 'componentCount'> {
    product: { id: string; name: string; sku: string | null };
    components: BomComponent[];
}

export interface ProductionJobRecipe {
    id: string;
    outputQty: number;
    product: { id: string; name: string; sku: string | null };
    components: BomComponent[];
}

export interface ProductionJob {
    id: string;
    tenantId: string;
    recipeId: string;
    productId: string;
    quantity: number;
    status: string;
    notes: string | null;
    startedAt: string | null;
    completedAt: string | null;
    created_at: string;
    recipe: ProductionJobRecipe;
    totalJobCost: number | string | null;
    costPerUnit: number | string | null;
}

export type JobCostType = 'RAW_MATERIAL' | 'PRINTING' | 'BINDING' | 'TRANSPORT' | 'LABOR' | 'OVERHEAD' | 'OTHER';

export interface ProductionJobCost {
    id: string;
    jobId: string;
    costType: JobCostType;
    amount: number | string;
    notes: string | null;
    created_at: string;
    sourcePurchaseItem?: {
        id: string;
        product: { id: string; name: string; sku: string | null };
        purchase: { id: string; purchase_number: string };
    } | null;
}

export interface CostSource {
    id: string;
    productName: string;
    purchaseId: string;
    purchaseNumber: string;
    supplierName: string | null;
    purchaseDate: string;
    lineTotal: number;
    allocatedAmount: number;
    remainingAmount: number;
}

export interface PricingSuggestion {
    productId: string;
    productName: string;
    costPerUnit: number;
    marginPct: number;
    suggestedPrice: number;
    currentPrice: number;
}

export interface JobsResponse {
    items: ProductionJob[];
    total: number;
    page: number;
    limit: number;
    pages: number;
}

export interface RequirementItem {
    productId: string;
    productName: string;
    productSku: string | null;
    perUnitQty: number;
    requiredQty: number;
    availableQty: number;
    sufficient: boolean;
}

export interface RequirementsPreview {
    recipeId: string;
    quantity: number;
    outputQty: number;
    sufficient: boolean;
    components: RequirementItem[];
}

export interface AnalyticsJobRow {
    jobId: string;
    productId: string;
    productName: string;
    productSku: string | null;
    quantityProduced: number;
    plannedMaterialCost: number;
    wastageCost: number;
    actualMaterialCost: number;
    unitProductionCost: number;
    completedAt: string | null;
}

export interface AnalyticsTrendPoint {
    date: string;
    quantityProduced: number;
}

export interface AnalyticsSummary {
    totalCompletedJobs: number;
    totalUnitsProduced: number;
    totalMaterialCost: number;
    avgUnitProductionCost: number;
    jobs: AnalyticsJobRow[];
    volumeTrend: AnalyticsTrendPoint[];
}

export interface ProductPLRow {
    productId: string;
    productName: string;
    productSku: string | null;
    jobsCompleted: number;
    quantityProduced: number;
    totalProductionCost: number;
    avgCostPerUnit: number;
    unitsSold: number;
    revenue: number;
    grossProfit: number;
    grossMarginPct: number;
}

export interface ProductPLReport {
    products: ProductPLRow[];
    totals: { quantityProduced: number; totalProductionCost: number; revenue: number; grossProfit: number };
}

/** The slice of a product the BOM pickers need. */
export interface PickerProduct {
    id: string;
    name: string;
    sku?: string | null;
}


// ------------------------------------------------------------------ //
//  Constants                                                          //
// ------------------------------------------------------------------ //

export const JOB_STATUS_TONES: Record<string, StatusBadgeTone> = {
    DRAFT: 'neutral',
    IN_PROGRESS: 'info',
    COMPLETED: 'success',
    CANCELLED: 'danger',
};

export function productLabel(product: PickerProduct): string {
    return product.sku ? `${product.name} (${product.sku})` : product.name;
}

export const EMPTY_BOM_FORM = {
    productId: '',
    outputQty: 1,
    notes: '',
    components: [] as Array<{ productId: string; quantity: number }>,
};

export const EMPTY_JOB_FORM = {
    recipeId: '',
    quantity: 1,
    notes: '',
};

export const JOB_STATUS_LABEL_KEYS: Record<string, 'draft' | 'inProgress' | 'completed' | 'cancelled'> = {
    DRAFT: 'draft',
    IN_PROGRESS: 'inProgress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
};

export const ADDABLE_JOB_COST_TYPES: Exclude<JobCostType, 'RAW_MATERIAL'>[] = [
    'PRINTING',
    'BINDING',
    'TRANSPORT',
    'LABOR',
    'OVERHEAD',
    'OTHER',
];

export const EMPTY_JOB_COST_FORM = {
    costType: 'PRINTING' as Exclude<JobCostType, 'RAW_MATERIAL'>,
    amount: '',
    notes: '',
    sourcePurchaseItemId: '',
};

