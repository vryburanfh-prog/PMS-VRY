'use strict';

const { calculateCpm, calculateEvm } = require('./project-controls');
const { assessProjectHealth } = require('./project-health');

function requireField(mapping, key) {
  const field = mapping && mapping[key];
  if (typeof field !== 'string' || !field.trim()) {
    throw new TypeError('A source field mapping is required for ' + key);
  }
  return field;
}

function readNumber(record, field, label) {
  if (!record || !Object.prototype.hasOwnProperty.call(record, field)) {
    throw new Error('Missing source value for ' + label + ' (' + field + ')');
  }
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(label + ' must be a finite non-negative number');
  }
  return value;
}

function readString(record, field, label) {
  const value = record && record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(label + ' must be a non-empty string');
  }
  return value;
}

/**
 * Adapts caller-supplied PMS rows using explicit field mappings.
 * No assumptions are made about existing Google Sheet/database column names.
 */
function mapScheduleRows(rows, mapping) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TypeError('schedule rows must be a non-empty array');
  }
  const fields = {
    id: requireField(mapping, 'id'),
    duration: requireField(mapping, 'duration'),
    predecessors: requireField(mapping, 'predecessors')
  };
  return rows.map((row, index) => {
    const id = readString(row, fields.id, 'activity id at row ' + index);
    const duration = readNumber(row, fields.duration, 'duration for ' + id);
    const rawPredecessors = row && row[fields.predecessors];
    if (rawPredecessors == null) {
      return { id, duration, predecessors: [] };
    }
    if (!Array.isArray(rawPredecessors) ||
        rawPredecessors.some(value => typeof value !== 'string' || !value.trim())) {
      throw new TypeError('predecessors for ' + id + ' must be an array of non-empty activity ids');
    }
    return { id, duration, predecessors: rawPredecessors.slice() };
  });
}

function mapEvmRow(row, mapping) {
  const fields = {
    bac: requireField(mapping, 'bac'),
    pv: requireField(mapping, 'pv'),
    ev: requireField(mapping, 'ev'),
    ac: requireField(mapping, 'ac')
  };
  const result = {};
  for (const key of Object.keys(fields)) result[key] = readNumber(row, fields[key], key.toUpperCase());
  if (mapping.baselineDuration) {
    result.baselineDuration = readNumber(row, mapping.baselineDuration, 'baseline duration');
  }
  return result;
}

/**
 * Produces a read-only report object. Persistence, authorization, project
 * scoping, calendar rules and source-row selection remain application duties.
 */
function buildProjectControlsReport(input) {
  if (!input || typeof input !== 'object') throw new TypeError('report input is required');
  const activities = mapScheduleRows(input.scheduleRows, input.scheduleMapping);
  const evmInput = mapEvmRow(input.evmRow, input.evmMapping);
  const schedule = calculateCpm(activities);
  const evm = calculateEvm(evmInput);
  const health = assessProjectHealth({
    spi: evm.spi.available ? evm.spi.value : null,
    cpi: evm.cpi.available ? evm.cpi.value : null,
    thresholds: input.healthThresholds
  });

  return {
    projectId: readString(input, 'projectId', 'project id'),
    statusDate: readString(input, 'statusDate', 'status date'),
    schedule: {
      baselineDuration: evmInput.baselineDuration == null ? null : evmInput.baselineDuration,
      forecastDuration: evm.durationForecast.value,
      forecastDurationAvailable: evm.durationForecast.available,
      calculatedDuration: schedule.projectDuration,
      criticalActivities: schedule.criticalActivities,
      activities: schedule.activities
    },
    evm,
    health
  };
}

module.exports = { mapScheduleRows, mapEvmRow, buildProjectControlsReport };
