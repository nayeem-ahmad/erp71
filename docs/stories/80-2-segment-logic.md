# Story 80.2: Segment Logic Engine

Status: complete

## Story

As a Marketing Manager,
I want the system to automatically calculate and categorize customers into tiers (e.g., VIP, Regular, At-Risk),
so that I can easily target them with distinct messaging without manual calculation.

## Acceptance Criteria

1. A background worker or scheduled task computes segments nightly or on-the-fly. [ ]
2. Customers with lifetime spent > ৳50,000 (BDT) are designated 'VIP'. [ ]
3. Customers who haven't visited in > 30 days are marked 'At-Risk'. [ ]
4. The customer list UI displays these tags automatically. [ ]
5. Segmentation considers `customer_type` and `customer_group` — Organizations in "Wholesale" group may have different thresholds (future extensibility). [ ]

## Tasks / Subtasks

- [ ] Task 1: Background cron setup
  - [ ] Implement a cron service in `apps/backend/src/customers/segments.service.ts` using `@nestjs/schedule`.
- [ ] Task 2: Segmentation Aggregation Logic
  - [ ] Write Prisma aggregations mapping `total_spent` and updating the `segment_category` column in the `Customer` table.
  - [ ] Include `customer_group` context in segment calculation (prepare for group-specific rules).
- [ ] Task 3: UI Segment Badges
  - [ ] Update the Customer UI table to uniquely color-code segment tier badges.
  - [ ] Show segment alongside Customer Group and Territory in the list view.

## Dev Notes

- **Performance:** Avoid heavy real-time aggregations `SUM(sales.amount)` inside the `/customers` endpoint. Pre-compute and sync the segment tier directly in the `Customer` row.
- **Flexibility:** Initially hardcode threshold logic per Acceptance Criteria, but prepare the architecture to pull variables from `TenantSettings` eventually. Group-specific thresholds are a follow-up.
- **Dependencies:** Depends on 80.1 (revised Customer model with `customer_type`, `customer_group_id`).

### References

- [Source: docs/prd/epic-80-customer-segmentation.md]

## Dev Agent Record

### Agent Model Used

(to be filled by dev agent)

### Completion Notes List

(to be filled by dev agent)
