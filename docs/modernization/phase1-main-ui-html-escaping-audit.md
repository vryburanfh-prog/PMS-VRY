# Phase 1: Main UI HTML escaping audit

## Static scan
- index.html contained 796 template interpolation markers and 128 direct .innerHTML assignment sinks at the start of this audit.
- Heuristic review highlighted project/workspace, WBS, baseline, project register, registry, progress log, weekly report, workload, procurement, financial, audit-log, inline-handler and link contexts.
- This is static triage, not a proof of exploitability or a live runtime assessment.

## Implemented in the draft modernization branch
- Escape dynamic project/workspace identifiers and labels, project table values, WBS IDs, baseline remarks, registry labels/cells, progress logs, weekly-report text, workload fields, procurement and financial values, audit log fields, and error messages.
- Escape serialized object payloads embedded in inline event-handler attributes.
- Sanitize dynamic registry and presentation-history links to HTTPS-only, rejecting credentials and non-HTTPS protocols.
- Add link-revocation controls to the main UI history list, gated by project-management capability; server-side permission and lock checks remain authoritative.
- Add focused static regression tests and CI.

## Remaining review
- Continue scanning remaining HTML interpolation sinks for context-specific risks.
- Verify dynamic class/style values are limited to normalized numbers or fixed allow-listed classes.
- No deployment or live browser validation performed; all work remains in draft PRs.


## Main UI history list follow-up

- Deck title, scope label, and created-at fields in the main UI presentation-history list are now escaped at their HTML sinks.
- Presentation-history link hrefs use the HTTPS sanitizer and privileged users can revoke published links from the main UI as well as the presentation generator UI.
