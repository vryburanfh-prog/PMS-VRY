# Phase 2 staging fixture — calculation notes

The synthetic fixture `tests/fixtures/phase2-staging-controls-fixture.json` is a hand-calculated reference, not a production import template. Its fields are deliberately generic and must be mapped to the staging spreadsheet's actual headers during validation.

## CPM hand-check

Working-day duration units and Finish-to-Start, zero-lag relationships only:

- ACT-01 (3 days) is the common start.
- ACT-02 (2 days) and ACT-03 (4 days) run in parallel after ACT-01.
- ACT-04 (1 day) starts after both ACT-02 and ACT-03 finish.

Path totals:

| Path | Duration |
|---|---:|
| ACT-01 → ACT-02 → ACT-04 | 3 + 2 + 1 = 6 |
| ACT-01 → ACT-03 → ACT-04 | 3 + 4 + 1 = 8 |

Therefore project duration is 8 units; critical path is ACT-01 → ACT-03 → ACT-04. ACT-02 has 2 units of total float; other activities have zero.

## Baseline snapshot hand-check

The active schedule has four activities. The approved snapshot has the same four plus ACT-OLD. Thus active matched = 4, active missing = 0, snapshot-only = 1, and changed start/finish counts = 0 for baseline date fields. Current dates are not baseline drift inputs; mutation scenario separately changes the active baseline date field.

## Mapping / execution cautions

- Use synthetic records only and translate fixture field names to the actual PMS sheet schema.
- Record the selected status date and actual staging build commit.
- Do not use fixture values to overwrite existing baselines or production rows.
- This document verifies arithmetic by hand; it does not claim runtime staging tests have been performed.
