# Phase 1 Source Audit and Remediation Status

Repository: PMS-VRY
Review status: Static audit substantially complete; runtime acceptance pending.
Scope: Security.gs, Database.gs, Code.gs, index.html, Presentation.html, module/API inventory, and modernization documentation.

## Current evidence

- 65 top-level api endpoints in Code.gs. All private API names are present in the dispatcher allowlist and contain an authorization/authentication guard in the static coverage test. The token-published client deck endpoint is separately classified as public and token-gated.
- Server, Presentation inline script, and index inline script (after Apps Script template directives are substituted) parse successfully.
- UI and server registry field allowlists match across all seven registry modules.
- Local mock harness executed the regression suite: 21/21 tests passed. This is not a substitute for GitHub Actions, Apps Script runtime tests, or browser/staging tests.
- GitHub Actions runner allocation is blocked before job steps. Tests are not yet executed on GitHub runners.

## Remediation items

| Priority | Finding | Status | Remaining gate |
|---|---|---|---|
| P1 | Registry payload accepted arbitrary table fields; edit permission could modify approval status without approval permission. | Remediated in draft PR #91. | Test role behavior in staging. |
| P1 | Dynamic HTML interpolation risks in Presentation UI. | Remediated across draft PRs #82, #83, #90 and #94. | Browser/XSS staging tests. |
| P1 | Formula injection through user-entered strings in sheet writes. | Remediated in draft PRs #92 and #94. | Confirm Apps Script sheet behavior on staging. |
| P1 | Google ID-token verifier error handling and claims. | Remediated in draft PR #93. | Test provider failures and Google login in staging. |
| P1 | Scheduled digest status/save API declaration boundary malformed. | Remediated in draft PR #85. | Trigger lifecycle staging test. |
| P1 | Private API direct-call authorization. | Static coverage in PR #85. | Exercise unauthenticated and cross-project calls in staging. |
| P2 | Custom PBKDF2-like password KDF lacks known-vector verification and Apps Script benchmark. | Residual. | Verify standard PBKDF2-HMAC-SHA256 vectors; benchmark latency and quotas. |
| P2 | Password lockout is per credential (5 failures, 15-minute lock); unknown usernames receive delay but no persistent counter. | Existing control; residual. | Test concurrency, recovery, username rotation and abuse options without global lockout DoS. |
| P2 | ID allocation is serialized in inspected create APIs and insert helpers enforce primary-key uniqueness. | Existing control; residual. | Concurrent create test; document collision retry/failure behavior. |
| P2 | Business mutation and audit writes are separate; audit failure can leave a missing audit event. | Partial mitigation. | Test failures and add reconciliation/alerts where needed. |
| P2 | Cross-module ownership, foreign-key and enum/date/numeric validation across all APIs. | Partial. | Broader staging tests for WBS, schedule, procurement, finance, reports, assignments and approvals. |
| P2 | Import/reset backup and rollback. | Strengthened in PR #94; runtime pending. | Sandbox restore drill, rollback failure test and formula check. |
| P2 | Cache, performance, quota and timeout behavior. | Static review only. | Profile realistic sheet sizes and concurrency. |
| P2 | Public client-deck token expiry. | Decision pending. | Token is 32 hex characters and retrieval requires published status; confirm whether expiry is required and test sensitive payload scope/archive revocation. |

## Phase 1 exit gates

1. Draft remediation PR stack reviewed and merged only with owner approval.
2. CI runners available and workflows green on the final commit.
3. Staging regression matrix completed for login/session/role/project scope, CRUD, approval permissions, delete/audit, formula text, import/rollback and public-deck revocation.
4. Backup/restore drill completed on a non-production copy, with row counts and formulas checked.
5. Quota/performance test and rollback/deployment checklist completed.
6. Production deployment and data migration explicitly authorized.

Current status: Do not mark Phase 1 complete until gates 2–5 are evidenced. No merge or deployment has been performed.