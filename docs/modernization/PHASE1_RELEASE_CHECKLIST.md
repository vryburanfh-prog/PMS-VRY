# Phase 1 Release Checklist

## Code and review
- [ ] Draft PRs in the Phase 1 stack reviewed by repository owner.
- [ ] Conflicts resolved and branches consolidated as appropriate.
- [ ] All GitHub Actions workflows pass on final commit.
- [ ] Static audit report and test plan updated.

## Staging
- [ ] Deployment uses a staging copy of the container-bound workbook.
- [ ] Role and project-scope matrix tested.
- [ ] Password/Google login, lockout, session expiry and revocation tested.
- [ ] Registry field allowlists and approval-only status permissions tested.
- [ ] CRUD, delete snapshots and audit-failure behavior tested.
- [ ] Formula injection and import/rollback/formula-preservation tests passed.
- [ ] Public deck scope, token archive/revoke and sensitive-field review passed.
- [ ] Backup/restore drill passed on sandbox.
- [ ] Quota, latency, lock contention and cache invalidation measured.

## Production gate
- [ ] Full backup created and verified immediately before release.
- [ ] Restore plan and rollback owner confirmed.
- [ ] Production merge/deploy authorized by owner.
- [ ] Deployment ID/version and smoke-test evidence recorded.
- [ ] Post-release monitoring and maintenance-window exit approved.