(() => {
  'use strict';

  const AI_EVALUATION_SCHEMA_VERSION = '2026-07-26a';

  const ratio = (numerator, denominator, emptyValue = 1) =>
    denominator > 0 ? Number((numerator / denominator).toFixed(6)) : emptyValue;

  function sameTimestamp(expected, actual) {
    const expectedMs = Date.parse(String(expected || ''));
    const actualMs = Date.parse(String(actual || ''));
    return Number.isFinite(expectedMs) && Number.isFinite(actualMs) && expectedMs === actualMs;
  }

  function withinExplicitBudget(actual, maximum) {
    return typeof actual === 'number' &&
      typeof maximum === 'number' &&
      Number.isFinite(actual) &&
      Number.isFinite(maximum) &&
      actual >= 0 &&
      maximum >= 0 &&
      actual <= maximum;
  }

  function evaluateGoldenFixtures(suite) {
    if (!suite || suite.schemaVersion !== AI_EVALUATION_SCHEMA_VERSION || !Array.isArray(suite.cases)) {
      throw new Error(`AI evaluation fixtures must use schema ${AI_EVALUATION_SCHEMA_VERSION}.`);
    }

    const accepted = suite.cases.filter((item) => item.observed?.decision === 'accepted');
    const allCitations = suite.cases.flatMap((item) => item.observed?.citedEvidenceIds || []);
    const allowedCitationCount = suite.cases.reduce((count, item) => {
      const allowed = new Set(item.observed?.allowedEvidenceIds || []);
      return count + (item.observed?.citedEvidenceIds || []).filter((id) => allowed.has(id)).length;
    }, 0);
    const acceptedCitations = accepted.flatMap((item) => item.observed?.citedEvidenceIds || []);
    const acceptedAllowedCitationCount = accepted.reduce((count, item) => {
      const allowed = new Set(item.observed?.allowedEvidenceIds || []);
      return count + (item.observed?.citedEvidenceIds || []).filter((id) => allowed.has(id)).length;
    }, 0);
    const acceptedClaims = accepted.flatMap((item) => item.observed?.claims || []);
    const acceptedEntities = accepted.flatMap((item) => item.observed?.entities || []);
    const acceptedTimestamps = accepted.flatMap((item) => item.observed?.timestamps || []);
    const acceptedRecords = accepted.reduce((count, item) => count + Number(item.observed?.recordCount || 0), 0);
    const acceptedDuplicates = accepted.reduce((count, item) => count + Number(item.observed?.duplicateCount || 0), 0);
    const verifierRejections = suite.cases.filter((item) => item.expected?.verifierDecision === 'rejected');
    const expectedAbstentions = suite.cases.filter((item) => item.expected?.decision === 'abstained');

    const metrics = {
      fixtureCount: suite.cases.length,
      acceptedCount: accepted.length,
      schemaPassRate: ratio(
        accepted.filter((item) => item.observed?.schemaValid === true).length,
        accepted.length
      ),
      candidateSchemaPassRate: ratio(
        suite.cases.filter((item) => item.observed?.schemaValid === true).length,
        suite.cases.length
      ),
      evidencePrecision: ratio(acceptedAllowedCitationCount, acceptedCitations.length),
      candidateEvidencePrecision: ratio(allowedCitationCount, allCitations.length),
      unsupportedClaimRate: ratio(
        acceptedClaims.filter((claim) => claim.supported !== true).length,
        acceptedClaims.length,
        0
      ),
      entityTickerPrecision: ratio(
        acceptedEntities.filter((entity) =>
          String(entity.expected || '').toUpperCase() === String(entity.actual || '').toUpperCase()
        ).length,
        acceptedEntities.length
      ),
      timestampAccuracy: ratio(
        acceptedTimestamps.filter((timestamp) => sameTimestamp(timestamp.expected, timestamp.actual)).length,
        acceptedTimestamps.length
      ),
      duplicateRate: ratio(acceptedDuplicates, acceptedRecords, 0),
      abstentionAccuracy: ratio(
        expectedAbstentions.filter((item) => item.observed?.decision === 'abstained').length,
        expectedAbstentions.length
      ),
      verifierDecisionAccuracy: ratio(
        suite.cases.filter((item) =>
          item.expected?.verifierDecision === item.observed?.verifierDecision
        ).length,
        suite.cases.length
      ),
      verifierRejectionAccuracy: ratio(
        verifierRejections.filter((item) => item.observed?.verifierDecision === 'rejected').length,
        verifierRejections.length
      ),
      latencyBudgetPassRate: ratio(
        suite.cases.filter((item) => withinExplicitBudget(
          item.observed?.latencyMs,
          item.observed?.maxLatencyMs
        )).length,
        suite.cases.length
      ),
      tokenBudgetPassRate: ratio(
        suite.cases.filter((item) => withinExplicitBudget(
          item.observed?.totalTokens,
          item.observed?.maxTotalTokens
        )).length,
        suite.cases.length
      ),
      costBudgetPassRate: ratio(
        suite.cases.filter((item) => withinExplicitBudget(
          item.observed?.costUnits,
          item.observed?.maxCostUnits
        )).length,
        suite.cases.length
      ),
      decisionAccuracy: ratio(
        suite.cases.filter((item) => item.expected?.decision === item.observed?.decision).length,
        suite.cases.length
      ),
    };

    const thresholdFailures = [];
    for (const [metric, threshold] of Object.entries(suite.thresholds || {})) {
      const actual = metrics[metric];
      if (!Number.isFinite(actual)) {
        thresholdFailures.push({ metric, actual: null, ...threshold });
        continue;
      }
      const passed = threshold.operator === '<='
        ? actual <= threshold.value
        : actual >= threshold.value;
      if (!passed) thresholdFailures.push({ metric, actual, ...threshold });
    }

    return {
      schemaVersion: AI_EVALUATION_SCHEMA_VERSION,
      fixtureVersion: suite.fixtureVersion,
      mode: suite.mode,
      metrics,
      thresholdsPassed: thresholdFailures.length === 0,
      thresholdFailures,
    };
  }

  const api = {
    AI_EVALUATION_SCHEMA_VERSION,
    evaluateGoldenFixtures,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalAiEvaluation = api;
})();
