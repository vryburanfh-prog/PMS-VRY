'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPmsPortfolioDashboardModel } = require('../src/pms-portfolio-dashboard');

const portfolio = {
  success: true,
  projects: [
    { Project_ID: 'P-1', Project_Name: 'Alpha', Project_Status: 'Active', Project_Health: 'Amber', Overall_Planned_Progress: 60, Overall_Actual_Progress: 50 },
    { Project_ID: 'P-2', Project_Name: 'Beta', Project_Status: 'Completed', Project_Health: 'Green', Overall_Planned_Progress: 100, Overall_Actual_Progress: 100 }
  ],
  kpis: { totalProjects: 2, avgPortfolioProgress: 75, criticalRisks: 1, openIssues: 2 }
};

test('combines existing portfolio KPIs with project controls and warnings', () => {
  const model = buildPmsPortfolioDashboardModel(portfolio, [
    { projectId: 'P-1', projectName: 'Alpha',
      riskSummary: { highOrCriticalOpen: 1 }, issueSummary: { open: 2 },
      scheduleAlerts: { overdueMilestoneCount: 1, delayedActivityCount: 0 },
      finance: { overBudget: true, overCommitment: false },
      warnings: ['One overdue milestone'] }
  ]);
  assert.equal(model.success, true);
  assert.equal(model.source, 'authorized-apiGetPortfolioData');
  assert.equal(model.portfolioKpis.criticalRisks, 1);
  assert.equal(model.projectControls.projectCount, 1);
  assert.equal(model.projects.length, 2);
  assert.equal(model.projects[0].controls.highOrCriticalOpenRisks, 1);
  assert.deepEqual(model.projects[0].warnings, ['One overdue milestone']);
  assert.equal(model.projects[1].controls, null);
});

test('rejects reports for projects outside the authorized portfolio', () => {
  assert.throws(() => buildPmsPortfolioDashboardModel(portfolio, [
    { projectId: 'P-999' }
  ]), /outside the authorized portfolio scope/);
});

test('rejects malformed portfolio API responses and duplicate visible projects', () => {
  assert.throws(() => buildPmsPortfolioDashboardModel({ success: false }, []), /successful apiGetPortfolioData/);
  assert.throws(() => buildPmsPortfolioDashboardModel({
    success: true, projects: [{ Project_ID: 'P-1' }, { Project_ID: 'P-1' }]
  }, []), /missing or duplicate Project_ID/);
});

test('prioritizes observable project exceptions without numeric health thresholds', () => {
  const { prioritizeProjectExceptions, sortProjectsByExceptionPriority } = require('../src/pms-portfolio-dashboard');
  const urgent = prioritizeProjectExceptions({ controls: {
    highOrCriticalOpenRisks: 1, overBudget: false, overdueMilestones: 0,
    overCommitment: false, delayedActivities: 0, openIssues: 0,
    availability: { schedule: true, milestones: true, risks: true, issues: true, financialMonitoring: true }
  } });
  assert.equal(urgent.level, 'urgent');
  assert.match(urgent.reasons.join(' '), /high\/critical risk/);

  const incomplete = prioritizeProjectExceptions({ controls: {
    highOrCriticalOpenRisks: null, overBudget: null, overdueMilestones: null,
    overCommitment: null, delayedActivities: null, openIssues: null,
    availability: { schedule: false, milestones: false, risks: false, issues: false, financialMonitoring: false }
  } });
  assert.equal(incomplete.level, 'incomplete');

  const ordered = sortProjectsByExceptionPriority([
    { projectId: 'monitor', controls: { highOrCriticalOpenRisks: 0, overBudget: false, overdueMilestones: 0, overCommitment: false, delayedActivities: 0, openIssues: 0, availability: {} } },
    { projectId: 'urgent', controls: { highOrCriticalOpenRisks: 1, overBudget: false, overdueMilestones: 0, overCommitment: false, delayedActivities: 0, openIssues: 0, availability: {} } },
    { projectId: 'none', controls: null }
  ]);
  assert.deepEqual(ordered.map(project => project.projectId), ['urgent', 'monitor', 'none']);
  assert.equal(ordered[0].exceptionPriority.level, 'urgent');
});

test('ranks over-budget and overdue milestones ahead of routine open issues', () => {
  const { prioritizeProjectExceptions } = require('../src/pms-portfolio-dashboard');
  const base = { highOrCriticalOpenRisks: 0, overBudget: false, overdueMilestones: 0,
    overCommitment: false, delayedActivities: 0, openIssues: 1, availability: {} };
  assert.equal(prioritizeProjectExceptions({ controls: Object.assign({}, base, { overBudget: true }) }).level, 'urgent');
  assert.equal(prioritizeProjectExceptions({ controls: Object.assign({}, base, { overdueMilestones: 1 }) }).level, 'urgent');
  assert.equal(prioritizeProjectExceptions({ controls: base }).level, 'attention');
});

