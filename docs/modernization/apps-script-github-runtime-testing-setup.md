# Google Apps Script Runtime Tests — GitHub Actions Setup

Workflow is manual-only (`workflow_dispatch`). It does not run on PRs, deploy, or push code to Apps Script; it calls a test entrypoint in a separately configured test project.

## Safety
- Use a copied Apps Script project and spreadsheet with synthetic data only.
- Never use production IDs. The test function must reject mismatched spreadsheet IDs.
- Do not share OAuth credentials in chat, PRs, issues, or logs.
- Store credentials only as GitHub Actions secrets.

## Repository secrets
Open repository Settings → Secrets and variables → Actions and create:

| Secret | Value |
|---|---|
| `GAS_TEST_SCRIPT_ID` | ID of the isolated Apps Script test project |
| `GAS_TEST_SPREADSHEET_ID` | ID of the isolated test spreadsheet |
| `GAS_CLASPRC_JSON` | Contents of locally authorized `~/.clasprc.json` for an account permitted to run the test |

Create and authorize OAuth locally. Prefer an account with access only to the test copy where feasible. Use a separate OAuth client/token. Keep Actions secrets access restricted.

## Apps Script prerequisites
1. Copy the spreadsheet and bound Apps Script project. Use synthetic data only.
2. Ensure the copied project is associated with a Google Cloud project as needed.
3. Enable the Apps Script API.
4. Configure API execution in the manifest and deploy as an API executable.
5. Copy `docs/modernization/apps-script-runtime-test-harness-template.gs` into the isolated test project (not production). It checks allocator uniqueness/monotonicity, reconciliation against a synthetic high ID, and duplicate insert rejection.
6. Run the test entrypoint locally once and verify it targets the test copy before configuring GitHub credentials.

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

True lock contention requires multiple independent API executions launched concurrently. The workflow's single invocation is a smoke/integration runner only; a separate concurrency driver will be added after the test entrypoint is installed and authorized.

## Cost and security
Expected to stay within GitHub Actions free quota and Apps Script quotas. This creates no paid deployment and makes no production changes. OAuth tokens are sensitive; revoke/rotate if exposed and remove the repository secrets when no longer required.
