# Portfolio Controls Dashboard Integration

## Purpose

The portfolio dashboard adapter combines the PMS portfolio API response with detailed project-controls reports. It is a read-only presentation model; it does not read Google Sheets, authenticate users, write records, or replace the existing portfolio API.

## Data flow

1. The PMS client calls the existing `apiGetPortfolioData(filters)` Apps Script API using its normal authenticated session.
2. The API applies the user's Portfolio view permission and project assignment/global-viewer scope before returning visible projects and portfolio KPIs.
3. For each visible project for which the user is allowed to view the required modules, the client/server integration obtains the project-scoped records through existing authorized APIs.
4. The integration passes only those already-authorized records to `buildPmsProjectControlsReport({ project, statusDate, activities, dependencies, baselines, milestones, risks, issues, financialItems })`.
5. The integration passes the original portfolio API response and the resulting project reports to `buildPmsPortfolioDashboardModel(portfolioData, projectControlReports)`.
6. The resulting model preserves existing portfolio KPIs and provides project-level controls indicators and warnings.

## Authorization requirements

- Never call this adapter as a substitute for `apiGetPortfolioData` or the PMS permission checks.
- Never pass records from projects that are not present in the authenticated portfolio response.
- Build each detailed report only from records returned by an API that has already enforced the caller's module permission and project assignment.
- If a user cannot view a module (for example, Financial Monitoring), omit that module's records and expose the corresponding metric as unavailable. Do not infer a zero value.
- Do not expose raw risk or issue descriptions in a cross-project dashboard unless the caller has the relevant module permission.
- The adapter rejects any report whose project ID is outside the visible portfolio scope.
- Keep dashboard requests read-only. No save, approval, audit, or deployment action is performed by these functions.

## Important metric limitations

- CPM uses baseline duration in working-day units and supports Finish-to-Start dependencies with zero lag. Calendar and holiday logic must be supplied by a future calendar-aware layer.
- EVM SPI/CPI are intentionally unavailable until approved time-phased Planned Value and Earned Value data are provided. Progress percentages are not substituted for PV/EV.
- Currency is not inferred from the current Financial_Monitoring fields.
- Risk severity follows the existing PMS numeric bands: 15+ Critical, 10–14 High, 5–9 Medium. Unrecognized ratings remain unclassified.
- Project controls reports are optional per visible project. A project with no detailed report remains in the dashboard, with its controls subsection unavailable rather than treated as healthy.

## Example (Node integration layer)

```js
const { buildPmsProjectControlsReport } = require('../src/pms-project-controls');
const { buildPmsPortfolioDashboardModel } = require('../src/pms-portfolio-dashboard');

// portfolioData must be the response from the authenticated PMS API.
const projectReports = authorizedProjectInputs.map(input =>
  buildPmsProjectControlsReport(input)
);

const dashboard = buildPmsPortfolioDashboardModel(portfolioData, projectReports);
```

This Node adapter is not loaded directly by Google Apps Script. A future Apps Script integration must port or bundle compatible pure functions and must preserve the same authorization checks. Do not deploy a new API endpoint until that implementation is separately tested in the Apps Script runtime.


## Apps Script endpoint added on the modernization branch

The branch now contains `apiGetProjectControlsInputs(projectId)` in `Code.gs`. It is a read-only API endpoint that:

- Requires `Projects:view` for the requested project, which also enforces project assignment for non-administrators.
- Checks view permission independently for `WBS_Schedule`, `Milestones`, `Risks`, `Issues`, and `Financial_Monitoring`.
- Returns only rows whose `Project_ID` matches the requested project and excludes archived rows where applicable.
- Returns `null` for a dataset when its module permission is absent, and an empty array when access is granted but there are no records.
- Removes internal `_rowIndex` metadata from returned records.
- Does not write records, create audit entries, or change approvals.

The Node adapter now includes `buildPmsProjectControlsReportFromApi(apiData)`, which preserves module availability. A denied module is represented as unavailable rather than a healthy zero. Risk and issue summaries can still be computed when the schedule module is empty or inaccessible.

## Validation boundary

Static CI checks compile the Apps Script endpoint function and assert its permission gates, project scoping, metadata redaction, and read-only behavior. These checks do not replace deployment-time testing in the Google Apps Script runtime. The endpoint remains on this GitHub branch only; it has not been deployed to the live Apps Script project.


## Portfolio dashboard watchlist

The branch also adds `apiGetPortfolioControlsSummary(filters)`, used by the existing portfolio page in `index.html`. It derives its project set by calling the existing `apiGetPortfolioData(filters)`, so the portfolio's current role and project-assignment scope remains the source of truth.

The endpoint returns aggregate-only indicators (not source risk, issue, schedule, or financial records):
- Open high/critical risks
- Open issues
- Overdue milestones
- Forecast-late activities
- Projects over budget
- Projects over committed budget

Each metric is independently gated by its module view permission. A metric is `null` when the user lacks access or there are no source rows from which to assess it; zero is reserved for an available metric with no matching exceptions. The portfolio page displays unavailable metrics as an em dash. The watchlist is read-only and refreshes with the existing portfolio refresh action.

The portfolio endpoint uses the PMS risk score bands: scores 10–14 are High and 15+ are Critical. This is aligned with `computeRiskRatingLabel_` and the risk registry's stored rating labels.


The existing portfolio KPI response was also tightened so delayed-milestone, critical-risk, and open-issue totals are permission-gated. When a user lacks the relevant module permission, the API returns `null` and the dashboard displays an em dash rather than a misleading zero.

The watchlist now includes a project-level exceptions table alongside the portfolio totals. It shows only aggregate counts and budget/commitment flags for each project in the already-authorized portfolio. It does not expose raw risk descriptions, issue narratives, or financial line items.

## Exception prioritization

The dashboard model now exposes `prioritizedProjects` in addition to the original project ordering. It applies transparent, rule-based exception ordering; it is not a project-health score and does not introduce organization-wide thresholds:

1. **Urgent** — any open High/Critical risk, actual spending above budget, or overdue milestone.
2. **High** — commitments above budget or delayed activities, unless an Urgent condition is present.
3. **Attention** — open issues without a higher-priority exception.
4. **Monitor** — no recorded exceptions in the available controls.
5. **Incomplete / unavailable** — controls are missing or one or more module datasets are unavailable and no higher-priority exception can be established.

Each project includes reason text explaining its priority. Projects with equal priority retain their original portfolio order. The dashboard does not label a project Green/Amber/Red from this prioritizer; configurable health thresholds remain a separate, explicitly configured feature. Unavailable module data is never interpreted as evidence of good health.
