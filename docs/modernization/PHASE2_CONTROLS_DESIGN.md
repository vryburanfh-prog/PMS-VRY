# Phase 2 — Project Controls & Management Intelligence Design

**Status:** Draft architecture and current-state assessment. No Phase 2 implementation is authorized for production.

## 1. Current-state source findings

| Capability | Existing source behavior | Gap / constraint |
|---|---|---|
| Progress roll-up | `recalculateProjectProgressEngine_` supports `Approved Activity Weights` and `Manually Approved WBS Weights`; rolls Activities/Sub-WBS/Main-WBS/Project | Data quality and independent formula test cases required; progress is not cost-earned value |
| Schedule dates | Activities hold baseline/actual/forecast dates and duration; Gantt API returns activities and dependencies | No full CPM forward/backward pass or float computation identified in the inspected source |
| Dependencies | Activity predecessor/type/lag fields and dependency records; cycle checks exist on inspected update path | Verify all relationship types, lag conventions, dependency-table consistency, and cycle tests |
| Baselines | Approved schedule baseline captures Main WBS, Sub WBS, Activities, dependencies as JSON snapshot | Current baseline snapshot does not include Financial_Monitoring cost allocation; no immutable cost baseline found |
| Schedule variance | `calculateScheduleVarianceDays_` compares finish date to baseline finish | Date variance only; no SPI or float, and it returns 0 when dates are missing (missingness can be mistaken for zero variance) |
| Financials | Financial monitoring records expose `Budget_Amount`, `Committed_Amount`, `Actual_Spend`, `Main_WBS_ID`, category/status; dashboard computes budget/actual/commit/burn | Cost records are not time-phased; baseline approved budget snapshot and control-period history needed |
| Executive dashboard | Project scope, progress, workload, procurement/financial, weekly reporting and risk signals already exist | Consolidate transparent health scoring and explainable warnings; preserve project-scoped permissions |
| Look-ahead risk | Schedule risk data includes WBS, milestone, deliverable, permit due-date lookahead | Extend to activity criticality, forecast slippage, action/approval aging and risk exposure with source evidence |

## 2. Phase 2 delivery order

### 2.1 Calculation library and validation fixtures
Build pure calculation functions separated from Apps Script Spreadsheet services. Test with small deterministic datasets and independent expected results before connecting the UI.

- Project progress roll-up verification (both existing weighting methods).
- Dependency normalization and graph integrity (missing predecessor/successor, duplicate edges, self-links, cycle detection, invalid lag).
- CPM forward/backward pass and float calculations.
- EVM calculations with explicit unavailable/invalid states.
- Explainable health scoring and threshold-based alert generation.

### 2.2 CPM (Critical Path Method)
Input is the **approved baseline** or selected current schedule scenario, activities, normalized dependency edges, durations, calendars, and lags. Initial release should use calendar-day durations, matching current `calculateDurationDays_` semantics; working-calendar support is a later extension.

- Supported relationships: FS, SS, FF, SF, positive/negative lag, validated with a common date arithmetic convention.
- Reject cycles, invalid/missing endpoints, self-dependencies, negative durations, and invalid dates before calculation.
- Forward pass computes early start/finish; backward pass computes late start/finish from project finish.
- Total float = late start minus early start; free float is the minimum successor early-start constraint less activity early finish (relationship-adjusted).
- Criticality is based on configurable float tolerance (default 0 days), not an existing manual `Is_Critical` flag.
- Output per activity: ES, EF, LS, LF, total float, free float, critical flag, calculated project finish, predecessor/successor IDs, and calculation warnings.
- Calculate baseline CPM and current CPM separately; compare forecast finish against baseline and list the longest/critical delay drivers.
- Avoid writing calculated dates/critical flags back to source rows in the first release. Calculations are read-only until users review results.

**Acceptance tests:** linear chain, parallel paths, multiple starts/finishes, FS/SS/FF/SF, lag/lead, zero-duration milestones, date boundaries, cycle, missing link, disconnected activity, and baseline/current comparison.

### 2.3 Earned Value Management (EVM)
Metric definitions:

| Metric | Definition | Data / caveat |
|---|---|---|
| BAC | Budget at Completion (approved cost baseline) | Sum of approved baseline budget allocations; reconcile to project Approved_Budget when used as fallback |
| PV | Planned Value = BAC-weighted baseline planned completion as of the control date | Requires a time-phased baseline curve; derive from baseline activity dates and approved allocation weights, not current schedule |
| EV | Earned Value = approved baseline budget allocation × actual progress | Use verified progress as of cutoff; prevent double-counting between WBS and activity levels |
| AC | Actual Cost | Financial Monitoring actual-spend entries as-of control date; if only current cumulative values exist, label period history unavailable |
| SPI | EV / PV | Not computable if PV is zero or unavailable; never display a fabricated zero |
| CPI | EV / AC | Not computable if AC is zero or unavailable |
| SV | EV − PV | Currency units; schedule variance by EVM differs from calendar-day variance |
| CV | EV − AC | Currency units |
| EAC | Forecast cost at completion | Use BAC/CPI when CPI is valid; optionally AC + (BAC−EV) under explicit assumption |
| ETC | EAC − AC | Forecast remaining cost |
| VAC | BAC − EAC | Forecast budget variance at completion |

