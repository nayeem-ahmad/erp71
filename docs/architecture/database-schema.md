# Database Schema

This document defines the PostgreSQL database schema for the ERP71 platform.

## Overview
The schema is optimized for multi-tenancy using Row-Level Security (RLS). Every table containing business data MUST include a `tenant_id` column to ensure strict isolation.

## Foundation & Multi-Tenancy

```sql
-- --- ENUMS ---
CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'cancelled', 'trialing');
CREATE TYPE user_role AS ENUM ('owner', 'manager', 'cashier', 'accountant');

-- --- TENANTS (Organizations) ---
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- --- SUBSCRIPTION PLANS ---
CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL, -- one of: 'Free', 'Basic', 'Standard', 'Premium'
    code TEXT NOT NULL UNIQUE, -- e.g., 'free', 'basic', 'standard', 'premium'
    monthly_price DECIMAL(12, 2) NOT NULL,
    features_json JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true
);

-- Canonical monthly prices:
-- Free: BDT 0
-- Basic: BDT 499
-- Standard: BDT 999
-- Premium: BDT 1499

-- --- TENANT SUBSCRIPTIONS ---
CREATE TABLE tenant_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    status subscription_status NOT NULL DEFAULT 'trialing',
    current_period_end TIMESTAMPTZ NOT NULL,
    UNIQUE(tenant_id)
);

-- --- STORES ---
CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- --- USER PERMISSIONS ---
CREATE TABLE tenant_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'cashier',
    UNIQUE(tenant_id, user_id)
);
```

## Inventory Module

```sql
-- --- WAREHOUSES ---
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true
);

-- --- CATEGORIZATION ---
CREATE TABLE product_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(tenant_id, name)
);

CREATE TABLE product_subgroups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(group_id, name)
);

-- --- PRODUCTS ---
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    group_id UUID REFERENCES product_groups(id),
    subgroup_id UUID REFERENCES product_subgroups(id),
    name TEXT NOT NULL,
    sku TEXT,
    price DECIMAL(12, 2) NOT NULL DEFAULT 0,
    reorder_level INT DEFAULT 10,
    UNIQUE(tenant_id, sku)
);

-- --- STOCK LEVELS (Per Warehouse) ---
CREATE TABLE product_stocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    quantity INT NOT NULL DEFAULT 0,
    UNIQUE(product_id, warehouse_id)
);
```

## Sales Module

```sql
-- --- SALES TRANSACTIONS ---
CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    serial_number TEXT NOT NULL, -- Auto-generated but editable
    reference_number TEXT,       -- Manual system reference
    total_amount DECIMAL(12, 2) NOT NULL,
    amount_paid DECIMAL(12, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL, -- 'paid', 'due', 'void'
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, serial_number)
);

CREATE TABLE sale_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INT NOT NULL,
    price_at_sale DECIMAL(12, 2) NOT NULL
);
```

## Internal Movements

```sql
-- --- WAREHOUSE TRANSFERS ---
CREATE TABLE stock_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    from_warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    to_warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    quantity INT NOT NULL,
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT now()
);
```

## Accounting Module

```sql
-- --- CHART OF ACCOUNTS (COA) ---
CREATE TABLE account_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- asset, liability, equity, revenue, expense
    UNIQUE(tenant_id, name)
);

CREATE TABLE account_subgroups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES account_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(group_id, name)
);

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES account_groups(id),
    subgroup_id UUID REFERENCES account_subgroups(id),
    name TEXT NOT NULL,
    code TEXT,
    category TEXT NOT NULL DEFAULT 'general', -- cash, bank, general
    UNIQUE(tenant_id, name)
);

-- --- VOUCHERS ---
CREATE TABLE vouchers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    voucher_number TEXT NOT NULL,
    voucher_type TEXT NOT NULL, -- cash_payment, cash_receive, bank_payment, bank_receive, fund_transfer, journal
    description TEXT,
    reference_number TEXT,
    date TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, voucher_number)
);

CREATE TABLE voucher_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    voucher_id UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id),
    debit_amount DECIMAL(12, 2) DEFAULT 0,
    credit_amount DECIMAL(12, 2) DEFAULT 0,
    comment TEXT
);
```

## HR & Payroll Module

```sql
-- --- HR SETUP ---
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(tenant_id, name)
);

CREATE TABLE designations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(tenant_id, name)
);

-- --- EMPLOYEES ---
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id), -- Optional system access
    department_id UUID NOT NULL REFERENCES departments(id),
    designation_id UUID NOT NULL REFERENCES designations(id),
    store_id UUID REFERENCES stores(id),
    name TEXT NOT NULL,
    phone TEXT,
    nid_number TEXT,
    joining_date DATE NOT NULL DEFAULT CURRENT_DATE,
    basic_salary DECIMAL(12, 2) NOT NULL DEFAULT 0,
    allowances_json JSONB DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);
```

## CRM & Loyalty Module

```sql
-- --- CUSTOMERS ---
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT,
    segment TEXT DEFAULT 'new',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, phone)
);

CREATE TABLE customer_wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT now(),
    UNIQUE(customer_id)
);

-- --- LOYALTY ---
CREATE TABLE loyalty_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    min_spend DECIMAL(12, 2) DEFAULT 0,
    points_per_unit INT DEFAULT 1,
    redemption_rate DECIMAL(12, 2) DEFAULT 0.1, -- e.g. 10 points = 1 BDT
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE loyalty_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    sale_id UUID REFERENCES sales(id),
    points_earned INT DEFAULT 0,
    points_redeemed INT DEFAULT 0,
    balance_after INT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

## Row-Level Security (RLS) Strategy

Every table will have RLS enabled with a standard policy:

```sql
-- Example for 'products' table
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON products
    USING (tenant_id = (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()));
```

## Indexes
To ensure high performance, the following indexes are required:
*   `tenant_id` on all tables (for RLS performance).
*   `sku` on `products`.
*   `serial_number` on `sales`.
*   `(product_id, warehouse_id)` on `product_stocks`.
*   `voucher_number` on `vouchers`.
*   `account_id` on `voucher_details`.
*   `phone` on `customers`.
*   `customer_id` on `loyalty_points`.
