import type { DemoCatalog } from './types';

/**
 * PHARMACY demo catalog — generics, OTC medicines, and consumer health devices
 * common to a Bangladeshi retail pharmacy, BDT-priced. Fast-moving OTC lines
 * carry high popularity weights; devices are the long tail.
 */
export const pharmacyCatalog: DemoCatalog = {
    businessType: 'PHARMACY',
    products: [
        // Analgesics / OTC
        { sku: 'PHR-PARA-500', name: 'Paracetamol 500mg (strip of 10)', group: 'OTC Medicines', subgroup: 'Analgesics', brand: 'Napa', purchaseCost: 7, sellPrice: 12, reorderLevel: 60, popularityWeight: 10, unitType: 'strip' },
        { sku: 'PHR-PARA-XR', name: 'Paracetamol XR 665mg (strip)', group: 'OTC Medicines', subgroup: 'Analgesics', brand: 'Napa Extra', purchaseCost: 14, sellPrice: 22, reorderLevel: 40, popularityWeight: 7, unitType: 'strip' },
        { sku: 'PHR-IBU-400', name: 'Ibuprofen 400mg (strip)', group: 'OTC Medicines', subgroup: 'Analgesics', brand: 'Flamex', purchaseCost: 18, sellPrice: 28, reorderLevel: 30, popularityWeight: 5, unitType: 'strip' },
        { sku: 'PHR-ACE-XR', name: 'Aceclofenac 100mg (strip)', group: 'OTC Medicines', subgroup: 'Analgesics', brand: 'Acenac', purchaseCost: 32, sellPrice: 45, reorderLevel: 25, popularityWeight: 4, unitType: 'strip' },

        // Antacids / Gastro
        { sku: 'PHR-OMEP-20', name: 'Omeprazole 20mg (strip)', group: 'OTC Medicines', subgroup: 'Gastro', brand: 'Seclo', purchaseCost: 28, sellPrice: 42, reorderLevel: 40, popularityWeight: 8, unitType: 'strip' },
        { sku: 'PHR-ANTAC-SU', name: 'Antacid Suspension 200ml', group: 'OTC Medicines', subgroup: 'Gastro', brand: 'Antacid Plus', purchaseCost: 55, sellPrice: 80, reorderLevel: 25, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'PHR-ESOM-20', name: 'Esomeprazole 20mg (strip)', group: 'OTC Medicines', subgroup: 'Gastro', brand: 'Nexum', purchaseCost: 45, sellPrice: 65, reorderLevel: 25, popularityWeight: 5, unitType: 'strip' },
        { sku: 'PHR-ORS-PK', name: 'Oral Saline ORS (sachet)', group: 'OTC Medicines', subgroup: 'Gastro', brand: 'Orsaline-N', purchaseCost: 4, sellPrice: 6, reorderLevel: 80, popularityWeight: 9, unitType: 'pcs' },

        // Cold / Allergy
        { sku: 'PHR-CETIRIZ', name: 'Cetirizine 10mg (strip)', group: 'OTC Medicines', subgroup: 'Antihistamine', brand: 'Alatrol', purchaseCost: 9, sellPrice: 15, reorderLevel: 40, popularityWeight: 7, unitType: 'strip' },
        { sku: 'PHR-FEXO-120', name: 'Fexofenadine 120mg (strip)', group: 'OTC Medicines', subgroup: 'Antihistamine', brand: 'Fexo', purchaseCost: 40, sellPrice: 58, reorderLevel: 25, popularityWeight: 4, unitType: 'strip' },
        { sku: 'PHR-COUGH-SY', name: 'Cough Syrup 100ml', group: 'OTC Medicines', subgroup: 'Cold & Cough', brand: 'Adovas', purchaseCost: 60, sellPrice: 85, reorderLevel: 25, popularityWeight: 6, unitType: 'pcs' },
        { sku: 'PHR-VIT-C', name: 'Vitamin C 250mg (strip)', group: 'OTC Medicines', subgroup: 'Vitamins', brand: 'Ceevit', purchaseCost: 22, sellPrice: 32, reorderLevel: 30, popularityWeight: 5, unitType: 'strip' },

        // Antibiotics (Rx but stocked)
        { sku: 'PHR-AMOX-500', name: 'Amoxicillin 500mg (strip)', group: 'Prescription', subgroup: 'Antibiotics', brand: 'Amoxil', purchaseCost: 48, sellPrice: 70, reorderLevel: 25, popularityWeight: 5, unitType: 'strip' },
        { sku: 'PHR-AZITH-500', name: 'Azithromycin 500mg (strip of 3)', group: 'Prescription', subgroup: 'Antibiotics', brand: 'Azithro', purchaseCost: 65, sellPrice: 95, reorderLevel: 20, popularityWeight: 4, unitType: 'strip' },
        { sku: 'PHR-CIPRO-500', name: 'Ciprofloxacin 500mg (strip)', group: 'Prescription', subgroup: 'Antibiotics', brand: 'Ciprocin', purchaseCost: 55, sellPrice: 78, reorderLevel: 20, popularityWeight: 3, unitType: 'strip' },
        { sku: 'PHR-METRO-400', name: 'Metronidazole 400mg (strip)', group: 'Prescription', subgroup: 'Antibiotics', brand: 'Flagyl', purchaseCost: 25, sellPrice: 38, reorderLevel: 25, popularityWeight: 4, unitType: 'strip' },

        // Chronic care
        { sku: 'PHR-METF-500', name: 'Metformin 500mg (strip)', group: 'Prescription', subgroup: 'Diabetes', brand: 'Comet', purchaseCost: 20, sellPrice: 30, reorderLevel: 30, popularityWeight: 6, unitType: 'strip' },
        { sku: 'PHR-AMLO-5', name: 'Amlodipine 5mg (strip)', group: 'Prescription', subgroup: 'Cardiac', brand: 'Amdocal', purchaseCost: 18, sellPrice: 28, reorderLevel: 30, popularityWeight: 6, unitType: 'strip' },
        { sku: 'PHR-ATOR-10', name: 'Atorvastatin 10mg (strip)', group: 'Prescription', subgroup: 'Cardiac', brand: 'Atova', purchaseCost: 40, sellPrice: 58, reorderLevel: 25, popularityWeight: 5, unitType: 'strip' },
        { sku: 'PHR-LOSAR-50', name: 'Losartan 50mg (strip)', group: 'Prescription', subgroup: 'Cardiac', brand: 'Losar', purchaseCost: 35, sellPrice: 52, reorderLevel: 25, popularityWeight: 5, unitType: 'strip' },

        // Vitamins & Supplements
        { sku: 'PHR-CALCIUM', name: 'Calcium + D3 (strip)', group: 'Supplements', subgroup: 'Vitamins', brand: 'Calbo-D', purchaseCost: 42, sellPrice: 60, reorderLevel: 25, popularityWeight: 4, unitType: 'strip' },
        { sku: 'PHR-ZINC-SY', name: 'Zinc Syrup 100ml', group: 'Supplements', subgroup: 'Vitamins', brand: 'Zinc-B', purchaseCost: 45, sellPrice: 65, reorderLevel: 20, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'PHR-MULTIVIT', name: 'Multivitamin (bottle of 30)', group: 'Supplements', subgroup: 'Vitamins', brand: 'Vitamix', purchaseCost: 150, sellPrice: 200, reorderLevel: 15, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'PHR-IRON-FA', name: 'Iron + Folic Acid (strip)', group: 'Supplements', subgroup: 'Vitamins', brand: 'Feroglobin', purchaseCost: 30, sellPrice: 45, reorderLevel: 20, popularityWeight: 4, unitType: 'strip' },

        // First aid & consumables
        { sku: 'PHR-BAND-PK', name: 'Adhesive Bandage (box of 100)', group: 'First Aid', subgroup: 'Dressing', brand: 'Handyplast', purchaseCost: 120, sellPrice: 160, reorderLevel: 15, popularityWeight: 5, unitType: 'box' },
        { sku: 'PHR-GAUZE', name: 'Sterile Gauze Roll', group: 'First Aid', subgroup: 'Dressing', brand: null, purchaseCost: 25, sellPrice: 40, reorderLevel: 25, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'PHR-ANTISEP', name: 'Antiseptic Liquid 250ml', group: 'First Aid', subgroup: 'Antiseptic', brand: 'Savlon', purchaseCost: 95, sellPrice: 130, reorderLevel: 20, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'PHR-COTTON', name: 'Absorbent Cotton 100g', group: 'First Aid', subgroup: 'Dressing', brand: null, purchaseCost: 40, sellPrice: 60, reorderLevel: 20, popularityWeight: 4, unitType: 'pack' },
        { sku: 'PHR-SYRINGE', name: 'Disposable Syringe 5ml (box)', group: 'First Aid', subgroup: 'Injection', brand: null, purchaseCost: 180, sellPrice: 240, reorderLevel: 12, popularityWeight: 3, unitType: 'box' },
        { sku: 'PHR-MASK-BOX', name: 'Surgical Mask (box of 50)', group: 'First Aid', subgroup: 'PPE', brand: null, purchaseCost: 150, sellPrice: 220, reorderLevel: 15, popularityWeight: 5, unitType: 'box' },
        { sku: 'PHR-GLOVES', name: 'Examination Gloves (box of 100)', group: 'First Aid', subgroup: 'PPE', brand: null, purchaseCost: 320, sellPrice: 420, reorderLevel: 10, popularityWeight: 3, unitType: 'box' },

        // Devices
        { sku: 'PHR-THERMO', name: 'Digital Thermometer', group: 'Devices', subgroup: 'Diagnostics', brand: 'Omron', purchaseCost: 180, sellPrice: 250, reorderLevel: 12, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'PHR-BP-MON', name: 'Digital BP Monitor', group: 'Devices', subgroup: 'Diagnostics', brand: 'Omron', purchaseCost: 2100, sellPrice: 2600, reorderLevel: 5, popularityWeight: 2, unitType: 'pcs' },
        { sku: 'PHR-GLUCO', name: 'Glucometer Kit', group: 'Devices', subgroup: 'Diagnostics', brand: 'Accu-Chek', purchaseCost: 900, sellPrice: 1200, reorderLevel: 6, popularityWeight: 2, unitType: 'pcs' },
        { sku: 'PHR-GLUCO-ST', name: 'Glucometer Strips (box of 50)', group: 'Devices', subgroup: 'Diagnostics', brand: 'Accu-Chek', purchaseCost: 600, sellPrice: 780, reorderLevel: 12, popularityWeight: 4, unitType: 'box' },
        { sku: 'PHR-OXIMETER', name: 'Pulse Oximeter', group: 'Devices', subgroup: 'Diagnostics', brand: 'Jumper', purchaseCost: 550, sellPrice: 750, reorderLevel: 8, popularityWeight: 2, unitType: 'pcs' },
        { sku: 'PHR-NEBUL', name: 'Compressor Nebulizer', group: 'Devices', subgroup: 'Respiratory', brand: 'Omron', purchaseCost: 1300, sellPrice: 1700, reorderLevel: 4, popularityWeight: 1, unitType: 'pcs' },

        // Personal care & baby
        { sku: 'PHR-SANITIZER', name: 'Hand Sanitizer 100ml', group: 'Personal Care', subgroup: 'Hygiene', brand: 'Savlon', purchaseCost: 55, sellPrice: 80, reorderLevel: 25, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'PHR-BABY-LOT', name: 'Baby Lotion 100ml', group: 'Personal Care', subgroup: 'Baby Care', brand: 'Johnson', purchaseCost: 130, sellPrice: 175, reorderLevel: 12, popularityWeight: 2, unitType: 'pcs' },
        { sku: 'PHR-DIAPER', name: 'Baby Diapers (pack of 10)', group: 'Personal Care', subgroup: 'Baby Care', brand: 'Pampers', purchaseCost: 220, sellPrice: 280, reorderLevel: 12, popularityWeight: 3, unitType: 'pack' },
        { sku: 'PHR-SANPAD', name: 'Sanitary Napkin (pack of 10)', group: 'Personal Care', subgroup: 'Feminine Care', brand: 'Senora', purchaseCost: 75, sellPrice: 100, reorderLevel: 25, popularityWeight: 6, unitType: 'pack' },
        { sku: 'PHR-LIPBALM', name: 'Medicated Lip Balm', group: 'Personal Care', subgroup: 'Skin Care', brand: null, purchaseCost: 45, sellPrice: 70, reorderLevel: 20, popularityWeight: 2, unitType: 'pcs' },
        { sku: 'PHR-EYEDROP', name: 'Lubricating Eye Drops 10ml', group: 'OTC Medicines', subgroup: 'Ophthalmic', brand: 'Refresh', purchaseCost: 70, sellPrice: 100, reorderLevel: 20, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'PHR-INHALER', name: 'Salbutamol Inhaler', group: 'Prescription', subgroup: 'Respiratory', brand: 'Ventolin', purchaseCost: 210, sellPrice: 280, reorderLevel: 12, popularityWeight: 3, unitType: 'pcs' },
    ],
};
