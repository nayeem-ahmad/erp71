import {
    BarChart3, BookOpen, Factory, Globe, Package, ShoppingCart, Store, Truck, Users, Wallet, Wrench,
} from 'lucide-react';

export const HOW_IT_WORKS = [
    {
        step: '01',
        title: 'Create your workspace',
        description: 'Sign up in minutes with your business name, branch, and preferred plan. No credit card required.',
    },
    {
        step: '02',
        title: 'Add products & stock',
        description: 'Import or add products, set your prices, and configure warehouses for accurate inventory.',
    },
    {
        step: '03',
        title: 'Sell from POS',
        description: 'Ring up sales with barcode scan, split payments, and automatic stock deduction in real time.',
    },
    {
        step: '04',
        title: 'Track & grow',
        description: 'Monitor revenue, margins, and branch performance — then scale to accounting and storefront.',
    },
] as const;

export const FEATURES = [
    {
        icon: ShoppingCart,
        title: 'Point of Sale',
        desc: 'Fast, reliable POS with barcode scanning, split payments, and real-time inventory sync.',
    },
    {
        icon: Package,
        title: 'Inventory Control',
        desc: 'Multi-warehouse stock tracking, reorder alerts, and full movement history.',
    },
    {
        icon: BarChart3,
        title: 'Sales Analytics',
        desc: 'Revenue reports, top-selling products, and cashier performance — all in real time.',
    },
    {
        icon: Users,
        title: 'Customer Management',
        desc: 'Build customer profiles, track purchase history, and run targeted promotions.',
    },
    {
        icon: Wallet,
        title: 'Integrated Payments',
        desc: 'Take cash, cards and mobile wallets — reconciled automatically.',
    },
    {
        icon: Globe,
        title: 'Multi-Tenant SaaS',
        desc: 'Each business gets an isolated workspace. Scale from one store to a whole chain.',
    },
] as const;

export const MODULES = [
    {
        icon: ShoppingCart,
        title: 'POS & Checkout',
        desc: 'Touch-friendly terminal built for busy counters. Offline-tolerant with instant sync when back online.',
        bullets: ['Barcode & SKU search', 'Split & partial payments', 'Receipt print & email'],
    },
    {
        icon: Package,
        title: 'Inventory & Purchasing',
        desc: 'Know exactly what is on hand across warehouses, branches, and in transit.',
        bullets: ['Stock transfers', 'Purchase orders', 'Low-stock alerts'],
    },
    {
        icon: BookOpen,
        title: 'Accounting',
        desc: 'Full double-entry books with chart of accounts, journals, a tax ledger and the reports your accountant asks for.',
        bullets: ['P&L & balance sheet', 'Bank reconciliation', 'Tax-ready reporting'],
    },
    {
        icon: Store,
        title: 'Online Storefront',
        desc: 'Publish a branded shop for customers to browse and order — synced with your live inventory.',
        bullets: ['Custom domain ready', 'Delivery zones', 'Order-to-POS flow'],
    },
] as const;

export const PAYMENT_METHODS = [
    { name: 'Cash', tone: 'bg-gray-100 text-gray-700' },
    { name: 'Cards', tone: 'bg-blue-100 text-blue-700' },
    { name: 'Bank transfer', tone: 'bg-slate-100 text-slate-700' },
    { name: 'bKash', tone: 'bg-pink-100 text-pink-700' },
    { name: 'Nagad', tone: 'bg-orange-100 text-orange-700' },
    { name: 'SSLCommerz', tone: 'bg-indigo-100 text-indigo-700' },
] as const;

/** Icons for the use-case cards; the copy lives in the message catalog. */
export const USE_CASES = [
    { icon: ShoppingCart },
    { icon: Truck },
    { icon: Wrench },
    { icon: Factory },
] as const;

export const TRUST_BADGES = [
    'Your data stays yours',
    'Role-based access',
    'Audit logs',
    'Export anytime',
] as const;