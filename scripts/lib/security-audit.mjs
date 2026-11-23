const REQUIRED_COUNTS = ['info', 'low', 'moderate', 'high', 'critical', 'total'];

/**
 * Normalize npm audit output without treating malformed/error JSON as a clean audit.
 * npm exits with code 1 for valid reports containing findings; those are distinct
 * from registry, lockfile and transport failures that do not contain audit metadata.
 */
export function summarizeAudit(stdout, stderr = '', exitCode = null, error = null) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = null;
  }

  const counts = parsed?.metadata?.vulnerabilities || null;
  const hasValidAuditReport = Boolean(counts)
    && REQUIRED_COUNTS.every((key) => Number.isFinite(counts[key]));
  const diagnostic = parsed?.message
    || parsed?.error?.summary
    || parsed?.error?.detail
    || stderr
    || stdout
    || 'npm audit returned no JSON report';

  const execution = error
    ? 'ERROR'
    : !hasValidAuditReport
      ? 'BLOCKED'
      : exitCode === 0
        ? 'PASS'
        : 'FINDINGS';

  return {
    execution,
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    counts: hasValidAuditReport ? counts : null,
    error: error?.message || null,
    diagnostic: hasValidAuditReport ? null : String(diagnostic).trim().slice(0, 1200),
    advisories: parsed?.vulnerabilities
      ? Object.entries(parsed.vulnerabilities).map(([name, finding]) => ({
        name,
        severity: finding.severity,
        isDirect: finding.isDirect,
        range: finding.range,
        fixAvailable: finding.fixAvailable,
        via: (finding.via || []).map((item) => typeof item === 'string'
          ? item
          : ({ name: item.name, title: item.title, range: item.range, url: item.url })),
      }))
      : [],
  };
}

export function auditBlocksRelease(summary, { productionDependencies = false } = {}) {
  if (['ERROR', 'BLOCKED'].includes(summary?.execution)) return true;
  if (!productionDependencies || !summary?.counts) return false;
  return summary.counts.critical > 0 || summary.counts.high > 0;
}
