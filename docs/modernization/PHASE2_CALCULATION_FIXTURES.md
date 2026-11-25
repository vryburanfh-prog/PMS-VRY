# Phase 2 — Deterministic Calculation Fixtures

**Status:** Design/test fixtures only. These values are hand-calculated acceptance examples for future pure calculation helpers; they are not live project data.

## 1. Calendar and duration convention

The first CPM version should use calendar-day durations and the existing inclusive duration convention:

- Duration = (finish date − start date) + 1 for non-milestone activities.
- A duration-3 activity starting 2026-01-01 finishes 2026-01-03.
- For a zero-duration milestone, start and finish are the same date; treat it as a point event and do not coerce it to one day.
- Use date-only values and one agreed project timezone/cutoff for calculations; avoid mixing timestamps and date-only values.
- FS lag 0 means successor starts the day after predecessor finish under the inclusive date convention. Lag is calendar days in the first version; negative lag (lead) is permitted only after validated relationship calculations.
- Keep baseline and current-schedule CPM separate. Baseline date/finish fields are never overwritten by calculation output.

These conventions should be verified against existing Gantt/date calculations before implementation. If the existing Gantt uses different semantics, document and normalize that discrepancy instead of silently changing behavior.

## 2. CPM fixture — simple chain plus parallel path

Cutoff is not relevant to CPM fixture; all dates are calendar dates.

| Activity | Duration | Predecessor | Relationship | Expected early dates |
|---|---:|---|---|---|
| A | 3 | — | — | ES 2026-01-01; EF 2026-01-03 |
| B | 2 | A | FS, lag 0 | ES 2026-01-04; EF 2026-01-05 |
| C | 4 | — | — | ES 2026-01-01; EF 2026-01-04 |
| D | 1 | B and C | FS, lag 0 | ES 2026-01-06; EF 2026-01-06 |

Expected project finish: **2026-01-06**.

Expected backward pass / float with project finish fixed at 2026-01-06:

| Activity | LS | LF | Total float |
|---|---|---|---:|
| A | 2026-01-01 | 2026-01-03 | 0 |
| B | 2026-01-04 | 2026-01-05 | 0 |
| C | 2026-01-02 | 2026-01-05 | 1 |
| D | 2026-01-06 | 2026-01-06 | 0 |

Critical path: **A → B → D**. C is noncritical with one calendar day of total float. The fixture catches off-by-one errors in inclusive date arithmetic.

## 3. EVM fixture — two WBS budget allocations

Approved cost baseline allocations are 40 for A and 60 for B; BAC = 100. Planned/actual progress percentages are verified at the control date. PV uses the approved time-phased baseline curve; EV uses approved allocation × verified actual progress; AC uses actual-spend entries recorded through the cutoff.

| Allocation | BAC | Planned % at cutoff | Actual % at cutoff | PV | EV |
|---|---:|---:|---:|---:|---:|
| A | 40 | 100% | 100% | 40 | 40 |
| B | 60 | 50% | 25% | 30 | 15 |
| **Total** | **100** | — | — | **70** | **55** |

Actual cost at cutoff: AC = 65.

Expected metric values (rounded to 4 decimals for ratios):

| Metric | Formula | Expected |
|---|---|---:|
| BAC | Approved allocation total | 100 |
| PV | Planned value total | 70 |
| EV | Earned value total | 55 |
| AC | Actual spend total | 65 |
| SPI | EV / PV | 0.7857 |
| CPI | EV / AC | 0.8462 |
| SV | EV − PV | -15 |
| CV | EV − AC | -10 |
| EAC (CPI assumption) | BAC / CPI | 118.1818 |
| ETC | EAC − AC | 53.1818 |
| VAC | BAC − EAC | -18.1818 |

Also test the alternative EAC assumption **AC + (BAC − EV) = 110** and ensure the UI names the chosen method; do not present it as equivalent to BAC/CPI.

## 4. Required invalid/unavailable states

| Input condition | Expected behavior |
|---|---|
| BAC missing/negative or allocations do not reconcile | EVM unavailable or warning; do not silently use current budgets as historical baseline |
| PV = 0 | SPI unavailable (not 0, not infinity) |
| AC = 0 | CPI unavailable (not 0, not infinity) |
| Actual progress missing or unverified | EV unavailable or clearly marked with a data-quality warning |
| Cost allocation not linked to WBS/activity | Report as unallocated; do not distribute automatically |
| Invalid baseline dates or finish before start | Suppress affected planned-value/CPM calculations and surface validation |
| Duplicate allocation key / multiple baseline revisions | Reject or flag; require explicit baseline revision and cutoff |
| Dependency cycle, missing endpoint, self-link | Reject CPM calculation for invalid graph and return diagnostic IDs |
| Disconnected activities | Include in schedule results; identify as independent/unconnected path, do not silently omit |

## 5. Acceptance criteria

- The CPM fixture above returns exact date outputs and floats.
- EVM fixture ratios and forecasts match the table within documented rounding tolerance.
- Zero-denominator and missing-data cases return explicit unavailable states.
- Inputs are not mutated; baseline snapshots remain immutable.
- Results include baseline revision, control date, assumptions, and source record IDs so reviewers can reproduce them.
