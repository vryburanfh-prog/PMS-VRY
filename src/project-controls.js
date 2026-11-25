'use strict';

/**
 * Pure project-controls calculations.
 *
 * CPM durations are expressed in whole working-day units. ES/EF/LS/LF are
 * zero-based offsets from the project start; EF and LF are exclusive finish
 * offsets. The caller owns calendar/date conversion and holiday policy.
 *
 * EVM monetary values must use one consistent currency and one consistent
 * status date. Missing or mathematically undefined ratios are returned as
 * unavailable rather than silently coerced to zero.
 */

function finiteNonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(label + ' must be a finite non-negative number');
  }
}

function calculateCpm(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new TypeError('activities must be a non-empty array');
  }

  const byId = new Map();
  input.forEach((item, index) => {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) {
      throw new TypeError('activity at index ' + index + ' must have a non-empty string id');
    }
    if (byId.has(item.id)) throw new Error('duplicate activity id: ' + item.id);
    finiteNonNegative(item.duration, 'duration for ' + item.id);
    const predecessors = item.predecessors == null ? [] : item.predecessors;
    if (!Array.isArray(predecessors)) throw new TypeError('predecessors for ' + item.id + ' must be an array');
    if (new Set(predecessors).size !== predecessors.length) {
      throw new Error('duplicate predecessor for activity: ' + item.id);
    }
    if (predecessors.includes(item.id)) throw new Error('activity cannot depend on itself: ' + item.id);
    byId.set(item.id, { id: item.id, duration: item.duration, predecessors: predecessors.slice() });
  });

  const successors = new Map([...byId.keys()].map(id => [id, []]));
  const indegree = new Map();
  for (const activity of byId.values()) {
    for (const predecessor of activity.predecessors) {
      if (!byId.has(predecessor)) {
        throw new Error('unknown predecessor ' + predecessor + ' for activity ' + activity.id);
      }
      successors.get(predecessor).push(activity.id);
    }
    indegree.set(activity.id, activity.predecessors.length);
  }

  // Stable topological ordering: preserve input order among currently-ready nodes.
  const ready = [...byId.keys()].filter(id => indegree.get(id) === 0);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const next of successors.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  if (order.length !== byId.size) throw new Error('dependency cycle detected');

  const schedule = new Map();
  for (const id of order) {
    const activity = byId.get(id);
    const es = activity.predecessors.reduce((max, pred) => Math.max(max, schedule.get(pred).ef), 0);
    schedule.set(id, { id, duration: activity.duration, es, ef: es + activity.duration });
  }
  const projectDuration = Math.max(...[...schedule.values()].map(x => x.ef));

  for (const id of order.slice().reverse()) {
    const item = schedule.get(id);
    const next = successors.get(id);
    const lf = next.length
      ? Math.min(...next.map(successorId => schedule.get(successorId).ls))
      : projectDuration;
    item.lf = lf;
    item.ls = lf - item.duration;
    item.totalFloat = item.ls - item.es;
    item.critical = Math.abs(item.totalFloat) < 1e-9;
  }

  return {
    projectDuration,
    activities: order.map(id => ({ ...schedule.get(id) })),
    criticalActivities: order.filter(id => schedule.get(id).critical)
  };
}

function metric(value, reason) {
  return value == null || !Number.isFinite(value)
    ? { value: null, available: false, reason: reason || 'not mathematically defined' }
    : { value, available: true, reason: null };
}

function ratio(numerator, denominator, label) {
  return denominator > 0
    ? metric(numerator / denominator)
    : metric(null, label + ' denominator must be greater than zero');
}

function calculateEvm(input) {
  if (!input || typeof input !== 'object') throw new TypeError('EVM input must be an object');
  for (const key of ['bac', 'pv', 'ev', 'ac']) finiteNonNegative(input[key], key.toUpperCase());

  const { bac, pv, ev, ac } = input;
  const cpi = ratio(ev, ac, 'AC');
  const spi = ratio(ev, pv, 'PV');
  const eac = cpi.available
    ? metric(bac / cpi.value)
    : metric(null, 'EAC unavailable because CPI is unavailable');
  const etc = eac.available ? metric(eac.value - ac) : metric(null, eac.reason);
  const vac = eac.available ? metric(bac - eac.value) : metric(null, eac.reason);
  const tcpi = ratio(bac - ev, bac - ac, 'BAC - AC');
  const durationForecast = input.baselineDuration == null
    ? metric(null, 'baselineDuration was not supplied')
    : (() => {
        finiteNonNegative(input.baselineDuration, 'baselineDuration');
        return spi.available
          ? (spi.value > 0
              ? metric(input.baselineDuration / spi.value)
              : metric(null, 'SPI must be greater than zero'))
          : metric(null, 'duration forecast unavailable because SPI is unavailable');
      })();

  return {
    bac, pv, ev, ac,
    cv: metric(ev - ac),
    sv: metric(ev - pv),
    cpi, spi, eac, etc, vac, tcpi,
    durationForecast
  };
}

module.exports = { calculateCpm, calculateEvm };
