import type { DemoCatalog } from './types';

/**
 * COMPUTER_HARDWARE demo catalog — components, peripherals, and accessories for a
 * Bangladeshi computer/IT retail shop, BDT-priced. Accessories and consumables
 * are the fast movers; high-value components (GPUs, CPUs) are the long tail.
 */
export const computerHardwareCatalog: DemoCatalog = {
    businessType: 'COMPUTER_HARDWARE',
    products: [
        // Storage
        { sku: 'CMP-SSD-240', name: 'SSD 240GB SATA', group: 'Storage', subgroup: 'Solid State Drives', brand: 'Walton', purchaseCost: 1650, sellPrice: 1950, reorderLevel: 12, popularityWeight: 7, unitType: 'pcs' },
        { sku: 'CMP-SSD-512', name: 'SSD 512GB NVMe', group: 'Storage', subgroup: 'Solid State Drives', brand: 'Samsung', purchaseCost: 3800, sellPrice: 4400, reorderLevel: 8, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'CMP-SSD-1TB', name: 'SSD 1TB NVMe', group: 'Storage', subgroup: 'Solid State Drives', brand: 'WD', purchaseCost: 6800, sellPrice: 7800, reorderLevel: 5, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'CMP-HDD-1TB', name: 'HDD 1TB 7200RPM', group: 'Storage', subgroup: 'Hard Drives', brand: 'Seagate', purchaseCost: 3400, sellPrice: 3900, reorderLevel: 8, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'CMP-PEN-32', name: 'Pen Drive 32GB USB 3.0', group: 'Storage', subgroup: 'Flash Drives', brand: 'SanDisk', purchaseCost: 380, sellPrice: 500, reorderLevel: 30, popularityWeight: 8, unitType: 'pcs' },
        { sku: 'CMP-PEN-64', name: 'Pen Drive 64GB USB 3.0', group: 'Storage', subgroup: 'Flash Drives', brand: 'SanDisk', purchaseCost: 550, sellPrice: 720, reorderLevel: 25, popularityWeight: 6, unitType: 'pcs' },
        { sku: 'CMP-MICROSD', name: 'MicroSD Card 64GB', group: 'Storage', subgroup: 'Memory Cards', brand: 'SanDisk', purchaseCost: 480, sellPrice: 620, reorderLevel: 25, popularityWeight: 6, unitType: 'pcs' },

        // Memory
        { sku: 'CMP-RAM-8', name: 'DDR4 8GB 3200MHz', group: 'Components', subgroup: 'Memory', brand: 'Corsair', purchaseCost: 1900, sellPrice: 2300, reorderLevel: 10, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'CMP-RAM-16', name: 'DDR4 16GB 3200MHz', group: 'Components', subgroup: 'Memory', brand: 'G.Skill', purchaseCost: 3600, sellPrice: 4200, reorderLevel: 8, popularityWeight: 4, unitType: 'pcs' },

        // Core components
        { sku: 'CMP-CPU-I5', name: 'Intel Core i5 Processor', group: 'Components', subgroup: 'Processors', brand: 'Intel', purchaseCost: 15500, sellPrice: 17500, reorderLevel: 4, popularityWeight: 2, unitType: 'pcs' },
        { sku: 'CMP-CPU-R5', name: 'AMD Ryzen 5 Processor', group: 'Components', subgroup: 'Processors', brand: 'AMD', purchaseCost: 14000, sellPrice: 16000, reorderLevel: 4, popularityWeight: 2, unitType: 'pcs' },
        { sku: 'CMP-MOBO-B', name: 'Motherboard B-series', group: 'Components', subgroup: 'Motherboards', brand: 'ASUS', purchaseCost: 9500, sellPrice: 11000, reorderLevel: 5, popularityWeight: 2, unitType: 'pcs' },
        { sku: 'CMP-GPU-1650', name: 'Graphics Card GTX 1650', group: 'Components', subgroup: 'Graphics Cards', brand: 'MSI', purchaseCost: 18500, sellPrice: 21000, reorderLevel: 3, popularityWeight: 1, unitType: 'pcs' },
        { sku: 'CMP-PSU-550', name: 'Power Supply 550W 80+', group: 'Components', subgroup: 'Power Supplies', brand: 'Antec', purchaseCost: 3200, sellPrice: 3800, reorderLevel: 6, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'CMP-CASE-ATX', name: 'ATX Casing with Fan', group: 'Components', subgroup: 'Casings', brand: 'Value-Top', purchaseCost: 2200, sellPrice: 2800, reorderLevel: 6, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'CMP-COOLER', name: 'CPU Air Cooler', group: 'Components', subgroup: 'Cooling', brand: 'Cooler Master', purchaseCost: 1400, sellPrice: 1800, reorderLevel: 8, popularityWeight: 3, unitType: 'pcs' },

        // Peripherals
        { sku: 'CMP-KB-USB', name: 'USB Keyboard', group: 'Peripherals', subgroup: 'Input Devices', brand: 'A4Tech', purchaseCost: 420, sellPrice: 580, reorderLevel: 20, popularityWeight: 7, unitType: 'pcs' },
        { sku: 'CMP-KB-MECH', name: 'Mechanical Gaming Keyboard', group: 'Peripherals', subgroup: 'Input Devices', brand: 'Redragon', purchaseCost: 2200, sellPrice: 2800, reorderLevel: 10, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'CMP-MOUSE', name: 'USB Optical Mouse', group: 'Peripherals', subgroup: 'Input Devices', brand: 'A4Tech', purchaseCost: 260, sellPrice: 380, reorderLevel: 30, popularityWeight: 8, unitType: 'pcs' },
        { sku: 'CMP-MOUSE-GM', name: 'Gaming Mouse RGB', group: 'Peripherals', subgroup: 'Input Devices', brand: 'Logitech', purchaseCost: 1400, sellPrice: 1800, reorderLevel: 12, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'CMP-COMBO', name: 'Keyboard + Mouse Combo', group: 'Peripherals', subgroup: 'Input Devices', brand: 'Logitech', purchaseCost: 900, sellPrice: 1200, reorderLevel: 15, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'CMP-MON-22', name: '22" LED Monitor', group: 'Peripherals', subgroup: 'Monitors', brand: 'Dell', purchaseCost: 9500, sellPrice: 11000, reorderLevel: 5, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'CMP-MON-24', name: '24" IPS Monitor', group: 'Peripherals', subgroup: 'Monitors', brand: 'LG', purchaseCost: 13500, sellPrice: 15500, reorderLevel: 4, popularityWeight: 2, unitType: 'pcs' },
        { sku: 'CMP-WEBCAM', name: 'HD Webcam 1080p', group: 'Peripherals', subgroup: 'Cameras', brand: 'Logitech', purchaseCost: 1800, sellPrice: 2300, reorderLevel: 10, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'CMP-HEADSET', name: 'Gaming Headset', group: 'Peripherals', subgroup: 'Audio', brand: 'Havit', purchaseCost: 850, sellPrice: 1150, reorderLevel: 15, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'CMP-SPKR', name: 'Desktop Speaker 2.0', group: 'Peripherals', subgroup: 'Audio', brand: 'Microlab', purchaseCost: 700, sellPrice: 950, reorderLevel: 15, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'CMP-PRINTER', name: 'Inkjet Printer', group: 'Peripherals', subgroup: 'Printers', brand: 'Canon', purchaseCost: 6500, sellPrice: 7800, reorderLevel: 5, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'CMP-INK-BLK', name: 'Printer Ink Cartridge Black', group: 'Peripherals', subgroup: 'Printers', brand: 'Canon', purchaseCost: 550, sellPrice: 750, reorderLevel: 25, popularityWeight: 6, unitType: 'pcs' },

        // Networking
        { sku: 'CMP-ROUTER', name: 'WiFi Router Dual Band', group: 'Networking', subgroup: 'Routers', brand: 'TP-Link', purchaseCost: 1800, sellPrice: 2300, reorderLevel: 12, popularityWeight: 6, unitType: 'pcs' },
        { sku: 'CMP-SWITCH', name: '8-Port Network Switch', group: 'Networking', subgroup: 'Switches', brand: 'TP-Link', purchaseCost: 1100, sellPrice: 1450, reorderLevel: 10, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'CMP-LAN-CBL', name: 'CAT6 LAN Cable (per meter)', group: 'Networking', subgroup: 'Cables', brand: null, purchaseCost: 25, sellPrice: 40, reorderLevel: 50, popularityWeight: 6, unitType: 'metre' },
        { sku: 'CMP-USB-WIFI', name: 'USB WiFi Adapter', group: 'Networking', subgroup: 'Adapters', brand: 'TP-Link', purchaseCost: 550, sellPrice: 750, reorderLevel: 20, popularityWeight: 5, unitType: 'pcs' },

        // Cables & Accessories
        { sku: 'CMP-HDMI-CBL', name: 'HDMI Cable 1.5m', group: 'Accessories', subgroup: 'Cables', brand: null, purchaseCost: 180, sellPrice: 280, reorderLevel: 30, popularityWeight: 7, unitType: 'pcs' },
        { sku: 'CMP-USBC-CBL', name: 'USB-C Data Cable', group: 'Accessories', subgroup: 'Cables', brand: 'Walton', purchaseCost: 120, sellPrice: 200, reorderLevel: 40, popularityWeight: 8, unitType: 'pcs' },
        { sku: 'CMP-VGA-CBL', name: 'VGA Cable 1.5m', group: 'Accessories', subgroup: 'Cables', brand: null, purchaseCost: 150, sellPrice: 240, reorderLevel: 25, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'CMP-POWER-CBL', name: 'Power Cable 3-pin', group: 'Accessories', subgroup: 'Cables', brand: null, purchaseCost: 80, sellPrice: 140, reorderLevel: 30, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'CMP-MOUSEPAD', name: 'Mouse Pad', group: 'Accessories', subgroup: 'Desk Accessories', brand: null, purchaseCost: 60, sellPrice: 120, reorderLevel: 40, popularityWeight: 6, unitType: 'pcs' },
        { sku: 'CMP-USB-HUB', name: 'USB 3.0 4-Port Hub', group: 'Accessories', subgroup: 'Adapters', brand: 'Orico', purchaseCost: 380, sellPrice: 520, reorderLevel: 20, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'CMP-CLEANER', name: 'Screen Cleaning Kit', group: 'Accessories', subgroup: 'Maintenance', brand: null, purchaseCost: 90, sellPrice: 150, reorderLevel: 20, popularityWeight: 3, unitType: 'pcs' },
        { sku: 'CMP-THERMAL', name: 'Thermal Paste', group: 'Accessories', subgroup: 'Maintenance', brand: 'Cooler Master', purchaseCost: 120, sellPrice: 200, reorderLevel: 20, popularityWeight: 3, unitType: 'pcs' },

        // Power & backup
        { sku: 'CMP-UPS-650', name: 'UPS 650VA', group: 'Power', subgroup: 'UPS', brand: 'Value-Top', purchaseCost: 2600, sellPrice: 3200, reorderLevel: 6, popularityWeight: 4, unitType: 'pcs' },
        { sku: 'CMP-PWR-STRIP', name: 'Power Strip 6-Socket', group: 'Power', subgroup: 'Surge Protection', brand: null, purchaseCost: 320, sellPrice: 450, reorderLevel: 20, popularityWeight: 5, unitType: 'pcs' },

        // Mobile accessories
        { sku: 'CMP-PWRBANK', name: 'Power Bank 10000mAh', group: 'Mobile Accessories', subgroup: 'Chargers', brand: 'Xiaomi', purchaseCost: 1100, sellPrice: 1450, reorderLevel: 15, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'CMP-CHARGER', name: 'Fast Charger 20W', group: 'Mobile Accessories', subgroup: 'Chargers', brand: 'Walton', purchaseCost: 320, sellPrice: 480, reorderLevel: 25, popularityWeight: 6, unitType: 'pcs' },
        { sku: 'CMP-EARBUDS', name: 'Wireless Earbuds', group: 'Mobile Accessories', subgroup: 'Audio', brand: 'Havit', purchaseCost: 950, sellPrice: 1300, reorderLevel: 15, popularityWeight: 5, unitType: 'pcs' },
        { sku: 'CMP-SCRNGRD', name: 'Tempered Glass Protector', group: 'Mobile Accessories', subgroup: 'Protection', brand: null, purchaseCost: 40, sellPrice: 120, reorderLevel: 50, popularityWeight: 7, unitType: 'pcs' },
    ],
};
