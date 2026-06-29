# Shop Owner & Staff User Manual

**ERP71 — Complete Guide for Shop Owners, Managers & Staff**

*Last updated: June 2026*

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Dashboard Overview](#2-dashboard-overview)
3. [Point of Sale (POS)](#3-point-of-sale-pos)
4. [Sales Management](#4-sales-management)
5. [Inventory & Products](#5-inventory--products)
6. [Purchase Management](#6-purchase-management)
7. [Customer Management & CRM](#7-customer-management--crm)
8. [Accounting & Finance](#8-accounting--finance)
9. [HR: Employees, Attendance & Leave](#9-hr-employees-attendance--leave)
10. [Delivery & Fulfillment](#10-delivery--fulfillment)
11. [Expenses](#11-expenses)
12. [Loyalty Programme](#12-loyalty-programme)
13. [Discount Codes & Promotions](#13-discount-codes--promotions)
14. [E-Commerce Storefront](#14-e-commerce-storefront)
15. [SMS Campaigns & WhatsApp](#15-sms-campaigns--whatsapp)
16. [Team Management & Permissions](#16-team-management--permissions)
17. [Settings & Configuration](#17-settings--configuration)
18. [Billing & Subscription](#18-billing--subscription)
19. [Reports Reference](#19-reports-reference)
20. [Tips, Shortcuts & Best Practices](#20-tips-shortcuts--best-practices)

---

## 1. Getting Started

### 1.1 Creating Your Account

1. Go to the platform homepage and click **Get Started** or **Sign Up**.
2. Enter your name, email address, and a strong password.
3. Check your inbox for a **welcome email** — click the link to verify your address.
4. You will be taken straight to the **Onboarding Wizard**.

### 1.2 Onboarding Wizard

The wizard takes you through the essential setup steps in order. Complete each step before moving to the next:

| Step | What to Do |
|------|-----------|
| **Business details** | Enter your shop name, address, phone number, and business type. |
| **Currency & locale** | Choose your currency (BDT default), date format, and language (English or বাংলা). |
| **Tax settings** | Enable VAT/tax if applicable and enter your TIN or VAT registration number. |
| **First product** | Add one or two products to see how inventory works. |
| **First customer** | Add a customer (optional — walk-in customers work without a profile). |
| **Payment methods** | Choose which payment types your POS accepts: Cash, bKash, Nagad, Card, etc. |
| **Done** | Your shop is ready. You land on the main dashboard. |

You can return to any setting later via **Settings**.

### 1.3 Signing In

- Visit your store URL and click **Log In**.
- Enter your email and password.
- If Two-Factor Authentication (2FA) is enabled, enter the six-digit code from your authenticator app.
- To reset a forgotten password, click **Forgot password?** and follow the email link.

### 1.4 Switching Language

Go to **Settings → Localization** to switch the entire interface between English and Bangla (বাংলা). Bangla number formatting (০–৯) can be turned on separately.

---

## 2. Dashboard Overview

The main dashboard appears when you log in. It gives you a live summary of your business.

### 2.1 Key Performance Indicators (KPIs)

The top cards show today's and month-to-date figures:

- **Total Sales** — Revenue collected.
- **Total Purchases** — Stock bought from suppliers.
- **Net Profit (approx.)** — Revenue minus cost of goods sold for the period.
- **Outstanding Receivables** — What customers owe you.
- **Outstanding Payables** — What you owe suppliers.
- **Low-Stock Alerts** — Products below their reorder point.

### 2.2 Navigation

The sidebar on the left contains all modules. On mobile, tap the **☰ hamburger menu** to open it. Modules are grouped:

- **Sales** — POS, Sales, Orders, Quotes, Returns
- **Purchases** — Purchases, Purchase Orders, RFQs, Returns
- **Inventory** — Products, Stock Takes, Transfers, Shrinkage
- **Customers** — Customers, Groups, CRM Tasks, Campaigns
- **Accounting** — COA, Vouchers, Reports
- **HR** — Employees, Attendance, Leave
- **Settings** — Team, Tax, Branding, SMS, Billing, etc.

### 2.3 Notification Bell

The bell icon (top-right) shows unread alerts. Notifications include:

- Low-stock warnings
- Subscription expiry reminders (7 days and 1 day before renewal)
- Payment failures
- Staff invitations accepted

---

## 3. Point of Sale (POS)

The POS is where you process everyday sales. Go to **Sales → POS** (or press the quick-access POS button on the dashboard).

### 3.1 Starting a Cashier Session

Before selling, you must **open a cashier session**:

1. Click **Open Session**.
2. Select the **counter** you are operating (e.g. Counter 1, Main Counter).
3. Enter the **opening float** — the cash in the till at the start of the shift (e.g. ৳500).
4. Click **Start Session**.

You can only have one open session per counter at a time.

### 3.2 Processing a Sale

1. **Add products** — scan a barcode, search by name or SKU, or browse categories.
2. Each item appears in the cart with quantity and price.
3. To change quantity, click the quantity field and type the new number, or use **+/−**.
4. To apply a discount on a line item, click the line and enter a **%** or fixed discount.
5. To remove an item, click the **✕** next to it.

### 3.3 Applying a Discount to the Whole Sale

Click **Discount** at the bottom of the cart and enter a percentage or fixed amount.

### 3.4 Selecting a Customer

Click **Select Customer** to attach the sale to a customer record. This is needed for:

- Applying customer-specific pricing.
- Adding loyalty points.
- Tracking customer purchase history.
- Billing to a customer account (credit sales).

Walk-in sales can proceed without selecting a customer.

### 3.5 Payment

1. Click **Charge** (or press **Enter**) when the cart is complete.
2. Select a payment method:
   - **Cash** — enter the amount tendered; change is calculated automatically.
   - **bKash / Nagad** — enter the mobile number and transaction ID.
   - **Card** — enter the last four digits (optional) for records.
   - **Customer Credit** — deducts from the customer's wallet balance.
   - **Split payment** — tap **Add Payment** to mix methods (e.g. part cash + part bKash).
3. Click **Complete Sale**.
4. The receipt appears. Print it or send it via SMS/WhatsApp.

### 3.6 Holding a Sale

Click **Hold** to park the current cart without completing it. You can resume it from the **Held Sales** list and continue processing other customers in the meantime.

### 3.7 Discount Codes at POS

Enter a **discount code** in the promo code field before checkout. The code's discount is applied automatically if the conditions are met (minimum order, product category, etc.).

### 3.8 Closing a Cashier Session

At the end of a shift:

1. Go to **Sales → Cashier Sessions** and click your open session.
2. Enter the **closing cash count** (physical cash in the till).
3. Review the **cash variance** (expected vs actual). Investigate any large discrepancy.
4. Click **Close Session**.

The session report summarises total sales, payment method breakdown, and cash variance for handover or audit.

### 3.9 Multiple Counters

If your store has multiple checkout counters, each runs its own session. Go to **Settings → Counters** to add or rename counters. Assign staff to specific counters via role settings.

---

## 4. Sales Management

### 4.1 Sales List

**Sales → Sales** shows all completed sales. Filter by:

- Date range
- Customer
- Payment method
- Cashier/staff member

Click any sale to view its detail, reprint the invoice, or initiate a return.

### 4.2 Sales Orders

Use **Sales → Orders** when a customer orders goods that are not yet in stock or need to be prepared before collection/delivery.

**Workflow:**
1. Create an order — select customer, add products, set delivery date.
2. Order status: **Pending → Confirmed → Fulfilled → Closed**.
3. Confirm the order when stock is reserved.
4. Fulfill when goods are dispatched or collected.

### 4.3 Sales Quotations

Send a **quote/estimate** to a customer before they commit:

1. Go to **Sales → Quotations → New Quotation**.
2. Add customer, products, and valid-until date.
3. Save and send the quote via email or print it.
4. When the customer approves, **Convert to Order** or **Convert to Sale** from the quote detail page.

### 4.4 Sales Returns (Refunds)

To accept a return:

1. Open the original sale from **Sales → Sales**.
2. Click **Return Items**.
3. Select which items are being returned and enter quantities.
4. Choose the **refund method** (cash, customer wallet, etc.).
5. Confirm. Stock is automatically restocked and the accounting entry is reversed.

Alternatively, create a standalone return from **Sales → Returns → New Return** if you do not have the original sale reference.

### 4.5 Sales Reports

| Report | Location | What it Shows |
|--------|----------|--------------|
| Sales Summary | Sales → Reports → Summary | Revenue, orders, average order value by date range |
| Sales by Product | Sales → Reports → Products | Best-selling products ranked by revenue and quantity |
| Sales by Customer | Sales → Reports → Customers | Top customers by spend |
| Monthly Sales | Sales → Reports → Monthly | Month-by-month revenue trend |

---

## 5. Inventory & Products

### 5.1 Adding a Product

Go to **Inventory → Products → Add Product**:

| Field | Description |
|-------|-------------|
| **Name** | Full product name visible in POS search. |
| **SKU** | Your internal stock-keeping unit code. |
| **Barcode** | Scan or type the barcode (EAN-13, QR, etc.). |
| **Category / Group / Subgroup** | Organise products into a hierarchy (e.g. Beverages → Cold Drinks → Colas). |
| **Brand** | Select from your brand list. |
| **Unit** | pcs, kg, litre, box, etc. |
| **Selling Price** | Price shown at POS. |
| **Cost Price** | Buying price (used for profit reports). |
| **Tax** | VAT rate if applicable. |
| **Reorder Point** | Minimum stock level — triggers a low-stock alert. |
| **Reorder Quantity** | Suggested purchase quantity when reordering. |
| **Warehouse** | Opening stock quantity per warehouse. |

### 5.2 Product Categories

Use **Inventory → Categories** to build a three-level hierarchy:

- **Group** (e.g. Food)
- **Sub-group** (e.g. Snacks)
- **Product** (e.g. Chips 50g)

Categories appear in POS browsing and filter all reports.

### 5.3 Brands

Manage brands from **Inventory → Brands**. Attach each product to a brand for brand-level filtering in reports.

### 5.4 Adjusting Stock

You can adjust stock in several ways:

**Direct adjustment:** Open a product → click **Adjust Stock** → enter quantity change (positive to add, negative to deduct) and a reason.

**Stock Take:** For a full physical count (see §5.6).

**Purchase:** Receiving a purchase order automatically adds stock (see §6).

**Sales:** Every POS sale automatically deducts stock.

### 5.5 Warehouses & Stock Transfers

If you operate multiple storage locations (storeroom, main floor, second branch):

- Go to **Inventory → Settings** to create warehouses.
- To move stock between warehouses: **Inventory → Transfers → New Transfer**.
  - Select source warehouse, destination warehouse, and products with quantities.
  - Submit the transfer. Stock is deducted from source and added to destination.

### 5.6 Stock Takes (Physical Inventory Count)

A stock take reconciles physical shelf counts against system quantities.

**Recommended frequency:** Monthly or quarterly.

**Steps:**

1. Go to **Inventory → Stock Takes → New Stock Take**.
2. Select the **warehouse** to count.
3. Optionally check **Start Immediately** to begin counting right away.
4. Count items shelf by shelf. Enter the **physical count** for each product.
5. Click **Save Counts** frequently to avoid losing progress.
6. When finished, click **Complete Counting**.
7. Review **variances** (system quantity vs counted quantity). Large variances require a reason.
8. If variances exceed the approval threshold, the session moves to **Review** — a manager must approve it.
9. Click **Post Session** to apply adjustments to live stock.

> **Note:** Posting cannot be undone without a reversing adjustment. Always double-check large variances before posting.

### 5.7 Shrinkage (Damaged / Stolen Stock)

Record damaged, expired, or stolen stock via **Inventory → Shrinkage → Record Shrinkage**. This deducts stock and posts a shrinkage expense entry if accounting is configured. View the **Shrinkage Report** to track losses over time.

### 5.8 Product Labels

Print barcode or price labels from **Inventory → Labels**:

1. Select products (filter by category or search by name).
2. Choose label size and template.
3. Click **Print Labels** — a PDF opens for your label printer.

### 5.9 Inventory Reports

| Report | Location | What it Shows |
|--------|----------|--------------|
| Stock Valuation | Inventory → Reports → Valuation | Total value of on-hand stock by product/category |
| Reorder Report | Inventory → Reports → Reorder | Products at or below reorder point |
| Shrinkage Report | Inventory → Reports → Shrinkage | Recorded stock losses by category and reason |
| Inventory Ledger | Inventory → Ledger | Full movement log (in/out) per product |

---

## 6. Purchase Management

### 6.1 Suppliers

Before creating purchases, add your suppliers:

1. Go to **Inventory → Suppliers → Add Supplier**.
2. Enter name, contact person, phone, email, and address.
3. Set **payment terms** (e.g. Net 30 days).

### 6.2 Request for Quotation (RFQ)

When you want to request prices from a supplier before committing:

1. Go to **Purchases → RFQs → New RFQ**.
2. Select the supplier and add products with required quantities.
3. Send the RFQ (print or email).
4. When the supplier replies, enter their quoted prices and **Convert to Purchase Order**.

### 6.3 Purchase Orders (PO)

A purchase order is a formal order sent to a supplier:

1. Go to **Purchases → Purchase Orders → New PO**.
2. Select supplier, add products and quantities, set expected delivery date.
3. Click **Confirm PO** — status changes to Confirmed.
4. When goods arrive, click **Receive** and enter the received quantities.
5. Stock levels update automatically for received quantities.
6. Create a **Bill** from the PO to record the supplier invoice and schedule payment.

**PO Statuses:** Draft → Confirmed → Partially Received → Received → Billed → Closed.

### 6.4 Direct Purchases

For immediate, unplanned purchases (e.g. buying from a market):

1. Go to **Purchases → Purchases → New Purchase**.
2. Select supplier (or use "Walk-in Supplier"), add products, enter cost prices.
3. Save. Stock is added immediately and an accounting entry is created.

### 6.5 Purchase Returns

If you need to return goods to a supplier:

1. Open the original purchase from **Purchases → Purchases**.
2. Click **Return Items**, select items and quantities.
3. Confirm. Stock is deducted and the payable is reduced.

### 6.6 Purchase Reports

| Report | Location | What it Shows |
|--------|----------|--------------|
| Purchase Summary | Purchases → Reports → Summary | Total spend by period |
| By Supplier | Purchases → Reports → By Supplier | Spend per supplier |
| By Product | Purchases → Reports → By Product | Products purchased, quantities, costs |

---

## 7. Customer Management & CRM

### 7.1 Adding a Customer

Go to **Customers → Add Customer**:

| Field | Description |
|-------|-------------|
| Name | Customer's full name. |
| Phone | Primary contact — used for SMS and WhatsApp. |
| Email | For emailed invoices and campaigns. |
| Address | Delivery address. |
| Customer Group | Segment (e.g. VIP, Wholesale, Retail). |
| Credit Limit | Maximum amount of credit you extend to this customer. |

### 7.2 Customer Profile

Click any customer to open their profile, which has tabs:

- **Overview** — contact details, balance, loyalty points, credit status.
- **Purchase History** — all sales linked to this customer.
- **Payments** — payment history and outstanding dues.
- **Interactions** — logged calls, visits, and notes.
- **Tasks** — follow-up tasks assigned to this customer.

### 7.3 Customer Groups

Group customers to apply pricing rules or filter reports:

1. Go to **Customers → Groups → Add Group**.
2. Name the group (e.g. "Wholesale", "VIP", "Corporate").
3. Assign customers to the group from their profile or in bulk.

### 7.4 Credit Sales & Due Management

To sell on credit:

- At POS, select the customer, then choose **Customer Credit** as the payment method.
- The outstanding amount is added to the customer's **balance due**.
- To record a repayment: open the customer profile → click **Record Payment**.

Track overdue balances with the **AR Aging Report** (Accounting → Reports → AR Aging).

### 7.5 CRM Tasks

Use tasks to track follow-ups:

1. Go to **CRM → Tasks → New Task**.
2. Set the customer, task type (call, visit, email), due date, and notes.
3. Assign to a salesperson.
4. Mark tasks complete from the task list or customer profile.

### 7.6 CRM Campaigns

Send promotional messages to a group of customers:

1. Go to **CRM → Campaigns → New Campaign**.
2. Choose channel: **SMS** or **WhatsApp**.
3. Select the **customer group** or filter by criteria (e.g. customers who haven't purchased in 60 days).
4. Write the message template (support for personalisation tags: {{name}}, {{balance}}, etc.).
5. Schedule or send immediately.
6. SMS campaigns consume your SMS credit balance.

### 7.7 Customer Due Aging Report

Go to **Customers → Reports → Due Aging**. This shows how long customer balances have been outstanding, bucketed into 0–30, 31–60, 61–90, and 90+ day columns — useful for chasing payments.

---

## 8. Accounting & Finance

> These features are available on **Basic** plan and above. You do not need prior accounting knowledge to use them — posting rules automate most journal entries.

### 8.1 How Accounting Works

Every sale, purchase, or stock adjustment automatically creates a **double-entry journal voucher** based on your **Posting Rules**. You do not need to create vouchers manually for routine transactions. The accounting module is there for:

- Reviewing auto-generated entries
- Recording manual entries (rent, salaries, bank deposits)
- Viewing financial statements
- Reconciling bank accounts

### 8.2 Chart of Accounts (COA)

The COA is the master list of all accounts. A bootstrap skeleton is created for you (Cash, Bank, Accounts Receivable, Accounts Payable, Sales Revenue, Cost of Goods Sold, etc.).

To add accounts:

1. Go to **Accounting → Chart of Accounts → Add Account**.
2. Select **Account Type** (Asset, Liability, Equity, Revenue, Expense).
3. Select **Group** and optionally a **Subgroup** for organisation.
4. Set **Category** (Cash, Bank, or General) — Cash and Bank categories are used in reconciliation.
5. Give it a short **Code** (e.g. 1010 for petty cash) and a descriptive name.

### 8.3 Posting Rules

Posting rules tell the system which accounts to debit/credit for each event type. Check default rules before going live:

1. Go to **Accounting → Posting Rules**.
2. Review the rule for **Sale (Cash)** — debit should be your Cash account; credit should be Sales Revenue.
3. Review the rule for **Sale (bKash)** — debit bKash Receivable; credit Sales Revenue.
4. Adjust accounts to match your COA if you renamed them.

> After changing a posting rule, test with a small sale and verify the journal entry under Accounting → Vouchers.

### 8.4 Journal Vouchers

To record a manual entry (e.g. paying monthly rent):

1. Go to **Accounting → Vouchers → New Voucher**.
2. Set the **date** and **narration** (description).
3. Add lines: select account, enter debit or credit amount.
4. Debits must equal credits — the system warns you if they don't.
5. Save to post immediately, or save as draft to post later.

### 8.5 General Ledger

Go to **Accounting → Ledger**, select an account and date range to see every debit/credit posted to that account with running balances. Essential for tracking a specific account (e.g. seeing all movements in your main Bank account).

### 8.6 Bank Reconciliation

Reconcile your bank statement to catch discrepancies:

1. Go to **Accounting → Reconciliation → Bank**.
2. Select the bank account and statement date.
3. Upload or manually match your bank statement lines against system entries.
4. Mark matched items as **Reconciled**.
5. Unmatched items are flagged for investigation (bank charges, unrecorded deposits, etc.).

### 8.7 Fixed Assets

Track long-term assets (shop equipment, vehicles, computers):

1. Go to **Accounting → Fixed Assets → Add Asset**.
2. Enter name, purchase date, cost, useful life (years), and depreciation method (Straight Line or Declining Balance).
3. The system calculates and posts monthly depreciation automatically.

### 8.8 Fiscal Periods

Lock past periods to prevent backdated changes:

1. Go to **Accounting → Fiscal Periods**.
2. Close a month after you have reconciled it.
3. Closed periods reject new vouchers — ask the owner/accountant to reopen if a correction is needed.

### 8.9 Financial Reports

| Report | Location | What it Shows |
|--------|----------|--------------|
| Profit & Loss | Accounting → Reports → P&L | Revenue minus expenses for a period |
| Comparative P&L | Reports → Comparative P&L | Side-by-side P&L for two periods |
| Balance Sheet | Reports → Balance Sheet | Assets, liabilities, and equity at a point in time |
| Trial Balance | Reports → Trial Balance | All account balances; debits must equal credits |
| Cash Flow Statement | Reports → Cash Flow | Operating, investing, financing cash movements |
| Cashbook | Reports → Cashbook | All cash account transactions |
| Bankbook | Reports → Bankbook | All bank account transactions |
| AR Aging | Reports → AR Aging | Customer receivables by age bucket |
| AP Aging | Reports → AP Aging | Supplier payables by age bucket |
| Budget vs Actual | Reports → Budget vs Actual | Compare targets to actual spend |
| Financial Ratios | Reports → Financial Ratios | Liquidity, profitability, and efficiency ratios |
| VAT / Tax Report | Reports → VAT/Tax | Tax collected and payable for a period |

### 8.10 Cost Centers

Allocate expenses and revenue to departments or branches:

1. Go to **Accounting → Cost Centers → Add Cost Center** (e.g. "Main Branch", "Warehouse", "Online Store").
2. When creating vouchers, assign lines to a cost center.
3. Filter the P&L by cost center to see each branch's profitability.

### 8.11 Recurring Journal Templates

For entries that repeat every month (e.g. rent, depreciation adjustments):

1. Go to **Accounting → Recurring Journals → New Template**.
2. Set the accounts, amounts, and frequency (monthly, quarterly, etc.).
3. The system generates a draft voucher on the scheduled date for you to review and post.

### 8.12 Audit Trail

Every change to the general ledger is recorded in the audit trail:

- Go to **Accounting → Vouchers** and open any voucher to see its revision history.
- For a full log across all modules: **Settings → Audit Logs**.

---

## 9. HR: Employees, Attendance & Leave

### 9.1 Employee Profiles

Go to **HR → Employees → Add Employee**:

| Field | Description |
|-------|-------------|
| Name | Full name. |
| NID / Passport | National ID (for Bangladesh compliance). |
| Phone / Email | Contact details. |
| Department | e.g. Sales, Warehouse, Accounts. |
| Designation | e.g. Cashier, Manager, Driver. |
| Join Date | Employment start date. |
| Branch | Which store/branch this employee belongs to. |

### 9.2 Attendance Tracking

Record daily attendance:

1. Go to **HR → Attendance**.
2. Select the **date** and **employee**.
3. Mark status: **Present**, **Absent**, **Half Day**, **On Leave**.
4. Enter **check-in** and **check-out** times if needed.

View the monthly attendance summary for payroll preparation.

### 9.3 Leave Management

**Setting up leave types:** Go to HR → Leave → Leave Types and add types such as Annual Leave, Sick Leave, Emergency Leave, with their annual entitlements.

**Applying for leave:**

1. Go to **HR → Leave → New Leave Request**.
2. Select employee, leave type, start and end date, and reason.
3. Submit for approval.

**Approving leave:**

- Managers see pending requests in **HR → Leave → Pending Approvals**.
- Click **Approve** or **Reject** with a comment.

**Leave balance** is tracked automatically — days taken are deducted from the annual entitlement.

---

## 10. Delivery & Fulfillment

Track outgoing deliveries from confirmed sales orders or directly:

1. Go to **Delivery → New Delivery**.
2. Select the linked **sales order** (or create a standalone delivery).
3. Enter the **delivery address**, **driver/courier**, and **expected delivery date**.
4. Update the status as it progresses: Pending → Dispatched → Delivered / Failed.
5. On delivery confirmation, the sales order status updates to Fulfilled.

---

## 11. Expenses

Record business expenses that are not part of purchasing stock:

1. Go to **Expenses → New Expense**.
2. Select the **category** (Rent, Utilities, Marketing, Transport, etc.).
3. Enter amount, date, payment method, and notes.
4. Attach a receipt photo (optional).
5. Expenses post automatically to the linked expense account if accounting is configured.

**Expense Categories:** Manage categories at **Expenses → Categories** — add custom categories for your business.

**Expense Reports:** Go to **Expenses → Reports** for a breakdown of spend by category and period.

---

## 12. Loyalty Programme

Reward repeat customers with loyalty points.

### 12.1 Setting Up Loyalty

Go to **Settings → Loyalty**:

| Setting | Description |
|---------|-------------|
| Points per BDT | e.g. 1 point per ৳10 spent. |
| Redemption rate | e.g. 100 points = ৳5 discount. |
| Minimum points to redeem | e.g. customer needs at least 500 points. |
| Points expiry | e.g. points expire after 12 months if unused. |
| Excluded categories | Products that do not earn points (e.g. mobile top-ups). |

### 12.2 Earning Points

When a customer is selected at POS and the sale is completed, points are added automatically based on the amount spent. The customer can see their balance on their receipt.

### 12.3 Redeeming Points

At POS:

1. Select the customer.
2. Click **Redeem Points**.
3. Enter the number of points to redeem. The equivalent discount is applied to the cart.
4. Complete the sale normally.

### 12.4 Checking a Customer's Balance

Open the customer profile — the **loyalty points balance** is shown on the Overview tab.

---

## 13. Discount Codes & Promotions

### 13.1 Creating a Discount Code

Go to **Settings → Discount Codes → New Code**:

| Field | Description |
|-------|-------------|
| Code | The code customers or cashiers enter (e.g. EID20). |
| Discount Type | Percentage or fixed amount. |
| Discount Value | e.g. 20% or ৳100. |
| Minimum Order | Minimum cart value to qualify. |
| Valid From / Until | Active date range. |
| Usage Limit | Total redemptions allowed (leave blank for unlimited). |
| Per-customer limit | Max uses per customer. |
| Applicable Categories | Restrict to specific product categories. |

### 13.2 Using a Discount Code

At POS, enter the code in the **Promo Code** field before checkout. The discount is applied if all conditions are met. The cashier sees a green confirmation with the discount amount.

---

## 14. E-Commerce Storefront

> Available on **Standard** and **Premium** plans.

Your storefront is a customer-facing online shop at `yourdomain.com/store/your-slug`.

### 14.1 Configuring the Storefront

Go to **Settings → Storefront**:

- **Shop name & slug** — your public URL.
- **Banner image** — uploaded hero image for the shop home page.
- **Logo** — displayed in the storefront header.
- **Contact details** — phone and email shown to customers.
- **Show prices** — toggle whether prices are visible to unauthenticated visitors.
- **Featured products** — pin specific products to the homepage.

### 14.2 Publishing Products

From **Inventory → Products**, open a product and toggle **Publish to Storefront** to make it visible online. Set an optional **online price** if it differs from your in-store price.

### 14.3 Customer Online Shopping Flow

1. Customer visits your storefront URL.
2. Browses products — can filter by category and search by name.
3. Adds items to cart.
4. Signs up or logs in to place an order.
5. Enters delivery address.
6. Selects payment method and pays.
7. Order appears in **Sales → Orders** in your dashboard with status Pending.
8. Confirm, fulfill, and dispatch — customer sees status updates.

### 14.4 Online Loyalty Points

Customers who have a loyalty account earn points on online orders. They can view their balance after logging in to the storefront.

---

## 15. SMS Campaigns & WhatsApp

### 15.1 SMS Credits

SMS messages consume credits from your balance. Check your credit balance at **Settings → SMS Credits**. Top up by clicking **Buy Credits** — pay via bKash, Nagad, or card.

One credit = one SMS segment (~160 characters). Long messages use multiple credits.

### 15.2 Sending an SMS Campaign

Go to **CRM → Campaigns → New Campaign → SMS**:

1. Choose a **customer group** or apply filters.
2. Write your message. Available tags:
   - `{{name}}` — customer's name
   - `{{balance}}` — outstanding balance
   - `{{points}}` — loyalty points
3. Preview the estimated credit cost.
4. Click **Send Now** or **Schedule**.

### 15.3 WhatsApp Campaigns

WhatsApp campaigns use pre-approved message templates (required by Meta). Configure your WhatsApp Business API credentials under **Settings → Integrations**. Then follow the same flow as SMS campaigns but select **WhatsApp** as the channel.

---

## 16. Team Management & Permissions

### 16.1 Staff Roles

The platform has built-in roles with different permission levels:

| Role | What they can do |
|------|-----------------|
| **Owner** | Full access to everything. Can manage billing and delete the account. |
| **Manager** | All operational access. Cannot manage billing or delete the account. |
| **Accountant** | Full accounting access. Limited POS and inventory write access. |
| **Cashier** | POS only. Can process sales, returns, and close sessions. No access to reports or settings. |
| **Salesman** | Can create quotations and orders. Cannot process payments. |
| **Warehouse Staff** | Inventory and stock transfers. No access to finance or HR. |
| **HR Manager** | Employees, attendance, and leave. No access to finance. |

### 16.2 Inviting a Staff Member

1. Go to **Settings → Team → Invite Member**.
2. Enter the staff member's **email address**.
3. Select their **role**.
4. Optionally restrict them to a specific **branch**.
5. Click **Send Invitation**.
6. The staff member receives an email with a link to create their account and join your store.

### 16.3 Changing a Team Member's Role

Go to **Settings → Team**, click the member's name, and change their role from the dropdown. Changes take effect immediately on their next action.

### 16.4 Removing a Staff Member

Go to **Settings → Team**, click the member, and click **Remove from Team**. Their account is deactivated — they cannot log in but their past actions remain in the audit log.

### 16.5 Branch-Level Access

For multi-branch setups, you can restrict a user to specific branches. They can only see data and perform actions for their assigned branch(es). The Owner can see all branches.

---

## 17. Settings & Configuration

### 17.1 Business Profile

Go to **Settings → Account**:

- Change your shop name, address, and contact details.
- Upload your business **logo** (shown on invoices and the storefront).
- Set your **default currency** and **tax rate**.

### 17.2 Branding

Go to **Settings → Branding**:

- Set the **primary colour** used on invoices and the storefront.
- Upload your **header logo** and **invoice footer** text.
- Customise the **receipt template** (include/exclude loyalty points, QR code, etc.).

### 17.3 Tax Settings

Go to **Settings → Tax**:

- Enable or disable tax.
- Set the **default VAT rate** (e.g. 15%).
- Enter your **TIN / VAT registration number** — appears on tax invoices.
- Configure whether prices are **tax-inclusive or tax-exclusive** at POS.

### 17.4 Localization

Go to **Settings → Localization**:

- **Language:** English / বাংলা.
- **Date format:** DD/MM/YYYY or MM/DD/YYYY.
- **Number format:** Use Bangla digits (০১২৩) or standard digits (0123).
- **Currency symbol position:** Before or after the amount.

### 17.5 Payment Methods

Go to **Settings** to configure which payment methods appear at POS and online:

- **Cash** — always on.
- **bKash** — enter your bKash merchant credentials.
- **Nagad** — enter your Nagad merchant credentials.
- **SSL Wireless** — enter your SSL Wireless API credentials for card payments.

### 17.6 SMS Settings

Go to **Settings → SMS**:

- Connect your SMS gateway (default provider is pre-configured for Bangladesh).
- Set the **SMS sender ID** (your shop name appears as the sender).
- View SMS usage history.

### 17.7 Security: Two-Factor Authentication (2FA)

Go to **Settings → Account → Security → Enable 2FA**:

1. Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.).
2. Enter the 6-digit code to confirm.
3. Save your **backup codes** — these let you log in if you lose your phone.

All Owner accounts are strongly recommended to enable 2FA.

### 17.8 Audit Logs

Go to **Settings → Audit Logs** to see a timestamped record of every significant action performed in your store — who deleted a product, who changed a price, who logged in, etc.

Filter by user, action type, or date range.

### 17.9 Data Export & Deletion

To export your data (GDPR/PDPA compliance):

1. Go to **Settings → Account → Data & Privacy**.
2. Click **Export My Data** — you will receive a downloadable archive within 24 hours.

To request account deletion: click **Delete Account** and follow the confirmation steps. This is irreversible — download your data first.

---

## 18. Billing & Subscription

### 18.1 Subscription Plans

| Plan | Monthly Price | Key Features |
|------|--------------|-------------|
| **Free** | ৳0 | Single user, basic POS, 50 products |
| **Basic** | ৳499/month | 3 users, accounting, unlimited products, SMS campaigns |
| **Standard** | ৳999/month | 10 users, e-commerce storefront, multi-branch, purchase orders |
| **Premium** | ৳1,499/month | Unlimited users, priority support, advanced reports, API access |

### 18.2 Upgrading or Downgrading

Go to **Billing → Change Plan**. Upgrades take effect immediately (prorated charge). Downgrades take effect at the end of the current billing cycle.

When downgrading, features above your new plan are disabled — data is retained so you can upgrade again later.

### 18.3 Payment Methods for Subscription

Pay your monthly subscription via:

- **bKash** — most common in Bangladesh.
- **Nagad**
- **Debit/Credit Card** (via SSL Wireless)

### 18.4 What Happens if Payment Fails

1. You receive an email and in-app notification about the failed payment.
2. The system retries automatically over the next few days.
3. After the **grace period** (7 days), your account is downgraded to the Free plan — you keep your data but lose paid features.
4. Once you update your payment method and pay, your plan is reinstated immediately.

### 18.5 Billing History & Invoices

Go to **Billing** to see all past invoices. Click any invoice to download a PDF for your records.

### 18.6 SMS Credits

SMS credits are separate from your subscription:

1. Go to **Settings → SMS Credits → Buy Credits**.
2. Choose a credit bundle.
3. Pay via bKash, Nagad, or card.
4. Credits are added immediately.

---

## 19. Reports Reference

A consolidated list of all reports and where to find them:

### Sales
| Report | Path |
|--------|------|
| Sales Summary | Sales → Reports → Summary |
| Sales by Product | Sales → Reports → Products |
| Sales by Customer | Sales → Reports → Customers |
| Monthly Sales | Sales → Reports → Monthly |

### Purchases
| Report | Path |
|--------|------|
| Purchase Summary | Purchases → Reports → Summary |
| By Supplier | Purchases → Reports → By Supplier |
| By Product | Purchases → Reports → By Product |

### Inventory
| Report | Path |
|--------|------|
| Stock Valuation | Inventory → Reports → Valuation |
| Reorder Report | Inventory → Reports → Reorder |
| Shrinkage Report | Inventory → Reports → Shrinkage |
| Inventory Ledger | Inventory → Ledger |

### Accounting & Finance
| Report | Path |
|--------|------|
| Profit & Loss | Accounting → Reports → P&L |
| Comparative P&L | Accounting → Reports → Comparative P&L |
| Balance Sheet | Accounting → Reports → Balance Sheet |
| Trial Balance | Accounting → Reports → Trial Balance |
| Cash Flow | Accounting → Reports → Cash Flow |
| Cashbook | Accounting → Reports → Cashbook |
| Bankbook | Accounting → Reports → Bankbook |
| AR Aging | Accounting → Reports → AR Aging |
| AP Aging | Accounting → Reports → AP Aging |
| Budget vs Actual | Accounting → Reports → Budget vs Actual |
| Financial Ratios | Accounting → Reports → Financial Ratios |
| VAT / Tax | Accounting → Reports → VAT/Tax |

### Customers
| Report | Path |
|--------|------|
| Due Aging | Customers → Reports → Due Aging |

### Expenses
| Report | Path |
|--------|------|
| Expense Summary | Expenses → Reports |

### Multi-Branch
| Report | Path |
|--------|------|
| Consolidated Report | Reports → Consolidated |
| Branch Report | Reports → Branch Report |

---

## 20. Tips, Shortcuts & Best Practices

### Daily Routine for Cashiers
1. Open cashier session with correct opening float.
2. Process sales throughout the day.
3. At end of shift: count cash in till, close session, hand over float difference to manager.

### Daily Routine for the Owner / Manager
1. Check the **dashboard KPIs** — any unusual spikes or drops in sales?
2. Review **low-stock notifications** — create purchase orders for items near reorder point.
3. Check **pending CRM tasks** — follow up with customers.
4. Review **pending sales orders** — confirm or fulfill.

### Weekly
- Run **Sales Summary Report** to review the week.
- Check **AR Aging** — follow up on overdue customer balances.
- Review **Expense Report** to track spending.

### Monthly
- Conduct a **Stock Take** for accurate inventory.
- Reconcile the **bank account**.
- Review **P&L** and compare to last month.
- Lock the completed **fiscal period**.
- Check SMS credit balance — top up if needed.

### Performance Tips

- **Use barcodes:** Barcode scanning is significantly faster than manual search at POS. Print barcode labels for products that don't have them.
- **Customer profiles:** Always search for the customer at POS — loyalty points and credit history only work when the customer is selected.
- **Set reorder points:** Enter reorder points on every product. The daily low-stock alert email tells you exactly what to buy.
- **Posting rules:** Verify posting rules once after setup. Correct automation is worth more than any single report.
- **Backup:** Your data is automatically backed up daily. However, download your data export quarterly as an extra precaution.

### Common Issues & Quick Fixes

| Issue | Quick Fix |
|-------|-----------|
| Product not found at POS | Check if the product exists in Inventory and has available stock. |
| Price showing incorrectly | Open the product and verify the selling price. |
| Can't close cashier session | Make sure all held sales are completed or discarded first. |
| Stock count doesn't match | Check if a stock take is in progress or if goods were received in another warehouse. |
| Accounting entries look wrong | Go to Accounting → Posting Rules and verify the accounts for each event type. |
| SMS not sent | Check your SMS credit balance in Settings → SMS Credits. |
| Staff member can't log in | Verify their account is active in Settings → Team. |
| Payment failed | Go to Billing and update your payment method, then retry. |

---

*For further assistance, visit the **Help** section inside the dashboard or contact support.*
