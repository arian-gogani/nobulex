/*
 * Compliance reporting — map an action log onto a regulatory framework's
 * requirements. Output is structured JSON an auditor can walk against the
 * framework text (EU AI Act Art. 12, Colorado AI Act, SOC 2, ISO/IEC 42001).
 *
 * The reports answer: "for each requirement of framework X, which of the
 * log's entries is evidence that the requirement is satisfied, and which
 * requirements have no supporting evidence?"
 */

import type { ActionLog, ActionLogEntry } from '../types/index';
import { verifyIntegrity } from '../action-log/index';

export type ComplianceFramework =
  | 'eu-ai-act-article-12'
  | 'colorado-ai-act'
  | 'soc2'
  | 'iso-42001';

export interface ComplianceRequirement {
  /** Framework-defined identifier for the requirement (e.g. "Art. 12(1)"). */
  readonly id: string;
  /** Short human-readable title. */
  readonly title: string;
  /** Whether the log satisfies this requirement. */
  readonly met: boolean;
  /** One-line explanation of the finding. */
  readonly rationale: string;
  /** Indexes of log entries that support the finding, if any. */
  readonly evidence: readonly number[];
}

export interface ComplianceReport {
  readonly framework: ComplianceFramework;
  readonly agentDid: string;
  readonly generatedAt: string;
  readonly totalActions: number;
  readonly logIntegrity: { readonly valid: boolean; readonly errors: readonly string[] };
  readonly requirements: readonly ComplianceRequirement[];
  readonly summary: {
    readonly met: number;
    readonly unmet: number;
    readonly coveragePercent: number;
  };
}

export interface GenerateComplianceReportOptions {
  readonly framework: ComplianceFramework;
}

/**
 * Generate a structured compliance report from an action log, mapped to the
 * given framework. Each framework defines a set of requirements; this function
 * inspects the log for evidence of each requirement being satisfied.
 */
export function generateComplianceReport(
  log: ActionLog,
  options: GenerateComplianceReportOptions,
): ComplianceReport {
  const integrity = verifyIntegrity(log);
  const requirements = evaluateRequirements(log, options.framework, integrity.valid);
  const met = requirements.filter((r) => r.met).length;
  const unmet = requirements.length - met;

  return {
    framework: options.framework,
    agentDid: log.agentDid,
    generatedAt: new Date().toISOString(),
    totalActions: log.length,
    logIntegrity: { valid: integrity.valid, errors: integrity.errors },
    requirements,
    summary: {
      met,
      unmet,
      coveragePercent: requirements.length === 0
        ? 0
        : Math.round((met / requirements.length) * 100),
    },
  };
}

// ── Framework mappings ──────────────────────────────────────────────────────

function evaluateRequirements(
  log: ActionLog,
  framework: ComplianceFramework,
  integrityValid: boolean,
): ComplianceRequirement[] {
  switch (framework) {
    case 'eu-ai-act-article-12':
      return euAiActArticle12(log, integrityValid);
    case 'colorado-ai-act':
      return coloradoAiAct(log, integrityValid);
    case 'soc2':
      return soc2(log, integrityValid);
    case 'iso-42001':
      return iso42001(log, integrityValid);
  }
}

function indexesMatching(
  log: ActionLog,
  predicate: (e: ActionLogEntry) => boolean,
): number[] {
  const indexes: number[] = [];
  for (const e of log.entries) if (predicate(e)) indexes.push(e.index);
  return indexes;
}

// EU AI Act, Article 12 — Record-keeping for high-risk AI systems.
function euAiActArticle12(log: ActionLog, integrityValid: boolean): ComplianceRequirement[] {
  const hasAnyLogs = log.entries.length > 0;
  const blocks = indexesMatching(log, (e) => e.outcome === 'blocked' || e.outcome === 'would_block' || e.outcome === 'halted');
  const timestamped = indexesMatching(log, (e) => typeof e.timestamp === 'string' && e.timestamp.length > 0);

  return [
    {
      id: 'art-12(1)',
      title: 'Automatic recording of events ("logs") over the lifetime of the system',
      met: hasAnyLogs,
      rationale: hasAnyLogs
        ? `${log.entries.length} events are recorded in the action log`
        : 'Action log is empty — no events recorded',
      evidence: log.entries.map((e) => e.index),
    },
    {
      id: 'art-12(2)',
      title: 'Logs ensure traceability of the system\'s functioning',
      met: integrityValid && hasAnyLogs,
      rationale: integrityValid
        ? 'Action log hash chain verifies — entries are tamper-evident'
        : 'Action log integrity check failed',
      evidence: timestamped,
    },
    {
      id: 'art-12(3)',
      title: 'Recording of situations that may result in risk / substantial modification',
      met: hasAnyLogs,
      rationale: blocks.length > 0
        ? `${blocks.length} enforcement events recorded (blocked / would_block / halted)`
        : hasAnyLogs
          ? 'No blocked actions — either no risky actions attempted or enforcement not exercised'
          : 'No events to assess',
      evidence: blocks,
    },
  ];
}

