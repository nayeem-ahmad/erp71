# Story 80.3: Purchase History Dashboard

Status: complete

## Story

As a Cashier or Store Manager,
I want to view a customer's full profile (including code, type, group, territory, credit limit, discount) plus their complete purchase history,
so I can rapidly address inquiries, handle returns easily, or offer personalized recommendations.

## Acceptance Criteria

1. Clicking a `Customer` in the data table opens a detail view. [ ]
2. The detail view displays the full customer profile: Customer Code, Type, Group, Territory, Credit Limit, Default Discount %, Profile Picture, Segment badge. [ ]
3. The detail view lists every associated `Sale` and its `SaleItem` contents for that customer. [ ]
4. The view aggregates Top Purchased Items. [ ]
5. Credit utilization is shown if Credit Limit is set (total_spent vs credit_limit). [ ]

## Tasks / Subtasks

- [ ] Task 1: Customer Details Endpoint
  - [ ] Implement `GET /customers/:id/history` pulling sales joined with `SaleItem` and `Product` models.
  - [ ] Include `customerGroup` and `territory` relations in the response.
- [ ] Task 2: Customer Detail UI Page
  - [ ] Update `apps/frontend/src/app/dashboard/customers/[id]/page.tsx` to display all new fields.
  - [ ] Show profile picture, customer code, type badge, group name, territory name.
  - [ ] Show credit limit bar (used / limit) if credit_limit is set.
  - [ ] Show default discount percentage.
- [ ] Task 3: History Data Table
  - [ ] Include a paginated table viewing their specific receipt transactions (similar to the standard Sales list, but filtered by `customer_id`).

## Dev Notes

- **Dependencies:** Depends on 80.1 revision (enhanced Customer model), 80.4 (CustomerGroup), 80.5 (Territory).
- This view becomes the entry-point for **Epic 11: Sales Returns**, where clicking a purchased item prompts an "Issue Refund" button if within the 30-day window.

### References

- [Source: docs/prd/epic-80-customer-segmentation.md]

## Dev Agent Record

### Agent Model Used

(to be filled by dev agent)

### Completion Notes List

(to be filled by dev agent)
