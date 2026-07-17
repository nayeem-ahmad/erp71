/**
 * Bangladeshi name pools for demo customers and suppliers, plus phone-number
 * synthesis. Kept deliberately generic (common given/family names, realistic
 * operator prefixes) so generated data reads as plausible without resembling any
 * real person or business.
 */

const GIVEN_NAMES = [
    'Rahim', 'Karim', 'Jamal', 'Kamal', 'Nasrin', 'Farida', 'Shafiqul', 'Habib',
    'Salma', 'Rubel', 'Sohel', 'Tanvir', 'Mizanur', 'Anwar', 'Rashida', 'Nabila',
    'Imran', 'Sabbir', 'Hasan', 'Rokeya', 'Delwar', 'Parvez', 'Shahin', 'Munni',
    'Faruk', 'Jahangir', 'Selina', 'Ruhul', 'Aminul', 'Shirin', 'Bashir', 'Momena',
    'Golam', 'Nazma', 'Riaz', 'Sharmin', 'Alamgir', 'Ferdous', 'Lutfor', 'Rojina',
];

const FAMILY_NAMES = [
    'Uddin', 'Hossain', 'Akter', 'Begum', 'Islam', 'Ahmed', 'Rahman', 'Khan',
    'Chowdhury', 'Miah', 'Sarkar', 'Talukder', 'Bhuiyan', 'Molla', 'Sheikh',
    'Mahmud', 'Alam', 'Haque', 'Kabir', 'Siddique',
];

const BUSINESS_PREFIXES = [
    'Bismillah', 'Al-Amin', 'New', 'Modern', 'National', 'City', 'Star', 'United',
    'Janata', 'Padma', 'Meghna', 'Sonar Bangla', 'Rupali', 'Green', 'Prime',
    'Popular', 'Standard', 'Metro', 'Dhaka', 'Sunrise',
];

const BUSINESS_SUFFIXES = [
    'Traders', 'Enterprise', 'Trading', 'Distribution', 'Suppliers', 'Corporation',
    'Agencies', 'Stores', '& Sons', 'Import Export', 'Wholesale', 'Marketing',
];

const MOBILE_PREFIXES = ['013', '014', '015', '016', '017', '018', '019'];

interface Picker {
    int(min: number, max: number): number;
    pick<T>(items: readonly T[]): T;
}

/** A named individual customer, e.g. "Nasrin Akter". */
export function personName(rng: Picker): string {
    return `${rng.pick(GIVEN_NAMES)} ${rng.pick(FAMILY_NAMES)}`;
}

/** A business/supplier name, e.g. "Al-Amin Traders". */
export function businessName(rng: Picker): string {
    return `${rng.pick(BUSINESS_PREFIXES)} ${rng.pick(BUSINESS_SUFFIXES)}`;
}

/**
 * A Bangladeshi mobile number: operator prefix + 8 digits, 11 total.
 * `seq` guarantees uniqueness within a run (phone is a per-tenant unique key on
 * Customer), while the operator prefix keeps it realistic.
 */
export function phoneNumber(rng: Picker, seq: number): string {
    const prefix = rng.pick(MOBILE_PREFIXES);
    // 8 remaining digits; embed seq to guarantee uniqueness, pad the rest randomly.
    const tail = String(seq % 100000000).padStart(8, '0');
    return `${prefix}${tail}`;
}
