# Phase 1 Acceptance Checklist

**Phase:** Stabilization, audit, security, data integrity  
**Status:** Active; targeted code remediations CI-validated, runtime acceptance pending.  
**Current branch:** `pms-modernization/phase1-atomic-id-inventory`  
**Stack:** PR #100 → PR #102. Both open; neither merged/deployed.

## Implemented and CI-validated

- [x] Snapshot insertion lock, header-aware collision scan, locked ID-based deletion, and bulk cache invalidation (PR #100).
- [x] Atomic generated-ID insert helper and caller-supplied-ID insert helper.
- [x] All 19 generated-ID call sites across `Code.gs` and `Security.gs` migrated; static gate prevents legacy allocator call sites.
- [x] Baseline revision allocation and live source-table snapshot capture occur under the insertion lock.
- [x] Password login failure counters and lockout state update under ScriptLock.
- [x] User email and credential username uniqueness checks execute under the insertion lock.
- [x] User creation rolls back the new user row if credential creation fails.
- [x] Google ID-token claims are safely parsed and validated (audience, authorized party, subject, issuer, verified email, expiry, issued-at bounds).
- [x] CSV formula-prefix defense has regression tests and preserves numeric negative values.
- [x] Targeted XSS hardening across registry, WBS/schedule, project/portfolio, progress logs, weekly reports/print exports, workload, procurement, financials, governance audit, and portfolio roll-up renderers.
- [x] Inline script syntax regression test, mocked-runtime tests, and consolidated Node CI passed on commit `ee676f4627d96c4ac2d0357aa1f6cebd0ba1eeac`.

## Still open / acceptance work

- [ ] Finish full source/taint audit across remaining `innerHTML` paths and `Presentation.html`.
- [ ] Real Apps Script runtime tests using an isolated non-production spreadsheet.
- [ ] Concurrent create tests for generated IDs, supplied project IDs, baseline revisions, and username/email uniqueness.
- [ ] Validate cache invalidation, failure/lock release, and project deletion against Apps Script runtime.
- [ ] Backup/restore and rollback test.
- [ ] Review consolidated PR diff and resolve any findings.
- [ ] PR #100 merged into main after review.
- [ ] PR #102 rebased/stack base updated and merged only after PR #100 and Phase 1 acceptance.
- [ ] No production deployment until acceptance and review.

## Runtime test guide

See `PHASE1_RUNTIME_TEST_PLAN.md` for the isolated runtime test matrix and evidence requirements.
