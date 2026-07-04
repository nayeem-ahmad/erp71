# Epic 84: CRM & Customer Dashboard

### Epic Goal
Visualize customer acquisition, loyalty, and purchase behavior to drive repeat business.

### Epic Description
**Key Features:**
*   **Top 10 Customers:** By total spend and frequency.
*   **Customer Retention Rate:** Track new vs. returning customers.
*   **Loyalty Points Liability:** Total points currently held by customers.

**Stories:**
1. **Story 1: Customer Insight API** - Aggregate transaction history by customer profile.
2. **Story 2: CRM Dashboard UI** - Customer ranking lists and loyalty program metrics.
3. **Story 3: Customer Credit/AR Aging Report** - Every credit sale, payment, and adjustment is tracked as an immutable ledger row per customer (`CustomerCreditTransaction`); outstanding credit-sale balances roll up into a standard 0-30/31-60/61-90/90+ day aging report per customer. Status: Done — `getDueAgingReport()` in `customers.service.ts`, `GET /customers/reports/due-aging`, `apps/frontend/src/app/(app)/sales/customers/reports/due-aging/page.tsx`.
