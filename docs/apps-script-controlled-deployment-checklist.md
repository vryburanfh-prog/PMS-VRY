# Controlled Apps Script Deployment Checklist

## Scope

This checklist covers the Phase 2 project-controls additions on the modernization branch:
- `apiGetProjectControlsInputs(projectId)`
- `apiGetPortfolioControlsSummary(filters)`
- Portfolio Project Controls Watchlist and project-level Details view
- Read-only CPM/EVM calculation and reporting modules

**No deployment is authorized by this document.** The branch and pull request are not the live Apps Script deployment. Do not execute the deployment steps without an explicit release decision from the system owner.

## 1. Pre-deployment controls

- [ ] Confirm the release commit and pull request have been reviewed and explicitly approved.
- [ ] Confirm the target Apps Script project is the intended production project.
- [ ] Export/download a copy of the current Apps Script project source.
- [ ] Create a timestamped backup copy of the connected Google Sheets database; verify the backup opens.
- [ ] Record the current production deployment ID, version, web-app URL, and deployment settings.
- [ ] Confirm the deployment runs as the intended account and access is limited to the intended audience.
- [ ] Confirm required sheet tabs and headers exist: Activities_Schedule, Schedule_Dependencies, Project_Baselines, Milestones, Risks, Issues, and Financial_Monitoring.
- [ ] Confirm module permission names and role grants in production match the code's permission checks.
- [ ] Confirm the organization has approved the reporting status-date convention and the financial currency interpretation. The current controls view does not infer currency or fabricate PV/EV.

## 2. Staging verification

- [ ] Deploy to a non-production Apps Script deployment first.
- [ ] Test an administrator account and at least one restricted project-role account.
- [ ] Test a user assigned to one project and verify another project's ID is denied.
- [ ] For each module, test both allowed and denied view permission.
- [ ] Verify denied modules render as Restricted/unavailable, while allowed modules with no rows render as zero records.
- [ ] Verify archived activities, milestones, risks, and issues are excluded as designed.
- [ ] Verify project data is scoped by Project_ID and no cross-project records appear.
- [ ] Verify the watchlist aggregates only projects returned by the authorized portfolio API.
- [ ] Verify the project Details view is read-only and creates no sheet writes or audit mutations.
- [ ] Verify HTML-escaped project names and identifiers render safely.
- [ ] Verify existing project navigation, register, reports, approvals, and finance screens still work.
- [ ] Verify desktop and mobile layouts, and keyboard access to the Details and Close controls.
- [ ] Record test account roles, project IDs (non-sensitive test data), expected results, actual results, and defects.

## 3. Production release

- [ ] Obtain explicit release authorization.
- [ ] Publish a new Apps Script version; do not overwrite or delete the prior known-good deployment.
- [ ] Create a new deployment or update the deployment using the approved release procedure.
- [ ] Smoke-test sign-in, portfolio refresh, watchlist summary, one project Details view, and one denied-access case.
- [ ] Confirm the production deployment ID/version and URL are recorded.
- [ ] Monitor Apps Script executions and user-reported access issues after release.

## 4. Rollback

If access-control behavior, data scoping, rendering, or existing workflows fail:

1. Stop further rollout and record the observed error and deployment version.
2. Restore the previous known-good Apps Script deployment/version using the deployment manager.
3. Do not restore or overwrite spreadsheet data unless a separately approved data-recovery action is required; this feature is read-only.
4. Re-run sign-in, project assignment, module permission, portfolio refresh, and project navigation smoke tests.
5. Preserve execution logs and the failed version for diagnosis.
6. Document the rollback decision, time, responsible operator, and verification outcome.

## 5. Release acceptance

A release is acceptable only when:
- Automated Node.js tests pass on the exact release commit.
- Staging permission and project-isolation tests pass.
- The production backup and prior deployment are recoverable.
- The application owner explicitly authorizes release.
- No unresolved critical security, data-isolation, or regression defects remain.

## Current status

- This checklist is documentation only.
- The project-controls changes remain on the modernization branch and draft pull request.
- Production Apps Script and production spreadsheet data have not been changed.
