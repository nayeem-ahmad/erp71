/**
 * Bangladesh's traditional units beside the metric ones.
 *
 * Each unit is a factor to its category's base unit (gram, inch, square
 * foot). The standard values are the ones the British-era Indian system
 * fixed and Bangladeshi trade still uses: a tola (ভরি) of 11.664 g, a seer of
 * 80 tola, a maund of 40 seer; a kattha of 720 sq ft, a bigha of 20 kattha.
 * Some of these vary by district — a "local" bigha or kani can be larger — so
 * the page says the values are the standard ones.
 */

export type UnitCategory = 'weight' | 'gold' | 'length' | 'land';

export interface UnitDef {
    id: string;
    /** Bangla name, shown beside the English one. */
    bn: string;
    en: string;
    /** How many base units one of this unit is. */
    factor: number;
}

const TOLA_G = 11.664;
const SEER_G = 80 * TOLA_G; // 933.12 g
const MAUND_G = 40 * SEER_G; // 37.3248 kg

export const UNITS: Record<UnitCategory, { base: string; units: UnitDef[] }> = {
    weight: {
        base: 'g',
        units: [
            { id: 'maund', bn: 'মণ', en: 'Maund', factor: MAUND_G },
            { id: 'seer', bn: 'সের', en: 'Seer', factor: SEER_G },
            { id: 'poa', bn: 'পোয়া', en: 'Poa (¼ seer)', factor: SEER_G / 4 },
            { id: 'chhatak', bn: 'ছটাক', en: 'Chhatak', factor: SEER_G / 16 },
            { id: 'tola', bn: 'তোলা', en: 'Tola', factor: TOLA_G },
            { id: 'kg', bn: 'কেজি', en: 'Kilogram', factor: 1000 },
            { id: 'g', bn: 'গ্রাম', en: 'Gram', factor: 1 },
            { id: 'lb', bn: 'পাউন্ড', en: 'Pound', factor: 453.59237 },
            { id: 'ton', bn: 'মেট্রিক টন', en: 'Metric ton', factor: 1_000_000 },
        ],
    },
    gold: {
        base: 'g',
        units: [
            { id: 'vori', bn: 'ভরি', en: 'Vori (tola)', factor: TOLA_G },
            { id: 'ana', bn: 'আনা', en: 'Ana', factor: TOLA_G / 16 },
            { id: 'roti', bn: 'রতি', en: 'Roti', factor: TOLA_G / 96 },
            { id: 'point', bn: 'পয়েন্ট', en: 'Point', factor: TOLA_G / 960 },
            { id: 'g', bn: 'গ্রাম', en: 'Gram', factor: 1 },
            { id: 'mg', bn: 'মিলিগ্রাম', en: 'Milligram', factor: 0.001 },
        ],
    },
    length: {
        base: 'in',
        units: [
            { id: 'goj', bn: 'গজ', en: 'Goj (yard)', factor: 36 },
            { id: 'haat', bn: 'হাত', en: 'Haat (cubit)', factor: 18 },
            { id: 'ft', bn: 'ফুট', en: 'Foot', factor: 12 },
            { id: 'in', bn: 'ইঞ্চি', en: 'Inch', factor: 1 },
            { id: 'm', bn: 'মিটার', en: 'Metre', factor: 39.37007874 },
            { id: 'cm', bn: 'সেন্টিমিটার', en: 'Centimetre', factor: 0.3937007874 },
        ],
    },
    land: {
        base: 'sqft',
        units: [
            { id: 'acre', bn: 'একর', en: 'Acre', factor: 43_560 },
            { id: 'bigha', bn: 'বিঘা', en: 'Bigha', factor: 14_400 },
            { id: 'kattha', bn: 'কাঠা', en: 'Kattha', factor: 720 },
            { id: 'decimal', bn: 'শতাংশ', en: 'Decimal (shotok)', factor: 435.6 },
            { id: 'ojutangsho', bn: 'অযুতাংশ', en: 'Ojutangsho', factor: 4.356 },
            { id: 'sqft', bn: 'বর্গফুট', en: 'Square foot', factor: 1 },
            { id: 'sqm', bn: 'বর্গমিটার', en: 'Square metre', factor: 10.7639104 },
        ],
    },
};

export function findUnit(category: UnitCategory, id: string): UnitDef | undefined {
    return UNITS[category].units.find((unit) => unit.id === id);
}

/** `value` of `from` expressed in `to`. */
export function convertUnit(category: UnitCategory, value: number, from: string, to: string): number {
    const a = findUnit(category, from);
    const b = findUnit(category, to);
    if (!a || !b || !Number.isFinite(value)) return NaN;
    return (value * a.factor) / b.factor;
}

/**
 * A price per `from` as a price per `to`. The other way round from a
 * quantity: rice at ৳2,400 a maund is ৳64.30 a kg.
 */
export function convertPrice(category: UnitCategory, pricePerFrom: number, from: string, to: string): number {
    const a = findUnit(category, from);
    const b = findUnit(category, to);
    if (!a || !b || !Number.isFinite(pricePerFrom)) return NaN;
    return (pricePerFrom / a.factor) * b.factor;
}

/** Up to `digits` decimals, trailing zeros dropped: 1.5, not 1.500000. */
export function formatQuantity(value: number, digits = 4): string {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value);
}
