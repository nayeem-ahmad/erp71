# API Specification

This section defines the contract for the REST API of the ERP71 Platform.

## Standard Headers
All requests must include the following headers for authentication and multi-tenant scoping:
*   `Authorization`: `Bearer <JWT_TOKEN>` (Supabase Auth token)
*   `x-tenant-id`: `UUID` (The organization/tenant ID)
*   `x-store-id`: `UUID` (The specific store ID for the current context)

```yaml
openapi: 3.0.0
info:
  title: SaaS Platform for Grocery Shops API
  version: 1.1.0
  description: The REST API for the SaaS Platform for Grocery Shops, providing multi-tenant and multi-warehouse resources.
servers:
  - url: /api
    description: API base path

# =====================================================================================
# Paths
# =====================================================================================
paths:
  # --- TENANTS & WAREHOUSES ---
  /tenants:
    get:
      summary: Get Tenant Details
      description: Retrieves the current organization profile and subscription status.
      tags: [Tenant]
    patch:
      summary: Update Tenant
      tags: [Tenant]

  /warehouses:
    get:
      summary: List Warehouses
      description: Retrieves all storage locations for the current store.
      tags: [Inventory]
    post:
      summary: Create Warehouse
      tags: [Inventory]

  # --- PRODUCT CATALOG ---
  /product-groups:
    get:
      summary: List Product Groups
      tags: [Products]
    post:
      summary: Create Product Group
      tags: [Products]

  /product-subgroups:
    get:
      summary: List Subgroups
      tags: [Products]
    post:
      summary: Create Subgroup
      tags: [Products]

  /products:
    get:
      summary: List Products
      description: Retrieves a list of all products. Supports filtering by group_id and subgroup_id.
      tags: [Products]
    post:
      summary: Create Product
      tags: [Products]

  /products/{productId}/stock:
    get:
      summary: Get Product Stock Levels
      description: Returns stock quantity for the product across all warehouses.
      tags: [Inventory]

  # --- SALES MODULE ---
  /sales:
    post:
      summary: Create POS Sale
      description: Records a completed retail transaction. Requires warehouse_id.
      tags: [Sales]
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/NewSale'

  /sales-orders:
    post:
      summary: Create Sales Order
      description: Records a pending order.
      tags: [Sales]

  /sales-quotations:
    post:
      summary: Create Sales Quotation
      tags: [Sales]

  /sales-returns:
    post:
      summary: Create Sales Return
      description: Returns items to stock in a specific warehouse.
      tags: [Sales]

  # --- PURCHASE MODULE ---
  /purchases:
    post:
      summary: Create Direct Purchase
      description: Increases stock in a specific warehouse.
      tags: [Purchase]

  /purchase-orders:
    post:
      summary: Create PO
      tags: [Purchase]

  /purchase-returns:
    post:
      summary: Create Purchase Return
      tags: [Purchase]

  # --- INTERNAL MOVEMENTS ---
  /stock-transfers:
    post:
      summary: Create Warehouse Transfer
      description: Atomically moves stock from one warehouse to another.
      tags: [Inventory]
    get:
      summary: List Transfers
      tags: [Inventory]

  /inventory/adjustments:
    post:
      summary: Create Loss/Discrepancy Entry
      description: Records stock shrinkage or physical count corrections for a specific warehouse.
      tags: [Inventory]

  # --- ACCOUNTING MODULE ---
  /accounting/account-groups:
    get:
      summary: List Account Groups
      tags: [Accounting]
    post:
      summary: Create Account Group
      tags: [Accounting]

  /accounting/account-subgroups:
    get:
      summary: List Account Subgroups
      tags: [Accounting]
    post:
      summary: Create Account Subgroup
      tags: [Accounting]

  /accounting/accounts:
    get:
      summary: List Chart of Accounts
      tags: [Accounting]
    post:
      summary: Create Account
      tags: [Accounting]

  /accounting/vouchers:
    get:
      summary: List Vouchers (Journal)
      description: Returns a list of all vouchers. Supports filtering by date and type.
      tags: [Accounting]
    post:
      summary: Create Voucher
      description: Records a double-entry transaction.
      tags: [Accounting]
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/NewVoucher'

  /accounting/reports/ledger/{accountId}:
    get:
      summary: Get Account Ledger
      description: Returns transaction history and running balance for a specific account.
      tags: [Accounting]
      parameters:
        - name: accountId
          in: path
          required: true
          schema: { type: string, format: uuid }

  # --- HR & PAYROLL MODULE ---
  /hr/departments:
    get:
      summary: List Departments
      tags: [HR]
    post:
      summary: Create Department
      tags: [HR]

  /hr/designations:
    get:
      summary: List Designations
      tags: [HR]
    post:
      summary: Create Designation
      tags: [HR]

  /hr/employees:
    get:
      summary: List Employees
      tags: [HR]
    post:
      summary: Create Employee Profile
      tags: [HR]

  # --- CRM & LOYALTY MODULE ---
  /crm/customers:
    get:
      summary: List Customers
      tags: [CRM]
    post:
      summary: Create Customer Profile
      tags: [CRM]

  /crm/customers/{customerId}/wallet:
    get:
      summary: Get Customer Wallet Balance
      tags: [CRM]
    post:
      summary: Update Wallet Balance (Credit/Debit)
      tags: [CRM]

  /crm/loyalty/rules:
    get:
      summary: List Loyalty Rules
      tags: [CRM]
    post:
      summary: Create/Update Loyalty Rule
      tags: [CRM]

  # --- ANALYTICS ---
  /dashboard/main:
    get:
      summary: Get Landing Dashboard KPIs
      tags: [Dashboard]

  /analytics/sales:
    get:
      summary: Get Sales Analytics
      description: Aggregated data by product, group, subgroup, or customer.
      tags: [Dashboard]

# =====================================================================================
# Components
# =====================================================================================
components:
  schemas:
    Product:
      type: object
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        sku: { type: string }
        group_id: { type: string, format: uuid }
        subgroup_id: { type: string, format: uuid }
        price: { type: number, format: decimal }

    NewSale:
      type: object
      required: [warehouse_id, items, payments]
      properties:
        warehouse_id: { type: string, format: uuid }
        customer_id: { type: string, format: uuid, nullable: true }
        reference_number: { type: string, description: "Manual system reference" }
        items:
          type: array
          items:
            type: object
            required: [product_id, quantity]
            properties:
              product_id: { type: string, format: uuid }
              quantity: { type: integer }
        payments:
          type: array
          items:
            $ref: '#/components/schemas/PaymentEntry'

    PaymentEntry:
      type: object
      required: [payment_method_id, amount]
      properties:
        payment_method_id: { type: string, format: uuid }
        amount: { type: number, format: decimal }

    StockTransfer:
      type: object
      required: [product_id, from_warehouse_id, to_warehouse_id, quantity]
      properties:
        product_id: { type: string, format: uuid }
        from_warehouse_id: { type: string, format: uuid }
        to_warehouse_id: { type: string, format: uuid }
        quantity: { type: integer }

    NewVoucher:
      type: object
      required: [voucher_type, date, details]
      properties:
        voucher_type: { type: string, enum: [cash_payment, cash_receive, bank_payment, bank_receive, fund_transfer, journal] }
        date: { type: string, format: date-time }
        description: { type: string }
        reference_number: { type: string }
        details:
          type: array
          items:
            type: object
            required: [account_id, debit_amount, credit_amount]
            properties:
              account_id: { type: string, format: uuid }
              debit_amount: { type: number, format: decimal }
              credit_amount: { type: number, format: decimal }
              comment: { type: string }

    Account:
      type: object
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        type: { type: string, enum: [asset, liability, equity, revenue, expense] }
        category: { type: string, enum: [cash, bank, general] }
        code: { type: string }

    ApiError:
      type: object
      properties:
        error:
          type: object
          properties:
            code: { type: string }
            message: { type: string }
            timestamp: { type: string, format: date-time }

  responses:
    UnauthorizedError:
      description: Missing or invalid JWT or Tenant headers.
      content:
        application/json:
          schema: { $ref: '#/components/schemas/ApiError' }
```
