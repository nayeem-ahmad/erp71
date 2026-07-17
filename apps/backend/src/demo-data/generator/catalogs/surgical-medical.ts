import type { DemoCatalog, DemoCatalogProduct } from './types';

/**
 * SURGICAL_MEDICAL demo catalog.
 *
 * SKUs, names, brands, groups/subgroups, and purchase cost are sourced verbatim
 * from `packages/database/prisma/templates/surgical-medical.json` (the same list
 * the admin catalog importer uses) so a demo tenant and an imported tenant never
 * end up with two contradictory product lists. Demo-only metadata — sell price,
 * reorder level, popularity weight, unit_type — is *derived* from cost here.
 */

interface TemplateRow {
    sku: string;
    name: string;
    group: string;
    subgroup: string;
    brand: string | null;
    cost: number;
}

const TEMPLATE_ROWS: TemplateRow[] = [
    { sku: 'P01109', name: 'DU-DRUM 6*6', group: 'Accessories & Consumables', subgroup: 'Medical Accessories', brand: null, cost: 160 },
    { sku: 'P01085', name: 'A-tex Ebrass', group: 'Accessories & Consumables', subgroup: 'Medical Accessories', brand: null, cost: 300 },
    { sku: 'P01083', name: 'Nosel', group: 'Accessories & Consumables', subgroup: 'Medical Accessories', brand: null, cost: 370 },
    { sku: 'P00197', name: 'Air Cushion S', group: 'Air Mattresses & Cushions', subgroup: 'Air Cushions', brand: null, cost: 350 },
    { sku: 'P00198', name: 'Air Cushion M', group: 'Air Mattresses & Cushions', subgroup: 'Air Cushions', brand: null, cost: 190 },
    { sku: 'P00275', name: 'Air Matress - ATOM AT-100', group: 'Air Mattresses & Cushions', subgroup: 'Anti-Decubitus Air Mattresses', brand: null, cost: 1850 },
    { sku: 'P00244', name: 'BSMI Aneroied BP Machine', group: 'Blood Pressure Monitors', subgroup: 'Aneroid & Manual', brand: 'BSMI', cost: 900 },
    { sku: 'P00230', name: 'Aneroid Analog China BP Machine', group: 'Blood Pressure Monitors', subgroup: 'Aneroid & Manual', brand: null, cost: 420 },
    { sku: 'P01111', name: 'IML BP SET', group: 'Blood Pressure Monitors', subgroup: 'Aneroid & Manual', brand: 'IML', cost: 840 },
    { sku: 'P00213', name: 'Electric Breast Pump', group: 'Breast Care', subgroup: 'Electric Breast Pumps', brand: null, cost: 950 },
    { sku: 'P00221', name: 'INTELLIGENT Automatic Double Breast Pump RH228', group: 'Breast Care', subgroup: 'Electric Breast Pumps', brand: null, cost: 1230 },
    { sku: 'P01103', name: 'Breast pump (double fitter)', group: 'Breast Care', subgroup: 'Electric Breast Pumps', brand: null, cost: 1000 },
    { sku: 'P00793', name: 'I69 D.V.T. Stocking Thigh High (Pair) S', group: 'Compression Therapy', subgroup: 'DVT Stockings', brand: null, cost: 732 },
    { sku: 'P00794', name: 'I69 D.V.T. Stocking Thigh High (Pair) M', group: 'Compression Therapy', subgroup: 'DVT Stockings', brand: null, cost: 732 },
    { sku: 'P00795', name: 'I69 D.V.T. Stocking Thigh High (Pair) L', group: 'Compression Therapy', subgroup: 'DVT Stockings', brand: null, cost: 732 },
    { sku: 'P00195', name: 'Dengu Device NS1', group: 'Diagnostic Equipment', subgroup: 'Dengue Tests', brand: null, cost: 680 },
    { sku: 'P00196', name: 'Dengu Device IG', group: 'Diagnostic Equipment', subgroup: 'Dengue Tests', brand: null, cost: 740 },
    { sku: 'P00087', name: 'ECG Paper 210*30', group: 'Diagnostic Equipment', subgroup: 'ECG Equipment', brand: null, cost: 160 },
    { sku: 'P00940', name: 'K02 Heel Cushion Silicone (Pair) S', group: 'Foot Orthotics', subgroup: 'Heel Care', brand: null, cost: 586 },
    { sku: 'P00941', name: 'K02 Heel Cushion Silicone (Pair) M', group: 'Foot Orthotics', subgroup: 'Heel Care', brand: null, cost: 650 },
    { sku: 'P00942', name: 'K02 Heel Cushion Silicone (Pair) L', group: 'Foot Orthotics', subgroup: 'Heel Care', brand: null, cost: 650 },
    { sku: 'P00179', name: 'Sinocare AQ Smart Blood Glucose Stip', group: 'Glucose Monitoring', subgroup: 'Glucometers', brand: 'Sinocare', cost: 325 },
    { sku: 'P00180', name: 'Safe AQ Smart Blood Glucose Monitoring System', group: 'Glucose Monitoring', subgroup: 'Glucometers', brand: 'Safe AQ', cost: 750 },
    { sku: 'P00182', name: 'Bioland Concept Blood Glucose Monitor', group: 'Glucose Monitoring', subgroup: 'Glucometers', brand: 'Bioland', cost: 600 },
    { sku: 'P01180', name: 'Rionet Hearing Aid', group: 'Hearing Aids', subgroup: 'Hearing Aids', brand: 'Rionet', cost: 620 },
    { sku: 'P01147', name: 'Axon Hearing Aid', group: 'Hearing Aids', subgroup: 'Hearing Aids', brand: 'Axon', cost: 340 },
    { sku: 'P01059', name: 'Hearing Aid Regular', group: 'Hearing Aids', subgroup: 'Hearing Aids', brand: null, cost: 370 },
    { sku: 'P00704', name: 'I73 Heating Pad Ortho REGULAR', group: 'Heat & Cold Therapy', subgroup: 'Heating Pads', brand: null, cost: 610 },
    { sku: 'P00705', name: 'I73 Heating Pad Ortho XL', group: 'Heat & Cold Therapy', subgroup: 'Heating Pads', brand: null, cost: 1276 },
    { sku: 'P00115', name: 'Flamingo Orthopedic Heat Belt HC 1003', group: 'Heat & Cold Therapy', subgroup: 'Heating Pads', brand: 'Flamingo', cost: 900 },
    { sku: 'P00140', name: 'Hospital Bed 21W', group: 'Hospital Equipment', subgroup: 'Hospital Beds', brand: null, cost: 19500 },
    { sku: 'P00113', name: 'Guee, Neck Massage Cushion', group: 'Massagers & Therapy', subgroup: 'Electric Massagers', brand: null, cost: 320 },
    { sku: 'P00145', name: 'Dolphin Inferred Messager', group: 'Massagers & Therapy', subgroup: 'Electric Massagers', brand: null, cost: 630 },
    { sku: 'P00148', name: 'Double-Head Massager Hammer', group: 'Massagers & Therapy', subgroup: 'Electric Massagers', brand: null, cost: 1163 },
    { sku: 'P00252', name: 'Maxell Battery', group: 'Miscellaneous', subgroup: 'Batteries & Adapters', brand: null, cost: 35 },
    { sku: 'P00253', name: 'THOMAS Battery', group: 'Miscellaneous', subgroup: 'Batteries & Adapters', brand: null, cost: 11 },
    { sku: 'P00280', name: 'Power Adapter AC-DC 5V', group: 'Miscellaneous', subgroup: 'Batteries & Adapters', brand: null, cost: 43 },
    { sku: 'P00199', name: 'Hand Crutch SS', group: 'Mobility Aids', subgroup: 'Axillary Crutches', brand: null, cost: 709 },
    { sku: 'P00200', name: 'Hand Crutch Aluminium', group: 'Mobility Aids', subgroup: 'Axillary Crutches', brand: null, cost: 580 },
    { sku: 'P00204', name: 'Hand Crutch SS Double Lock', group: 'Mobility Aids', subgroup: 'Axillary Crutches', brand: null, cost: 820 },
    { sku: 'P00121', name: 'JB Nebulizer', group: 'Nebulizers & Respiratory', subgroup: 'Compressor Nebulizers', brand: null, cost: 1320 },
    { sku: 'P00122', name: 'Easy Compressor Nebulizer', group: 'Nebulizers & Respiratory', subgroup: 'Compressor Nebulizers', brand: null, cost: 1350 },
    { sku: 'P00123', name: 'WELLMED Compressor Nebulizer', group: 'Nebulizers & Respiratory', subgroup: 'Compressor Nebulizers', brand: 'Wellmed', cost: 1300 },
    { sku: 'P00754', name: 'I59 Scrotal Support S', group: 'Orthopedic Supports', subgroup: 'Abdominal & Rib Supports', brand: null, cost: 480 },
    { sku: 'P00755', name: 'I59 Scrotal Support M', group: 'Orthopedic Supports', subgroup: 'Abdominal & Rib Supports', brand: null, cost: 480 },
    { sku: 'P00756', name: 'I59 Scrotal Support L', group: 'Orthopedic Supports', subgroup: 'Abdominal & Rib Supports', brand: null, cost: 480 },
    { sku: 'P00163', name: 'Disposable Mask', group: 'Protective Masks', subgroup: 'Protective Masks', brand: null, cost: 70 },
    { sku: 'P00071', name: 'Pulse Oximeter JK-302', group: 'Pulse Oximeters', subgroup: 'Adult Pulse Oximeters', brand: null, cost: 250 },
    { sku: 'P00072', name: 'JUMPER JPD-500D', group: 'Pulse Oximeters', subgroup: 'Adult Pulse Oximeters', brand: 'Jumper', cost: 710 },
    { sku: 'P00073', name: 'JUMPER JPD-801', group: 'Pulse Oximeters', subgroup: 'Adult Pulse Oximeters', brand: 'Jumper', cost: 380 },
];

/** Cheaper consumables move faster and are restocked in larger quantities. */
function deriveMetadata(row: TemplateRow): DemoCatalogProduct {
    const markup = row.cost < 100 ? 1.6 : row.cost < 1000 ? 1.4 : 1.28;
    const sellPrice = Math.max(row.cost + 10, Math.round((row.cost * markup) / 5) * 5);
    const reorderLevel = row.cost < 100 ? 30 : row.cost < 1000 ? 10 : 4;
    // Cheaper items sell more often; expensive equipment is a long-tail item.
    const popularityWeight = row.cost < 100 ? 8 : row.cost < 500 ? 5 : row.cost < 2000 ? 2 : 1;
    const unitType = /\(pair\)/i.test(row.name) ? 'pair' : 'pcs';
    return {
        sku: row.sku,
        name: row.name,
        group: row.group,
        subgroup: row.subgroup,
        brand: row.brand ?? undefined,
        purchaseCost: row.cost,
        sellPrice,
        reorderLevel,
        popularityWeight,
        unitType,
    };
}

export const surgicalMedicalCatalog: DemoCatalog = {
    businessType: 'SURGICAL_MEDICAL',
    products: TEMPLATE_ROWS.map(deriveMetadata),
};
