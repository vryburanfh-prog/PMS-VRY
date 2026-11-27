# Google Apps Script Runtime Tests — GitHub Actions Setup

Workflow is manual-dispatch only. It does not automatically synchronize repository source into Apps Script. `clasp run` calls the separately configured Apps Script test project; it does not upload the files in this repository.

## Safety
- Use a copied Apps Script project and spreadsheet with synthetic data only.
- Never use production IDs. The test function must reject mismatched spreadsheet IDs.
- Do not share OAuth credentials in chat, PRs, issues, or logs.
- Store credentials only as GitHub Actions secrets.

## Repository secrets
Open repository Settings → Secrets and variables → Actions and create:

| Secret | Value |
|---|---|
| `GAS_TEST_SCRIPT_ID` | ID of the isolated Apps Script test project (the script ID from its editor URL) |
| `GAS_TEST_SPREADSHEET_ID` | ID of the isolated test spreadsheet bound to that test project |
| `GAS_TEST_GCP_PROJECT_ID` | **Project ID** of the standard Google Cloud project associated with the test script (not the Apps Script script ID or the project number) |
| `GAS_CLASPRC_JSON` | Contents of locally authorized `~/.clasprc.json` for an account permitted to run the test |

Create and authorize OAuth locally. Prefer an account with access only to the test copy where feasible. Use a separate OAuth client/token. Keep Actions secrets access restricted.

## Apps Script prerequisites
1. Copy the spreadsheet and bound Apps Script project. Use synthetic data only.
2. Create/use a **standard Google Cloud project** (not the default Apps Script-managed project) and associate the copied script with it. The Apps Script project and OAuth client used by `clasp` must share this Cloud project.
3. Enable the Apps Script API in that Cloud project and configure the OAuth consent screen/client. The OAuth client should be a Desktop application for the local authorization flow.
4. In the test project's manifest, configure API execution access as `MYSELF` (only the deploying owner can execute). Deploy as an API executable. Do not use anonymous access. Google documents the API executable access modes and requirements in its official docs.
5. Synchronize the Phase 1 runtime dependencies into the isolated test project only:
   - Replace/create `Database.gs` using the exact file from the Phase 1 branch in this repository. This file contains `generateNextId_`, `insertRecord_`, `getMasterSpreadsheet_`, and `PRIMARY_KEY_COLUMNS_BY_TAB_` used by the runtime checks.
   - Add `docs/modernization/apps-script-runtime-test-harness-template.gs` as a script file in that same isolated project. It defines `phase1RuntimeIntegrationTestSuite` plus the parallel probe functions `phase1RuntimeParallelAllocatorProbe`, `phase1RuntimePrepareDuplicateRace`, `phase1RuntimeDuplicateInsertProbe`, and `phase1RuntimeVerifyAndCleanupDuplicateRace`.
   - Do not copy the whole web app or production project settings for this smoke test. Do not make these changes in the production Apps Script project.
6. Save the project, then update its API executable deployment so the deployed version includes the saved source. The GitHub workflow invokes the deployed function with `clasp run`; it does not push files or update deployments.
7. Authorize `clasp` locally using the OAuth client and project scopes, then run the test entrypoint locally once and verify it targets the isolated spreadsheet before configuring GitHub credentials. The token/refresh token is sensitive and grants access as your Google account.

## Run
1. Open the repository Actions tab.
2. Select Apps Script Runtime Integration Tests.
3. Click Run workflow and select the suite.
4. Review logs and download the `apps-script-runtime-test-result` artifact.

Missing secrets produce a notice and a blocked/no-execution exit. That is **not** a passing test.

## Planned coverage
- ID allocator monotonicity and Script Properties persistence
- Reconciliation with synthetic high IDs
- Duplicate primary-key insert rejection
- Bulk duplicate rejection before writes
- Permission seeding idempotency/race
- Lock release after controlled failures

The manual workflow first runs the sequential smoke suite, then launches ten independent `clasp run` invocations concurrently for ID allocation and ten concurrently for duplicate insertion. It verifies ten distinct allocated IDs and exactly one accepted / nine rejected duplicate insert attempts. The parallel driver requires the updated harness functions to be installed and included in the isolated API executable deployment before the workflow is run.

## Cost and security
Expected to stay within GitHub Actions free quota and Apps Script quotas. This creates no paid deployment and makes no production changes. **Security note:** the OAuth secret in GitHub Actions can act as the authorized account; limit repository access, keep the test script API executable restricted to `MYSELF`, do not grant Apps Script API project-edit access unless separately needed, and revoke/rotate credentials if exposed. Remove repository secrets when no longer required.
