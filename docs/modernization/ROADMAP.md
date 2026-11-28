# PMS-VRY Modernization Program

## Scope and delivery principles
Modernize the existing Google Apps Script + Google Sheets PMS-VRY in five phases while preserving current functionality. Work is performed on feature branches, validated, and proposed through pull requests. No changes are applied to production/main without review and approval. Do not migrate platform or rewrite the UI until reliability/security and performance evidence justifies it.

## Phase 1 — Stabilization, audit, security, data integrity
**Status:** Audit underway; first targeted remediation PR is open and CI-validated in a mocked test environment. Runtime validation and broader remediation remain pending.
- Complete source audit: Security.gs, Database.gs, Code.gs, index.html, Presentation.html and module/API cross-check (in progress).
- Targeted remediation PR #100: PMO snapshot insertion lock/header-aware collision scan; five project deletion paths refactored to ID-based locked deletion; bulk cache invalidation after bulk insert. Static and mocked-runtime CI tests pass. Not merged or deployed.
- Follow-up PR #102 (stacked on PR #100): generated-ID inventory, atomic ID-and-append helper, mocked-runtime tests, and migrations of baseline, user, weekly-report, team-workload, procurement, financial, progress-log, Main WBS, Sub WBS, registry, and activity creation. CI passed on latest branch commit (push and pull-request checks).
- Security: token/session lifecycle, Google ID-token validation, authorization coverage, least privilege, admin allowlist, credential storage, login rate limiting, direct API protection, public deck token access.
- Data integrity: ID generation concurrency, uniqueness, foreign-key/project ownership, update field allowlists, deletion and audit snapshots, validation/normalization, formula preservation.
- Reliability: consistent errors and API responses, structured logs, backup/restore testing, rollback strategy.
- Performance: spreadsheet reads/writes batching, cache invalidation, quotas/timeouts, load profiling.
- Deliverables: audit findings (severity and evidence), remediation PRs, test plan, backup/restore runbook, release checklist.

## Phase 2 — Project controls and management intelligence
- Executive portfolio dashboard: project count, schedule/cost health, high risks/issues, overdue actions, milestone look-ahead, approvals queue.
- Health score transparent and explainable; configurable thresholds, weighted schedule/cost/risk/issue/resource/milestone indicators.
- Earned Value Management: PV, EV, AC, SPI=EV/PV, CPI=EV/AC, SV=EV-PV, CV=EV-AC; guard zero denominators and clearly state data quality limitations.
- Forecasting: finish date forecast, cost-at-completion/variance, trend indicators; preserve original approved baseline.
- Critical Path Method: dependency validation, cycle detection, forward/backward pass, total/free float, critical activities, baseline/current comparisons, delay drivers.
- Early warning rules: overdue tasks, progress lag, high/critical risk, overdue issue/action, approval aging, milestone predecessor gaps, budget burn vs progress, resource overload.
- Alerts include severity, project, record link, owner, trigger evidence, recommended action, due date, status/acknowledgment; notifications are configurable and non-spam.

## Phase 3 — Workflow, governance, and quality
- Change requests/change orders: request, rationale, scope/schedule/cost/resources/risk impacts, supporting docs, review/approval, decision, revised baseline linkage; baseline history immutable.
- Unified action register across issues, risks, meetings, reports, approvals; owner, priority, due date, origin, status, escalation, evidence.
- Approval workflow: configurable stages, roles, decision history, comments, delegation/aging, auditable transitions.
- Document register and revision control: doc number, title/type, revision, status, transmittal, reviewer comments, approval, expiry, Drive link, superseded warning; never silently replace approved revisions.
- Quality: ITPs/checklists, inspection requests, NCR, corrective/preventive action, punch list, acceptance, evidence/photos/signoffs.

## Phase 4 — User experience, reporting, and mobile
- Dashboard filters, saved views, actionable lists, bulk actions with confirmation.
- Mobile-first forms for field progress, photos/evidence, issue/risk capture, approvals.
- Report templates: weekly/monthly, executive, schedule, cost, risk, action, procurement, resource.
- CSV/Excel/PDF export with access controls and data masking as appropriate.
- Notifications: email/optional channels, preference settings, digest and escalation cadence.

## Phase 5 — AI and advanced analytics
- Permission-aware PMS Advisor grounded in live records: progress summaries, risk/issue analysis, delay causes, overdue action prioritization, report drafting.
- Cite record IDs and supporting facts in generated answers; distinguish observed data from inference; never silently modify records or approved baselines.
- Scenario planning: schedule/resource/cost what-if comparisons with assumptions and scenario isolation.
- Predictive indicators only after sufficient historical data and quality validation; show confidence and avoid overclaiming.

## Sequencing and acceptance gates
1. Audit baseline and backup verified before code changes.
2. P1 critical/high findings remediated and regression tests pass.
3. Phase 2 calculations independently verified against sample cases and existing project data.
4. Phase 3 approval/record transitions tested for permissions and audit history.
5. Phase 4 usability, mobile, export, notification tests pass.
6. Phase 5 privacy/permissions, grounding, prompt-injection, and no-write-by-default tests pass.

## Current first-pass observations
See [AUDIT_REPORT.md](AUDIT_REPORT.md). This is a preliminary review of retrieved source portions, not a completed full-code audit.
