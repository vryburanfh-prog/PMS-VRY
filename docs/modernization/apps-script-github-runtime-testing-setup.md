# Google Apps Script Runtime Tests — GitHub Actions Setup

This workflow is **manual-dispatch only**. When run, it authenticates to the isolated Apps Script test project, pulls the current remote project, replaces only `Database.gs` and `Phase1RuntimeTestHarness.gs` from this branch, pushes the project, creates a new Apps Script version, and updates the existing API Executable deployment. It then runs the sequential and parallel runtime checks.

The workflow is guarded to accept only the known isolated Phase 1 test script ID. Each runtime test also checks that the active spreadsheet matches `GAS_TEST_SPREADSHEET_ID`. Do not configure production IDs.

## Safety and cost controls

- Use a copied Apps Script project and spreadsheet containing synthetic data only.
- Never use production script or spreadsheet IDs.
- Do not share OAuth credentials in chat, PRs, issues, or logs.
- Store credentials only as GitHub Actions secrets.
- Do not enable Google Cloud billing or add a payment method for this test setup.
- Use standard GitHub-hosted runners only. The repository is public, so standard GitHub-hosted runner usage is free under GitHub's public-repository policy. Avoid larger paid runners.
- Apps Script and Google APIs remain subject to account quotas and service-specific terms. This workflow has not been run against Google in this repository yet.

## Repository secrets

Open repository Settings → Secrets and variables → Actions and create:

| Secret | Value |
|---|---|
| `GAS_TEST_SCRIPT_ID` | ID of the isolated Apps Script test project (the script ID from its editor URL). It must match the hard-coded safety-guard ID in the workflow. |
| `GAS_TEST_SPREADSHEET_ID` | ID of the isolated test spreadsheet bound to that test project. |
| `GAS_TEST_GCP_PROJECT_ID` | **Project ID** of the standard Google Cloud project associated with the test script (not the Apps Script script ID or the project number). |
| `GAS_CLASPRC_JSON` | Contents of locally authorized `~/.clasprc.json` for an account permitted to run the test. |
| `GAS_TEST_DEPLOYMENT_ID` | Optional but recommended: exact deployment ID of the isolated API Executable. If omitted, the workflow selects a uniquely labelled API Executable deployment, or falls back only when the project has exactly one deployment. |

Create and authorize OAuth locally. Prefer an account with access only to the test copy where feasible. Use a separate OAuth client/token. Keep Actions secrets access restricted.

## Apps Script prerequisites

1. Copy the spreadsheet and bound Apps Script project. Use synthetic data only.
2. Create/use a **standard Google Cloud project** (not the default Apps Script-managed project) and associate the copied script with it. The Apps Script project and OAuth client used by `clasp` must share this Cloud project.
3. Enable the Apps Script API in that Cloud project and configure the OAuth consent screen/client. The OAuth client should be a Desktop application for the local authorization flow. Do not enable Cloud Billing or subscribe to paid services for this test.
4. In the test project's manifest, configure API execution access as `MYSELF` (only the deploying owner can execute). Deploy as an API executable. Do not use anonymous access.
5. Confirm that the script ID is the isolated test project ID and that the spreadsheet ID is the copied test spreadsheet ID. Do not put production identifiers in the secrets.
6. Authorize `clasp` locally using the OAuth client and required scopes. Never paste the token or refresh token into chat. Restrict access to the GitHub repository because its Actions secret can act as the authorized Google account.

## What the workflow does

1. Checks that all required secrets are configured. If any are missing, it reports a blocked setup and makes no Google API call.
2. Checks the script ID against the fixed isolated-test-project allowlist. A mismatch stops the job before pulling or changing any Apps Script files.
3. Pulls the complete isolated Apps Script project, then replaces only `Database.gs` and `Phase1RuntimeTestHarness.gs` with the versions from this branch. Other pulled project files are retained.
4. Pushes the isolated project, creates a new Apps Script version, and updates the selected API Executable deployment.
5. Runs the sequential runtime suite, then launches ten independent allocator calls and ten independent duplicate-insert calls.
6. Verifies that the ten allocator calls return distinct IDs and that the duplicate-insert test accepts exactly one insert and rejects nine attempts. It then checks and cleans up the synthetic duplicate-race test tab.
7. Uploads the JSON test results as a short-lived GitHub Actions artifact.

## Run

1. Open the repository Actions tab.
2. Select **Apps Script Runtime Integration Tests**.
3. Click **Run workflow** and select the suite.
4. Review the logs and download the `apps-script-runtime-test-result` artifact.

Missing secrets produce a notice and a blocked/no-execution result. That is **not** a passing test.

## Current automated coverage

- ID allocator uniqueness and strictly increasing allocation sequence.
- Reconciliation against a synthetic high ID already present in the test sheet.
- Duplicate primary-key insert rejection.
- Ten independent allocator invocations returning ten distinct IDs.
- Ten independent duplicate-insert invocations resulting in one accepted insert and nine duplicate rejections.
- Cleanup and verification of the synthetic duplicate-race test data.

The parallel calls are independent invocations submitted concurrently by the workflow. Google may queue Apps Script executions, so this verifies behavior under concurrent submission/contention but does not prove that all executions overlapped at the exact same instant.

## Cost and security notes

The repository is public and the workflow uses the standard `ubuntu-latest` GitHub-hosted runner. Those runner minutes are free for public repositories. The workflow does not provision a paid runner, paid hosting, or a paid deployment product. Apps Script/API calls still consume Google account quotas; monitor quota usage and stop if Google reports a quota or billing requirement. Do not enable billing to make the test proceed.

The OAuth secret in GitHub Actions can act as the authorized account. Limit repository access, keep the API executable restricted to `MYSELF`, do not grant Apps Script project-edit access unless required for the isolated test, and revoke/rotate credentials if exposed. Remove repository secrets when no longer required.
