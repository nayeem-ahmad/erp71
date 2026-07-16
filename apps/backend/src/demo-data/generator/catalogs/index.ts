import type { DemoCatalog } from './types';
import { groceryCatalog } from './grocery';
import { pharmacyCatalog } from './pharmacy';
import { surgicalMedicalCatalog } from './surgical-medical';
import { computerHardwareCatalog } from './computer-hardware';

export type { DemoCatalog, DemoCatalogProduct } from './types';

const CATALOGS: Record<string, DemoCatalog> = {
    GROCERY: groceryCatalog,
    PHARMACY: pharmacyCatalog,
    SURGICAL_MEDICAL: surgicalMedicalCatalog,
    COMPUTER_HARDWARE: computerHardwareCatalog,
};

/**
 * Pick the demo catalog for a tenant's business type. `business_type` is a
 * nullable free-text column; anything we don't recognise (including null) falls
 * back to GROCERY, the general-retail default.
 */
export function catalogForBusinessType(businessType: string | null | undefined): DemoCatalog {
    if (!businessType) return groceryCatalog;
    return CATALOGS[businessType.trim().toUpperCase()] ?? groceryCatalog;
}
