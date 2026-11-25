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
