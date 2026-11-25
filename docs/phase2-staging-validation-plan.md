# PMS Modernization — Controlled Staging Validation Plan

**Status:** Ready for staging execution  
**Scope:** Modernization work on the Phase 2 branch only  
**Environment:** Isolated staging Apps Script deployment and non-production spreadsheet  
**Production impact:** None; production deployment and production data changes are expressly out of scope.

## Purpose

CI and isolated Node/VM tests have passed for the Phase 2 controls work. This plan defines the next verification gate using an isolated Apps Script runtime and representative test data. It is an execution checklist, not a claim that staging validation has already occurred.

## Preconditions

- [ ] Create/use a staging Apps Script project that is not connected to production.
- [ ] Use a separate, disposable test spreadsheet with synthetic records only.
- [ ] Ensure staging deployment and spreadsheet access are restricted to designated testers.
- [ ] Document the test build/commit and deployment version.
- [ ] Prepare test accounts for administrator, project-assigned viewer, module-restricted user, unassigned user, and unauthenticated session as applicable.
- [ ] Export a staging backup and verify it can be restored before destructive tests.
- [ ] Confirm no credentials, tokens, or production identifiers are copied into fixtures or logs.

## Test matrix

### Authorization and project isolation

- [ ] Unassigned users cannot read project controls inputs or aggregates.
- [ ] Project assignment is checked before module reads.
- [ ] Each module's view permission is independently enforced (schedule/baseline, milestones, risks, issues, finance).
- [ ] Restricted modules are reported as unavailable, not as zero-record datasets.
- [ ] A user authorized for Project A cannot retrieve Project B records by changing a project ID.
- [ ] Archived projects and archived rows follow the documented filtering rules.
- [ ] Blank/invalid project IDs fail closed.
- [ ] Public/share presentation endpoints expose only the intended curated fields.

**Acceptance:** Unauthorized requests are denied without restricted data reads; no cross-project leakage is observed; unavailable and empty datasets remain distinguishable.

### Data integrity and concurrency

- [ ] Duplicate primary-key insertions are rejected.
- [ ] Bulk insert detects duplicates within a batch and against existing rows.
- [ ] Concurrent create requests cannot persist duplicate identifiers.
- [ ] Concurrent scoped-delete attempts revalidate project scope under lock.
- [ ] Multi-step operations fail safely; verify recovery/logging for partial failures.
- [ ] Import formula-like strings are written as literal text.
- [ ] Backup/restore preserves expected headers, records, and key relationships.

**Acceptance:** No duplicate IDs or unauthorized mutations; failures are understandable and leave the system in a recoverable state.

### Project controls and management reports

- [ ] CPM: verify a small known Finish-to-Start, zero-lag sample; confirm critical path, duration, float, and cycle/invalid input handling.
- [ ] CPM limitations (working-day units, no calendar conversion) are clearly communicated.
- [ ] Baseline drift: validate date-change, missing-activity, and snapshot-only counters against hand-calculated fixtures.
- [ ] Milestones: verify overdue logic with the chosen status date and completion status.
- [ ] Risks/issues: verify open/closed and high/critical classification.
- [ ] Finance: verify budget, commitments, and actual spend sums; check over-budget and over-commitment flags.
- [ ] EVM: ensure PV/EV-based metrics remain unavailable unless valid time-phased PV and EV source data is present.
- [ ] Portfolio aggregation only includes the authorized visible project set.
- [ ] Missing module permissions/data coverage are displayed as unavailable/incomplete, not healthy/zero.
- [ ] Dashboard drill-down remains read-only and safely escapes project-controlled text.

**Acceptance:** Report totals match independent fixture calculations; unsupported metrics are not fabricated; read-only reporting does not mutate records.

### Regression and user experience

- [ ] Exercise common existing workflows: login/logout, navigation, project create/edit, schedule, milestones, risks, issues, financials, imports/exports, and presentations (as applicable to the test account).
- [ ] Check browser console for unexpected errors.
- [ ] Confirm loading, empty, restricted, error, and stale-response states are understandable.
- [ ] Check dashboard refresh and modal close/project switching for stale async responses.
- [ ] Verify responsive layout at representative desktop and mobile viewport widths.

**Acceptance:** Existing workflows show no blocking regressions; any issue is recorded with reproduction steps and severity.

## Evidence to record

For each test group, record: test ID, build/commit, tester role, synthetic project fixture, expected result, observed result, pass/fail, and sanitized evidence. Do not capture secrets or real project data.

## Defect handling

- **Blocker/Critical:** stop validation; do not promote.
- **High:** remediation and targeted regression required before release recommendation.
- **Medium/Low:** document, assess impact, and agree disposition before release.
- Retest fixed issues and rerun the affected suite plus relevant regression tests.

## Release gate and rollback rehearsal

- [ ] All mandatory checks pass with evidence.
- [ ] No open blocker/critical defects.
- [ ] High-severity defects are resolved.
- [ ] Backup restore rehearsal succeeds in staging.
- [ ] Rollback steps are exercised and verified.
- [ ] Authorized owner explicitly approves any production promotion.

## Not performed by this plan

This document does not perform a deployment, authorize production changes, access production data, or certify that staging tests have passed. Production promotion requires a separate explicit approval and controlled release procedure.
