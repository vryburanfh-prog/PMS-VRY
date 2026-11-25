# Phase 1 Regression Test Plan

## 1. Static and automated tests

Current repository tests:
- api-authorization-coverage.test.js: API inventory, allowlist/guard coverage, public deck classification, dispatcher/wrapper checks, digest API structure.
- presentation-html-escaping.test.js: Presentation dynamic interpolation regressions.
- index-html-escaping.test.js: main index dynamic field escaping, inline-script parsing after Apps Script template preprocessing, and HTTPS-only share URL validation.
- project-control-field-authorization.test.js: server allowlists match UI schema; reserved/required/protected fields.
- spreadsheet-formula-safety.test.js: generic/direct write sanitizer and import path.
- google-token-validation.test.js: provider/JSON failures and Google claim checks.
- import-formula-preservation.test.js: safe import writer and formula restoration.

Local mock harness result: 21/21 passed. CI result: blocked because GitHub Actions runner allocation fails before steps.

## 2. Staging test matrix

| Area | Scenario | Expected result |
|---|---|---|
| Authentication | Valid password user | Session created; 8-hour expiry; token stored as hash only. |
| Authentication | Repeated wrong password | Counter increments under lock; fifth failure locks for 15 minutes; generic failure. |
| Authentication | Expired/revoked session | Private API rejected. |
| Authentication | Google malformed tokeninfo/network failure | Safe generic failure; no token/URL logged. |
| Authentication | Wrong aud/azp/issuer, missing sub, unverified email, expired/future-issued | Rejected; no session. |
| Authorization | Unauthenticated direct API call | Rejected. |
| Authorization | User without project assignment | Project-scoped read/write denied. |
| Authorization | Edit-only user submits approval status | Rejected or status omitted; cannot approve. |
| Authorization | Approver changes status | Accepted only with approve permission. |
| Registry | Unknown payload field or reserved ID/project/created field | Rejected; no mutation. |
| Registry | Missing required field | Rejected; no mutation. |
| CRUD | Create/update/delete each registry | Correct record, project scope and audit snapshot. |
| Integrity | Concurrent duplicate ID create | Unique check prevents duplicate; collision failure/retry documented. |
| Formula safety | Leading equals/at/non-numeric plus or minus/whitespace formula | Stored as literal text. |
| Formula safety | Numeric and negative numeric values | Numeric semantics preserved. |
| Import | Header mismatch or duplicate/missing IDs | Rejected before mutation. |
| Import | Formula cells and formula-like text | Actual formulas preserved; text formulas neutralized. |
| Import rollback | Forced mid-import failure | Touched tabs restored; rollback failures surfaced. |
| Backup | Restore selected tabs from backup | Counts, keys, formulas and access verified on sandbox. |
| Public deck | Valid token and published deck | Read-only deck returned. |
| Public deck | Invalid, archived or missing token | No deck returned. |
| Public deck | Payload sensitivity review | Only client-approved data included. |
| Reliability | Audit write fails after mutation | Warning/reconciliation behavior verified. |
| Performance | Large sheet/concurrent reads/writes/reports | Latency, quotas, locks, timeouts and cache behavior recorded. |

## 3. Evidence

Record staging deployment/version, test date, actor role, project reference (non-sensitive), scenario, expected/actual result, and screenshot/log evidence. Never record password/token values. Attach the results to the Phase 1 release PR.