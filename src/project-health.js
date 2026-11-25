'use strict';

/**
 * Configurable, explainable project health classification.
 * Thresholds are intentionally supplied by the organization; no universal
 * green/amber/red policy is silently imposed by the engine.
 */

function validateBands(bands, label) {
  if (!bands || typeof bands !== 'object') throw new TypeError(label + ' thresholds are required');
  const { greenMin, amberMin } = bands;
  if (!Number.isFinite(greenMin) || !Number.isFinite(amberMin) || amberMin > greenMin) {
    throw new TypeError(label + ' requires finite thresholds where amberMin <= greenMin');
  }
}

function classifyRatio(value, bands, label) {
  if (value == null || !Number.isFinite(value)) {
    return { status: 'unavailable', value: null, reason: label + ' metric is unavailable' };
  }
  return {
    status: value >= bands.greenMin ? 'green' : value >= bands.amberMin ? 'amber' : 'red',
    value,
    reason: null
  };
}

function assessProjectHealth(input) {
  if (!input || typeof input !== 'object') throw new TypeError('health input is required');
  const thresholds = input.thresholds || {};
  validateBands(thresholds.schedule, 'schedule');
  validateBands(thresholds.cost, 'cost');

  const schedule = classifyRatio(input.spi, thresholds.schedule, 'SPI');
  const cost = classifyRatio(input.cpi, thresholds.cost, 'CPI');
  const dimensions = { schedule, cost };
  const statuses = Object.values(dimensions).map(item => item.status);
  const overall = statuses.includes('red')
    ? 'red'
    : statuses.includes('amber')
      ? 'amber'
      : statuses.every(status => status === 'green')
        ? 'green'
        : 'incomplete';

  const alerts = [];
  for (const [dimension, result] of Object.entries(dimensions)) {
    if (result.status === 'red' || result.status === 'amber') {
      alerts.push({
        code: dimension.toUpperCase() + '_' + result.status.toUpperCase(),
        severity: result.status,
        dimension,
        metric: dimension === 'schedule' ? 'SPI' : 'CPI',
        value: result.value
      });
    } else if (result.status === 'unavailable') {
      alerts.push({
        code: dimension.toUpperCase() + '_DATA_UNAVAILABLE',
        severity: 'info',
        dimension,
        metric: dimension === 'schedule' ? 'SPI' : 'CPI',
        value: null
      });
    }
  }

  return { overall, dimensions, alerts };
}

module.exports = { assessProjectHealth };