// Colorado AI Act (SB 24-205) — developer/deployer recordkeeping duties.
function coloradoAiAct(log: ActionLog, integrityValid: boolean): ComplianceRequirement[] {
  const hasLogs = log.entries.length > 0;
  const firstAction = log.entries[0];
  const lastAction = log.entries[log.entries.length - 1];

  return [
    {
      id: 'co-ai-6-1-1701(2)(a)',
      title: 'Maintain records of automated-decision actions performed by the system',
      met: hasLogs,
      rationale: hasLogs
        ? `Records span from ${firstAction!.timestamp} to ${lastAction!.timestamp}`
        : 'No records present',
      evidence: log.entries.map((e) => e.index),
    },
    {
      id: 'co-ai-6-1-1701(2)(b)',
      title: 'Records are sufficient to support risk-management reviews',
      met: integrityValid,
      rationale: integrityValid
        ? 'Records are hash-chained; chain verification passes'
        : 'Record integrity verification failed',
      evidence: [],
    },
  ];
}

// SOC 2 — selected Common Criteria relevant to agent action logging.
function soc2(log: ActionLog, integrityValid: boolean): ComplianceRequirement[] {
  const hasLogs = log.entries.length > 0;
  const failures = indexesMatching(log, (e) => e.outcome === 'failure' || e.outcome === 'blocked');
  const halts = indexesMatching(log, (e) => e.outcome === 'halted');

  return [
    {
      id: 'CC7.2',
      title: 'System monitors components and evaluates anomalies that indicate compromise',
      met: hasLogs,
      rationale: hasLogs
        ? `${log.entries.length} actions monitored; ${failures.length} flagged (failure or blocked)`
        : 'No monitoring data present',
      evidence: failures,
    },
    {
      id: 'CC7.3',
      title: 'Security events are evaluated to determine whether they are incidents',
      met: hasLogs,
      rationale: halts.length > 0
        ? `${halts.length} emergency halt events recorded`
        : 'No halt/incident events recorded',
      evidence: halts,
    },
    {
      id: 'CC7.4',
      title: 'Identified security incidents are responded to using established procedures',
      met: integrityValid,
      rationale: integrityValid
        ? 'Action log hash chain verifies; record is trustworthy for incident review'
        : 'Action log failed integrity verification',
      evidence: [],
    },
  ];
}

// ISO/IEC 42001 — AI Management System.
function iso42001(log: ActionLog, integrityValid: boolean): ComplianceRequirement[] {
  const hasLogs = log.entries.length > 0;
  const blocks = indexesMatching(log, (e) => e.outcome === 'blocked' || e.outcome === 'would_block');

  return [
    {
      id: 'A.6.2.8',
      title: 'AI system event logging',
      met: hasLogs,
      rationale: hasLogs
        ? `${log.entries.length} AI system events logged`
        : 'No AI system events logged',
      evidence: log.entries.map((e) => e.index),
    },
    {
      id: 'A.9.3',
      title: 'AI system operation and monitoring (enforcement exercised)',
      met: hasLogs,
      rationale: blocks.length > 0
        ? `${blocks.length} policy-enforcement events recorded`
        : hasLogs
          ? 'Events logged but no enforcement decisions exercised'
          : 'No events to assess',
      evidence: blocks,
    },
    {
      id: 'A.9.4',
      title: 'AI system records are tamper-evident',
      met: integrityValid,
      rationale: integrityValid
        ? 'Hash-chain verification passes'
        : 'Hash-chain verification failed',
      evidence: [],
    },
  ];
}
