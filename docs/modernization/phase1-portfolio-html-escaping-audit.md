# Phase 1: Follow-on HTML escaping audit (portfolio-level UI)

## Scope and method

Static scan of `Presentation.html` on the repository default branch for template-string interpolations that do not appear to use the existing HTML escaping helpers. This is a triage inventory, not a proof of exploitability: each interpolation must be checked against its rendering context (HTML text, attribute, JavaScript, CSS, or URL) before remediation.

## Candidate areas

- Project workspace scope/header: client, project manager, project location, project ID, project name, and selected tab name are interpolated into HTML text.
- Portfolio dashboard/project register: client, project manager, project location, status, health, progress labels, and project attributes appear in table/card templates.
- Project WBS display: Main WBS identifiers and several numeric values appear in template output; identifiers should be HTML-escaped even if numeric fields are normalized.
- Project baseline display: approver, approval date, and remarks appear in output templates.
- Filter controls: manager/client options and dynamic option lists are interpolated into option values and labels. Values and labels require context-appropriate escaping.
- Controls registry: schema labels, registry names, status options, and field labels are interpolated into generated HTML; review value/label handling and attribute contexts.
- Project edit control: serialized project data is embedded in an inline handler. Prefer a safe argument serializer/attribute encoding helper or remove inline handler and bind events through DOM APIs.

## Suggested implementation sequence

1. **Portfolio/project-register text and attributes:** escape project/client/manager/location/status/health text, and encode option values and labels with dedicated context-safe helpers.
2. **Workspace scope and WBS/baseline templates:** escape identifiers, names, dates, remarks, and dynamic tab labels; keep numeric output normalized.
3. **Controls registry generated markup:** escape all schema labels, dynamic status values, search placeholders, and button labels; audit attribute and inline-handler contexts separately.
4. **Inline event handlers:** replace ad-hoc JSON quoting/HTML entity substitution with the existing safe JS argument helper where applicable; test quotes, backslashes, angle brackets, and Unicode.
5. **Regression tests:** create targeted tests that assert risky source fragments are passed through the correct helper. Include adversarial payload fixtures such as `<img src=x onerror=alert(1)>`, quote-breaking strings, and `</script>` where the context allows.
6. **CI:** add a dedicated Node test workflow for this test suite and keep permissions read-only, with concurrency cancellation enabled.

## Static scan observations

The default-branch scan found roughly 740 template interpolation markers in `Presentation.html`. A simple heuristic flagged a number of candidate lines in portfolio/project UI and registry rendering. Because the existing modernization PR stack already adds escaping to multiple operational and presentation templates, follow-on work should be incremental and avoid overlapping changes with the current stacked branches.

## Validation / limitations

- Reviewed source text via GitHub fetch and searched interpolated template lines for existing escaping helper names.
- No live application was deployed or exercised.
- No exploitability claims are made without checking each sink and source.
- Implement changes on a branch stacked after the weekly-report HTML-escaping work; do not merge/deploy until tests and branch-stack review are complete.
