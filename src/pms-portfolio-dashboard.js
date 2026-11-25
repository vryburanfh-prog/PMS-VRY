'use strict';

const { buildPmsPortfolioControlsSummary } = require('./pms-project-controls');

/**
 * Combines the existing authorized apiGetPortfolioData response with optional
 * detailed project-controls reports. The caller must obtain portfolioData from
 * the authenticated PMS API and build each report only from rows authorized
 * for that project. Reports for projects outside the visible portfolio fail
 * closed rather than leaking data into the dashboard.
 */
function buildPmsPortfolioDashboardModel(portfolioData, projectControlReports) {
  if (!portfolioData || portfolioData.success !== true || !Array.isArray(portfolioData.projects)) {
    throw new TypeError('A successful apiGetPortfolioData response is required');
  }
  const visibleProjects = portfolioData.projects;
  const visibleIds = new Set(visibleProjects.map(project => String(project.Project_ID || '').trim()).filter(Boolean));
  if (visibleIds.size !== visibleProjects.length) {
    throw new Error('Portfolio response contains missing or duplicate Project_ID values');
  }
  const reports = Array.isArray(projectControlReports) ? projectControlReports : [];
  reports.forEach(report => {
    const id = String(report && report.projectId || '').trim();
    if (!id || !visibleIds.has(id)) {
      throw new Error('Project controls report is outside the authorized portfolio scope');
    }
  });
  const controls = buildPmsPortfolioControlsSummary(reports);
  const reportById = new Map(reports.map(report => [String(report.projectId), report]));
  const projects = visibleProjects.map(project => {
    const id = String(project.Project_ID).trim();
    const report = reportById.get(id);
    const controlsProject = controls.projects.find(item => item.projectId === id) || null;
    return {
      projectId: id,
      projectName: String(project.Project_Name || ''),
      projectStatus: String(project.Project_Status || ''),
      projectHealth: String(project.Project_Health || ''),
      plannedProgress: Number(project.Overall_Planned_Progress) || 0,
      actualProgress: Number(project.Overall_Actual_Progress) || 0,
      controls: controlsProject,
      warnings: report && Array.isArray(report.warnings) ? report.warnings.slice() : []
    };
  });
  return {
    success: true,
    source: 'authorized-apiGetPortfolioData',
    portfolioKpis: portfolioData.kpis || {},
    projectControls: controls,
    projects
  };
}

module.exports = { buildPmsPortfolioDashboardModel };
