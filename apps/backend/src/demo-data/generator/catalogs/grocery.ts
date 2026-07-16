import type { DemoCatalog } from './types';

/**
 * GROCERY demo catalog — the default/fallback business type. Everyday
 * Bangladeshi retail staples with realistic BDT pricing and real unit types
 * (kg/litre/pcs/pack). Popularity weights give the sales mix a believable head
 * (rice, oil, eggs) and tail (specialty items).
 */
export const groceryCatalog: DemoCatalog = {
    businessType: 'GROCERY',
    products: [
        // Rice & Grains
        { sku: 'GRO-RICE-MNK5', name: 'Miniket Rice 5kg', group: 'Rice & Grains', subgroup: 'Rice', brand: 'Fresh', purchaseCost: 360, sellPrice: 420, reorderLevel: 30, popularityWeight: 10, unitType: 'pack' },
        { sku: 'GRO-RICE-NZR5', name: 'Nazirshail Rice 5kg', group: 'Rice & Grains', subgroup: 'Rice', brand: 'Teer', purchaseCost: 400, sellPrice: 470, reorderLevel: 25, popularityWeight: 8, unitType: 'pack' },
        { sku: 'GRO-RICE-CHL1', name: 'Chinigura Aromatic Rice 1kg', group: 'Rice & Grains', subgroup: 'Rice', brand: 'Pran', purchaseCost: 120, sellPrice: 155, reorderLevel: 20, popularityWeight: 4, unitType: 'kg' },
        { sku: 'GRO-ATTA-2KG', name: 'Atta Whole Wheat Flour 2kg', group: 'Rice & Grains', subgroup: 'Flour', brand: 'Teer', purchaseCost: 105, sellPrice: 130, reorderLevel: 20, popularityWeight: 6, unitType: 'pack' },
        { sku: 'GRO-MAIDA-1K', name: 'Maida Flour 1kg', group: 'Rice & Grains', subgroup: 'Flour', brand: 'Teer', purchaseCost: 60, sellPrice: 78, reorderLevel: 20, popularityWeight: 4, unitType: 'kg' },
        { sku: 'GRO-SUJI-500', name: 'Suji Semolina 500g', group: 'Rice & Grains', subgroup: 'Flour', brand: 'Pran', purchaseCost: 45, sellPrice: 60, reorderLevel: 15, popularityWeight: 2, unitType: 'pack' },

        // Edible Oil
        { sku: 'GRO-OIL-SOY1', name: 'Soybean Oil 1L', group: 'Cooking Essentials', subgroup: 'Edible Oil', brand: 'Rupchanda', purchaseCost: 158, sellPrice: 185, reorderLevel: 25, popularityWeight: 10, unitType: 'litre' },
        { sku: 'GRO-OIL-SOY5', name: 'Soybean Oil 5L', group: 'Cooking Essentials', subgroup: 'Edible Oil', brand: 'Fresh', purchaseCost: 770, sellPrice: 870, reorderLevel: 12, popularityWeight: 6, unitType: 'pack' },
        { sku: 'GRO-OIL-MST5', name: 'Mustard Oil 500ml', group: 'Cooking Essentials', subgroup: 'Edible Oil', brand: 'Radhuni', purchaseCost: 140, sellPrice: 170, reorderLevel: 20, popularityWeight: 5, unitType: 'pack' },
        { sku: 'GRO-OIL-SUN1', name: 'Sunflower Oil 1L', group: 'Cooking Essentials', subgroup: 'Edible Oil', brand: 'Pusti', purchaseCost: 195, sellPrice: 230, reorderLevel: 12, popularityWeight: 3, unitType: 'litre' },

        // Sugar, Salt & Spices
        { sku: 'GRO-SUGAR-1K', name: 'Refined Sugar 1kg', group: 'Cooking Essentials', subgroup: 'Sugar & Salt', brand: 'Fresh', purchaseCost: 118, sellPrice: 140, reorderLevel: 30, popularityWeight: 8, unitType: 'kg' },
        { sku: 'GRO-SALT-1KG', name: 'Iodized Salt 1kg', group: 'Cooking Essentials', subgroup: 'Sugar & Salt', brand: 'ACI', purchaseCost: 28, sellPrice: 40, reorderLevel: 30, popularityWeight: 6, unitType: 'kg' },
        { sku: 'GRO-TURM-200', name: 'Turmeric Powder 200g', group: 'Cooking Essentials', subgroup: 'Spices', brand: 'Radhuni', purchaseCost: 55, sellPrice: 72, reorderLevel: 20, popularityWeight: 5, unitType: 'pack' },
        { sku: 'GRO-CHIL-200', name: 'Chili Powder 200g', group: 'Cooking Essentials', subgroup: 'Spices', brand: 'Radhuni', purchaseCost: 62, sellPrice: 80, reorderLevel: 20, popularityWeight: 5, unitType: 'pack' },
        { sku: 'GRO-CUMIN-100', name: 'Cumin Powder 100g', group: 'Cooking Essentials', subgroup: 'Spices', brand: 'Pran', purchaseCost: 70, sellPrice: 90, reorderLevel: 15, popularityWeight: 3, unitType: 'pack' },
        { sku: 'GRO-CORI-100', name: 'Coriander Powder 100g', group: 'Cooking Essentials', subgroup: 'Spices', brand: 'Radhuni', purchaseCost: 40, sellPrice: 55, reorderLevel: 15, popularityWeight: 3, unitType: 'pack' },

        // Lentils & Pulses
        { sku: 'GRO-DAL-MSR1', name: 'Masoor Dal 1kg', group: 'Lentils & Pulses', subgroup: 'Dal', brand: 'Teer', purchaseCost: 110, sellPrice: 135, reorderLevel: 25, popularityWeight: 7, unitType: 'kg' },
        { sku: 'GRO-DAL-MUG1', name: 'Mug Dal 1kg', group: 'Lentils & Pulses', subgroup: 'Dal', brand: 'Pran', purchaseCost: 135, sellPrice: 165, reorderLevel: 15, popularityWeight: 4, unitType: 'kg' },
        { sku: 'GRO-DAL-CHL1', name: 'Chola Boot 1kg', group: 'Lentils & Pulses', subgroup: 'Dal', brand: 'Fresh', purchaseCost: 95, sellPrice: 120, reorderLevel: 15, popularityWeight: 3, unitType: 'kg' },

        // Dairy & Eggs
        { sku: 'GRO-MILK-PWD', name: 'Full Cream Milk Powder 500g', group: 'Dairy & Eggs', subgroup: 'Milk', brand: 'Marks', purchaseCost: 420, sellPrice: 480, reorderLevel: 15, popularityWeight: 6, unitType: 'pack' },
        { sku: 'GRO-MILK-LIQ', name: 'UHT Liquid Milk 1L', group: 'Dairy & Eggs', subgroup: 'Milk', brand: 'Aarong', purchaseCost: 90, sellPrice: 110, reorderLevel: 20, popularityWeight: 5, unitType: 'litre' },
        { sku: 'GRO-EGG-DZ', name: 'Farm Eggs (dozen)', group: 'Dairy & Eggs', subgroup: 'Eggs', brand: null, purchaseCost: 125, sellPrice: 150, reorderLevel: 30, popularityWeight: 9, unitType: 'pack' },
        { sku: 'GRO-BUTTER-100', name: 'Butter 100g', group: 'Dairy & Eggs', subgroup: 'Milk', brand: 'Aarong', purchaseCost: 95, sellPrice: 120, reorderLevel: 12, popularityWeight: 2, unitType: 'pcs' },

        // Beverages
        { sku: 'GRO-TEA-400', name: 'Tea Leaf 400g', group: 'Beverages', subgroup: 'Tea & Coffee', brand: 'Ispahani', purchaseCost: 175, sellPrice: 210, reorderLevel: 20, popularityWeight: 6, unitType: 'pack' },
        { sku: 'GRO-COFFEE-50', name: 'Instant Coffee 50g', group: 'Beverages', subgroup: 'Tea & Coffee', brand: 'Nescafe', purchaseCost: 210, sellPrice: 250, reorderLevel: 12, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'GRO-SOFT-COL', name: 'Cola Soft Drink 1L', group: 'Beverages', subgroup: 'Soft Drinks', brand: 'Coca-Cola', purchaseCost: 65, sellPrice: 85, reorderLevel: 24, popularityWeight: 7, unitType: 'pcs' },
        { sku: 'GRO-JUICE-MNG', name: 'Mango Juice 250ml', group: 'Beverages', subgroup: 'Juice', brand: 'Pran', purchaseCost: 22, sellPrice: 30, reorderLevel: 30, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'GRO-WATER-1L', name: 'Drinking Water 1L', group: 'Beverages', subgroup: 'Water', brand: 'Mum', purchaseCost: 14, sellPrice: 20, reorderLevel: 40, popularityWeight: 6, unitType: 'pcs' },

        // Snacks & Confectionery
        { sku: 'GRO-BISC-500', name: 'Biscuits Family Pack 500g', group: 'Snacks & Confectionery', subgroup: 'Biscuits', brand: 'Olympic', purchaseCost: 78, sellPrice: 100, reorderLevel: 25, popularityWeight: 7, unitType: 'pack' },
        { sku: 'GRO-CHIPS-PS', name: 'Potato Chips 45g', group: 'Snacks & Confectionery', subgroup: 'Chips', brand: 'Mr. Twist', purchaseCost: 15, sellPrice: 20, reorderLevel: 40, popularityWeight: 6, unitType: 'pcs' },
        { sku: 'GRO-NOODL-PK', name: 'Instant Noodles 8-pack', group: 'Snacks & Confectionery', subgroup: 'Noodles', brand: 'Maggi', purchaseCost: 130, sellPrice: 160, reorderLevel: 20, popularityWeight: 8, unitType: 'pack' },
        { sku: 'GRO-CHOC-BAR', name: 'Chocolate Bar 40g', group: 'Snacks & Confectionery', subgroup: 'Chocolate', brand: 'Cadbury', purchaseCost: 45, sellPrice: 60, reorderLevel: 30, popularityWeight: 4, unitType: 'pcs' },

        // Personal Care
        { sku: 'GRO-SOAP-LFB', name: 'Bath Soap 100g', group: 'Personal Care', subgroup: 'Soap', brand: 'Lifebuoy', purchaseCost: 32, sellPrice: 45, reorderLevel: 40, popularityWeight: 8, unitType: 'pcs' },
        { sku: 'GRO-SHMP-SAC', name: 'Shampoo Sachet 12-pack', group: 'Personal Care', subgroup: 'Hair Care', brand: 'Sunsilk', purchaseCost: 55, sellPrice: 72, reorderLevel: 25, popularityWeight: 5, unitType: 'pack' },
        { sku: 'GRO-TOOTH-PST', name: 'Toothpaste 100g', group: 'Personal Care', subgroup: 'Oral Care', brand: 'Pepsodent', purchaseCost: 62, sellPrice: 85, reorderLevel: 25, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'GRO-TOOTH-BR', name: 'Toothbrush', group: 'Personal Care', subgroup: 'Oral Care', brand: 'Magic', purchaseCost: 20, sellPrice: 35, reorderLevel: 30, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'GRO-HANDWASH', name: 'Hand Wash 200ml', group: 'Personal Care', subgroup: 'Hygiene', brand: 'Dettol', purchaseCost: 95, sellPrice: 125, reorderLevel: 15, popularityWeight: 3, unitType: 'pcs' },

        // Household & Cleaning
        { sku: 'GRO-DET-WHL5', name: 'Detergent Powder 500g', group: 'Household', subgroup: 'Cleaning', brand: 'Wheel', purchaseCost: 60, sellPrice: 80, reorderLevel: 30, popularityWeight: 8, unitType: 'pack' },
        { sku: 'GRO-DET-BAR', name: 'Washing Bar Soap', group: 'Household', subgroup: 'Cleaning', brand: 'Wheel', purchaseCost: 22, sellPrice: 32, reorderLevel: 40, popularityWeight: 6, unitType: 'pcs' },
        { sku: 'GRO-DISH-500', name: 'Dishwashing Liquid 500ml', group: 'Household', subgroup: 'Cleaning', brand: 'Vim', purchaseCost: 85, sellPrice: 110, reorderLevel: 20, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'GRO-FLOOR-CLN', name: 'Floor Cleaner 500ml', group: 'Household', subgroup: 'Cleaning', brand: 'Harpic', purchaseCost: 95, sellPrice: 125, reorderLevel: 15, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'GRO-TISSUE-PK', name: 'Tissue Box 100 sheets', group: 'Household', subgroup: 'Paper Goods', brand: 'Fresh', purchaseCost: 45, sellPrice: 60, reorderLevel: 25, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'GRO-MATCH-10', name: 'Match Box 10-pack', group: 'Household', subgroup: 'Misc', brand: null, purchaseCost: 25, sellPrice: 35, reorderLevel: 30, popularityWeight: 3, unitType: 'pack' },
        { sku: 'GRO-CANDLE-6', name: 'Candles 6-pack', group: 'Household', subgroup: 'Misc', brand: null, purchaseCost: 30, sellPrice: 45, reorderLevel: 20, popularityWeight: 2, unitType: 'pack' },

        // Baby & Misc
        { sku: 'GRO-DIAPER-M', name: 'Baby Diapers Medium 10-pack', group: 'Baby Care', subgroup: 'Diapers', brand: 'Pampers', purchaseCost: 220, sellPrice: 270, reorderLevel: 15, popularityWeight: 4, unitType: 'pack' },
        { sku: 'GRO-BABY-PWD', name: 'Baby Powder 100g', group: 'Baby Care', subgroup: 'Baby Care', brand: 'Johnson', purchaseCost: 110, sellPrice: 140, reorderLevel: 12, popularityWeight: 2, unitType: 'pcs' },
        { sku: 'GRO-HONEY-250', name: 'Pure Honey 250g', group: 'Cooking Essentials', subgroup: 'Specialty', brand: 'Dabur', purchaseCost: 190, sellPrice: 240, reorderLevel: 10, popularityWeight: 2, unitType: 'pcs' },
        { sku: 'GRO-KETCH-340', name: 'Tomato Ketchup 340g', group: 'Cooking Essentials', subgroup: 'Sauces', brand: 'Pran', purchaseCost: 75, sellPrice: 100, reorderLevel: 15, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'GRO-VERM-200', name: 'Vermicelli 200g', group: 'Rice & Grains', subgroup: 'Specialty', brand: 'Banoful', purchaseCost: 35, sellPrice: 50, reorderLevel: 15, popularityWeight: 3, unitType: 'pack' },
    ],
};
