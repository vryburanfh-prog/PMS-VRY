# Phase 2 CPM date and duration convention — implementation clarification

**Scope:** Current Phase 2 CPM implementation branch. This supersedes the earlier design-only calendar-date example for implementation validation.

## Calculation contract

The pure CPM helper accepts non-negative duration values in **working-day units** and calculates ES/EF/LS/LF as zero-based offsets. The helper does not apply a workweek, holiday calendar, timezone, or date conversion. EF/LF are exclusive finish offsets. The adapter/UI is responsible for date conversion and must not imply that the engine has applied a calendar.

The synthetic staging fixture's duration values are hand-calculated numeric working-day units only. They are not a promise of calendar dates or a calendar-day schedule. Actual staging validation must record which date conversion policy the PMS UI/adapter applies and compare converted dates separately.

## Reconciliation with earlier Phase 2 design documents

Earlier design and fixture documents described inclusive calendar-date arithmetic and date examples. Those were planning examples. The implementation evolved to an offset-based working-day-unit calculation contract. Do not use the older date examples as direct runtime expected values unless a tested date adapter maps them to the current helper convention.

## Validation requirements

- Verify that the adapter labels or converts CPM offsets consistently and does not claim holiday/weekend handling unless implemented.
- Verify date mapping with a separate hand-calculated test, including start-date convention, exclusive finish offset, milestone/zero-duration handling, and project timezone.
- Record unsupported calendar features as limitations; do not silently approximate them.
- The staging fixture's path totals remain 6 and 8 working-day units; the critical path remains ACT-01 → ACT-03 → ACT-04, with ACT-02 float of 2 units.
