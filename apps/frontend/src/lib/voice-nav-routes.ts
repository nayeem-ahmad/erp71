export type VoiceNavTargetId =
    | 'dashboard'
    | 'sales-entry'
    | 'pos'
    | 'sales'
    | 'all-sales'
    | 'customer-payment'
    | 'supplier-payment'
    | 'customer-ledger'
    | 'supplier-ledger'
    | 'expense-entry'
    | 'voucher-entry'
    | 'purchase-entry'
    | 'purchases'
    | 'sales-order'
    | 'sales-quote'
    | 'sales-return'
    | 'purchase-order'
    | 'purchase-quote'
    | 'purchase-return'
    | 'products'
    | 'customers'
    | 'suppliers'
    | 'inventory'
    | 'crm'
    | 'leads'
    | 'lead-entry'
    | 'contacts'
    | 'crm-activities'
    | 'crm-campaigns'
    | 'projects'
    | 'tasks'
    | 'sprints'
    | 'project-boards'
    | 'hour-logs'
    | 'hr'
    | 'employees'
    | 'attendance'
    | 'leaves'
    | 'salary-payments';

export interface VoiceNavRoute {
    id: VoiceNavTargetId;
    path: string;
    aliases: string[];
}

/** Phrase → route map for global voice navigation. Aliases are normalized before matching. */
export const VOICE_NAV_ROUTES: VoiceNavRoute[] = [
    {
        id: 'dashboard',
        path: '/dashboard',
        aliases: ['dashboard', 'home', 'business monitor', 'ড্যাশবোর্ড', 'হোম'],
    },
    {
        id: 'sales-entry',
        path: '/sales/new',
        aliases: [
            'sales entry',
            'new sales entry',
            'new sale',
            'new sales',
            'sale entry',
            'create sale',
            'সেলস এন্ট্রি',
            'নতুন সেলস',
            'বিক্রয় এন্ট্রি',
            'entri jualan',
            'jualan baru',
        ],
    },
    {
        id: 'pos',
        path: '/sales/pos',
        aliases: ['pos', 'point of sale', 'cash register', 'ক্যাশ', 'পস'],
    },
    {
        id: 'sales',
        path: '/sales',
        aliases: ['sales', 'sales overview', 'বিক্রয়', 'jualan'],
    },
    {
        id: 'all-sales',
        path: '/sales/list',
        aliases: ['all sales', 'sales list', 'sales history', 'সব বিক্রয়'],
    },
    {
        id: 'customer-payment',
        path: '/sales/customer-payments',
        aliases: [
            'customer payment',
            'customer payments',
            'receive payment',
            'কাস্টমার পেমেন্ট',
            'গ্রাহক পেমেন্ট',
            'bayaran pelanggan',
        ],
    },
    {
        id: 'supplier-payment',
        path: '/purchases/supplier-payments',
        aliases: [
            'supplier payment',
            'supplier payments',
            'pay supplier',
            'সাপ্লায়ার পেমেন্ট',
            'সরবরাহকারী পেমেন্ট',
            'bayaran pembekal',
        ],
    },
    {
        id: 'customer-ledger',
        path: '/sales/customer-ledger',
        aliases: ['customer ledger', 'customer account', 'কাস্টমার লেজার', 'গ্রাহক খাতা'],
    },
    {
        id: 'supplier-ledger',
        path: '/purchases/supplier-ledger',
        aliases: ['supplier ledger', 'supplier account', 'সাপ্লায়ার লেজার'],
    },
    {
        id: 'expense-entry',
        path: '/accounting/expenses?new=1',
        aliases: [
            'expense entry',
            'new expense',
            'add expense',
            'expenses',
            'খরচ এন্ট্রি',
            'খরচ',
            'entri perbelanjaan',
            'perbelanjaan',
        ],
    },
    {
        id: 'voucher-entry',
        path: '/accounting/vouchers/new',
        aliases: ['voucher entry', 'new voucher', 'journal voucher', 'ভাউচার', 'ভাউচার এন্ট্রি'],
    },
    {
        id: 'purchase-entry',
        path: '/purchases/list?new=1',
        aliases: [
            'purchase entry',
            'new purchase',
            'create purchase',
            'ক্রয় এন্ট্রি',
            'নতুন ক্রয়',
            'entri pembelian',
            'pembelian baru',
        ],
    },
    {
        id: 'purchases',
        path: '/purchases',
        aliases: ['purchases', 'purchase overview', 'ক্রয়', 'pembelian'],
    },
    {
        id: 'sales-order',
        path: '/sales/orders',
        aliases: ['sales order', 'sales orders', 'order entry', 'সেলস অর্ডার', 'বিক্রয় অর্ডার'],
    },
    {
        id: 'sales-quote',
        path: '/sales/quotes',
        aliases: ['sales quote', 'sales quotation', 'quotation', 'কোট', 'কোটেশন'],
    },
    {
        id: 'sales-return',
        path: '/sales/returns',
        aliases: ['sales return', 'sales returns', 'return', 'সেলস রিটার্ন', 'ফেরত'],
    },
    {
        id: 'purchase-order',
        path: '/purchases/orders',
        aliases: ['purchase order', 'purchase orders', 'ক্রয় অর্ডার'],
    },
    {
        id: 'purchase-quote',
        path: '/purchases/quotations',
        aliases: ['purchase quotation', 'purchase quote', 'rfq', 'ক্রয় কোট'],
    },
    {
        id: 'purchase-return',
        path: '/purchases/returns',
        aliases: ['purchase return', 'purchase returns', 'ক্রয় ফেরত'],
    },
    {
        id: 'products',
        path: '/inventory/products',
        aliases: ['products', 'inventory products', 'product list', 'পণ্য', 'প্রোডাক্ট'],
    },
    {
        id: 'customers',
        path: '/sales/customers',
        aliases: ['customers', 'customer list', 'গ্রাহক', 'কাস্টমার', 'pelanggan'],
    },
    {
        id: 'suppliers',
        path: '/purchases/suppliers',
        aliases: ['suppliers', 'supplier list', 'সরবরাহকারী', 'সাপ্লায়ার', 'pembekal'],
    },
    {
        id: 'inventory',
        path: '/inventory',
        aliases: ['inventory', 'stock', 'ইনভেন্টরি', 'স্টক', 'inventori'],
    },
    {
        id: 'crm',
        path: '/crm',
        aliases: ['crm', 'crm dashboard', 'সিআরএম'],
    },
    {
        id: 'leads',
        path: '/crm/leads',
        aliases: ['leads', 'lead', 'lead list', 'all leads', 'লিড', 'লিড তালিকা', 'prospek'],
    },
    {
        id: 'lead-entry',
        path: '/crm/leads/new',
        aliases: [
            'new lead',
            'add lead',
            'create lead',
            'lead entry',
            'নতুন লিড',
            'লিড এন্ট্রি',
            'prospek baharu',
        ],
    },
    {
        id: 'contacts',
        path: '/crm/contacts',
        aliases: ['contacts', 'contact', 'contact list', 'কন্টাক্ট', 'kenalan'],
    },
    {
        id: 'crm-activities',
        path: '/crm/activities',
        aliases: [
            'activities',
            'activity',
            'crm activities',
            'follow up',
            'follow ups',
            'ফলো আপ',
            'কার্যক্রম',
        ],
    },
    {
        id: 'crm-campaigns',
        path: '/crm/campaigns',
        aliases: ['campaigns', 'campaign', 'ক্যাম্পেইন', 'kempen'],
    },
    {
        id: 'projects',
        path: '/projects',
        aliases: ['projects', 'project', 'project list', 'all projects', 'প্রকল্প', 'প্রজেক্ট', 'projek'],
    },
    {
        id: 'tasks',
        path: '/projects/tasks',
        aliases: ['tasks', 'task', 'task list', 'my tasks', 'টাস্ক', 'কাজ', 'tugasan'],
    },
    {
        id: 'sprints',
        path: '/projects/sprints',
        aliases: ['sprints', 'sprint', 'স্প্রিন্ট'],
    },
    {
        id: 'project-boards',
        path: '/projects/boards',
        aliases: ['boards', 'board', 'project board', 'project boards', 'kanban', 'বোর্ড'],
    },
    {
        id: 'hour-logs',
        path: '/projects/hour-logs',
        aliases: [
            'hour log',
            'hour logs',
            'time log',
            'time logs',
            'timesheet',
            'log hours',
            'ঘণ্টা লগ',
            'log jam',
        ],
    },
    {
        id: 'hr',
        path: '/hr',
        aliases: ['hr', 'human resources', 'এইচআর'],
    },
    {
        id: 'employees',
        path: '/hr/employees',
        aliases: ['employees', 'employee', 'employee list', 'staff', 'কর্মচারী', 'pekerja'],
    },
    {
        id: 'attendance',
        path: '/hr/attendance',
        aliases: ['attendance', 'উপস্থিতি', 'হাজিরা', 'kehadiran'],
    },
    {
        id: 'leaves',
        path: '/hr/leaves',
        aliases: ['leaves', 'leave', 'leave request', 'ছুটি', 'cuti'],
    },
    {
        id: 'salary-payments',
        path: '/hr/salary-payments',
        aliases: ['salary payment', 'salary payments', 'payroll', 'salary', 'বেতন', 'বেতন প্রদান', 'gaji'],
    },
];
