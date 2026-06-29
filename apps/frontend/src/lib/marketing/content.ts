import {
    BarChart3, BookOpen, Globe, Package, Receipt, ShoppingCart, Store, Users, Wallet,
} from 'lucide-react';

export const HERO_STATS = [
    { value: '500+', label: 'Active stores' },
    { value: '৳ 2Cr+', label: 'Sales processed daily' },
    { value: '99.9%', label: 'Uptime SLA' },
    { value: '< 1s', label: 'POS transaction time' },
] as const;

export const HOW_IT_WORKS = [
    {
        step: '01',
        title: 'Create your workspace',
        description: 'Sign up in minutes with your business name, branch, and preferred plan. No credit card required.',
    },
    {
        step: '02',
        title: 'Add products & stock',
        description: 'Import or add products, set prices in BDT, and configure warehouses for accurate inventory.',
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
        desc: 'Accept bKash, Nagad, SSL Wireless, and cash — reconciled automatically.',
    },
    {
        icon: Globe,
        title: 'Multi-Tenant SaaS',
        desc: 'Each business gets an isolated workspace. Scale from one store to a nationwide chain.',
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
        desc: 'Full double-entry books with COA, journals, VAT ledger, and financial reports for Bangladesh.',
        bullets: ['P&L & balance sheet', 'Bank reconciliation', 'NBR-ready VAT report'],
    },
    {
        icon: Store,
        title: 'Online Storefront',
        desc: 'Publish a branded shop for customers to browse and order — synced with your live inventory.',
        bullets: ['Custom domain ready', 'Delivery zones', 'Order-to-POS flow'],
    },
] as const;

export const PAYMENT_METHODS = [
    { name: 'bKash', tone: 'bg-pink-100 text-pink-700' },
    { name: 'Nagad', tone: 'bg-orange-100 text-orange-700' },
    { name: 'SSLCommerz', tone: 'bg-indigo-100 text-indigo-700' },
    { name: 'Cash', tone: 'bg-gray-100 text-gray-700' },
    { name: 'Cards', tone: 'bg-blue-100 text-blue-700' },
] as const;

export const TESTIMONIALS = [
    {
        name: 'Rahim Uddin',
        role: 'Owner, Rahim Electronics, Dhaka',
        quote: 'Switched from paper ledgers to ERP71 in a week. Our stock accuracy improved overnight.',
        stars: 5,
    },
    {
        name: 'Nasrin Begum',
        role: 'Manager, Fashion House, Chittagong',
        quote: 'The POS is incredibly fast. During Eid rush we processed hundreds of sales without a single hiccup.',
        stars: 5,
    },
    {
        name: 'Kamal Hossain',
        role: 'Director, KH Supermart, Sylhet',
        quote: 'Multi-location inventory was our biggest headache. Now we can see every branch from one dashboard.',
        stars: 5,
    },
] as const;

export const TRUST_BADGES = [
    'Bangladesh-hosted',
    'BDT-native billing',
    'Role-based access',
    'Audit logs',
] as const;