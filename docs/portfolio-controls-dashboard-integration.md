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