**Baseline and budget rules:**
- The cost baseline must be approved and snapshotted immutably alongside a schedule baseline revision. Re-baselining is governed; preserve previous versions.
- Use Financial Monitoring `Main_WBS_ID` allocations where present. Budget records without a WBS allocation are reported as unallocated, not silently distributed.
- If only project-level Approved_Budget is available, allow a clearly marked fallback with no WBS-level cost performance until allocation is approved.
- Do not use current `Budget_Amount` as the historical BAC for a prior period.
- Budget allocation totals must be reconciled and validated before EVM metrics are presented.
- Progress quality, missing dates, invalid costs, duplicate allocations, or inconsistent baseline linkage should produce data-quality warnings and suppress unreliable metrics.

### 2.4 Forecasting
- Schedule forecast: CPM current schedule result plus baseline variance, critical-path drivers, and uncertainty ranges only after validated historical data exists.
- Cost forecast: EAC/ETC/VAC based on EVM; show the formula and the assumption (CPI trend vs remaining budget).
- Forecast confidence is qualitative initially (data completeness and stability); no statistical prediction until adequate historical snapshots are available.
- Do not overwrite baseline, approved dates, budgets, or actuals with forecast outputs.

### 2.5 Project and portfolio health score
Use a transparent configurable scorecard, not an opaque single AI score. Initial suggested domains:
- Schedule (CPM finish variance, critical-path slippage, milestone outlook)
- Cost (CPI/CV/EAC/VAC, budget data completeness)
- Risk (high/critical exposure and response aging)
- Issues/actions (overdue open actions and issue aging)
- Resources (active workload over-allocation)
- Governance (approval aging and baseline/change-control status)

Each indicator includes threshold, score contribution, source record IDs, calculation date, and explanation. Health must be `Unknown` when required data is missing—not green. Portfolio aggregates only projects the viewer is authorized to see and must not leak hidden project values.

### 2.6 Early warning rules and alerts
Start with deterministic, user-configurable rules: overdue activity/milestone/permit/deliverable; forecast finish beyond baseline; low SPI/CPI; high/critical risk without timely response; overdue issue/action/approval; resource allocation above 100%; and incomplete/invalid baseline data.

Alert record payload should include stable alert ID, project ID, severity, rule key/version, triggering record IDs, evidence values, recommended action, owner, due date, generated timestamp, status/acknowledgment, and resolution history. Avoid duplicate alerts by rule + project + source record + open state. Email/digest delivery comes later and must be configurable, permission-aware, and rate-limited.

## 3. Data model proposal (incremental; subject to schema review)

- Extend approved baseline snapshot to include approved financial budget allocations and baseline version metadata. Avoid silently changing old baseline JSON.
- Add a project control snapshot/history table for periodic immutable PV/EV/AC/SPI/CPI/forecast/health snapshots. Define one project + control date + baseline revision as the unique logical key.
- Add an alert registry with open/acknowledged/resolved states and source evidence, avoiding duplicate active alerts.
- Preserve current source tables as the system of record; computed metrics should be read-only outputs in the first implementation.
- All new tables require header migration, access-control mapping, schema validation, ID uniqueness, backup/restore, and import/export coverage.

## 4. UI integration proposal
- Project dashboard: top-level health summary, baseline vs forecast finish, EVM cards (with “not available” states), critical path list, next 14/30/60-day milestones, alerts and owner actions.
- Portfolio dashboard: project health, forecast completion, budget performance, high-risk count, overdue actions, and drill-down only where the viewer has access.
- Gantt: baseline/current overlay, critical-path highlighting, float and delay-driver details. Calculated CPM should be clearly marked as calculation results.
- Explainability drawer: metric formula, baseline revision, cutoff date, data source records, assumptions, and missing-data warnings.

## 5. Implementation gates
1. Phase 1 high-risk fixes reviewed and merged; test environment and backup/restore proven.
2. Calculation design and sample fixtures reviewed; formulas verified independently.
3. CPM and EVM calculation modules pass deterministic tests, including invalid inputs.
4. Server API permissions, project scoping, and baseline revision validation tested.
5. UI read-only pilot with representative data; performance and Sheets quotas measured.
6. Alerts only enabled after thresholds and recipients are approved; no production notifications by default.

## 6. Open design items (no decision needed yet)
- Calendar model (calendar days vs workdays, holidays, project-specific workweek).
- Approved baseline/cost baseline approval role and change-control policy.
- Whether progress/EV should be weighted by approved cost, activity weight, or both (cost-weighted EVM must use approved cost allocations).
- Control-period frequency (weekly vs monthly), timezone/cutoff policy, and source actual-cost period capture.
- Thresholds for project/portfolio health and alerting.
- Sheet growth, execution quotas, and expected project/portfolio scale.
