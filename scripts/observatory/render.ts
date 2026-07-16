/**
 * Agent Reliability Index, Issue Renderer
 *
 * Takes a structured Issue and renders it to publishable markdown matching
 * the Charter Issue format. This is the bridge between the measurement
 * pipeline and the weekly `observatory/issue-NNN-*.md` artifacts.
 *
 * Pure function: in = Issue, out = markdown string. Trivially testable.
 *
 * Run via demo:  node scripts/observatory/render-demo.mjs
 */

import type {
  Issue,
  VendorWeekly,
  PublicIncident,
  DriftEvent,
  VendorId,
} from "./types.js";

// ============================================================================
// Top-level renderer
// ============================================================================

export function renderIssueToMarkdown(issue: Issue): string {
  const parts: string[] = [];

  parts.push(renderMasthead(issue));
  parts.push(renderHeadline(issue));
  parts.push(renderScorecards(issue));
  parts.push(renderDriftSection(issue));
  parts.push(renderIncidents(issue));
  parts.push(renderMethodologyNotes(issue));
  parts.push(renderLookingAhead(issue));
  parts.push(renderAbout(issue));
  parts.push(renderFooter(issue));

  return parts.join("\n\n---\n\n").trim() + "\n";
}

// ============================================================================
// Section renderers
// ============================================================================

function renderMasthead(issue: Issue): string {
  return [
    `# Agent Reliability Index, Issue ${pad3(issue.number)}`,
    ``,
    `**Volume ${issue.volume}, Issue ${pad3(issue.number)} · Week of ${formatWeek(issue.week)}**`,
    ``,
    `*A weekly observatory of AI agent behavior change across frontier vendors.`,
    `Published by Nobulex.*`,
  ].join("\n");
}

function renderHeadline(issue: Issue): string {
  return [`## This week's headline`, ``, issue.headline].join("\n");
}

function renderScorecards(issue: Issue): string {
  const rows = issue.vendors.map((v) => {
    const delta = v.cvriDelta === 0 ? ", " : (v.cvriDelta > 0 ? "+" : "") + v.cvriDelta.toFixed(1);
    const driftCount = v.drift.silentDriftEvents.length + v.drift.announcedDriftEvents.length;
    return `| ${formatVendor(v.vendor).padEnd(9)} | ${v.cvri.toFixed(1).padStart(5)} | ${delta.padStart(15)} | ${String(driftCount).padStart(12)} | ${v.status.padEnd(10)} |`;
  });

  return [
    `## CVRI scorecards, this week`,
    ``,
    `| Vendor    | CVRI  | Δ vs. last week |  Drift events | Status     |`,
    `|-----------|-------|-----------------|---------------|------------|`,
    ...rows,
    ``,
    `*CVRI is a change detector versus each vendor's 12-week rolling baseline, not an absolute capability score. Lower CVRI means more drift, not "worse model."*`,
  ].join("\n");
}

function renderDriftSection(issue: Issue): string {
  const parts: string[] = [`## Drift events, this week`, ``, `### Silent drift`, ``];

  const silent = issue.vendors.flatMap((v) =>
    v.drift.silentDriftEvents.map((e) => ({ vendor: v.vendor, event: e })),
  );

  if (silent.length === 0) {
    parts.push(`No silent drift events detected this week.`);
  } else {
    for (const { vendor, event } of silent) {
      parts.push(renderDriftEvent(vendor, event, "silent"));
      parts.push("");
    }
  }

  parts.push(``, `### Announced drift`, ``);

  const announced = issue.vendors.flatMap((v) =>
    v.drift.announcedDriftEvents.map((e) => ({ vendor: v.vendor, event: e })),
  );

  if (announced.length === 0) {
    parts.push(`No announced drift events this week.`);
  } else {
    for (const { vendor, event } of announced) {
      parts.push(renderDriftEvent(vendor, event, "announced"));
      parts.push("");
    }
  }

  return parts.join("\n").trim();
}

function renderDriftEvent(
  vendor: VendorId,
  event: DriftEvent,
  kind: "silent" | "announced",
): string {
  const dimensions = event.dimensionsAffected.join(", ");
  const taskClasses = event.taskClasses.join(", ");
  const lines = [
    `#### ${formatVendor(vendor)} \`${event.endpointId}\`, ${taskClasses}`,
    ``,
    `- **Detected**: ${event.detectedAt}`,
    `- **Dimensions affected**: ${dimensions}`,
    `- **Magnitude**: ${event.magnitude.toFixed(2)}σ from baseline`,
    `- **Editorial annotation**: ${event.editorialAnnotation}`,
  ];

  if (kind === "announced" && event.vendorDisclosure.url) {
    lines.push(`- **Vendor disclosure**: [${event.vendorDisclosure.type}](${event.vendorDisclosure.url}) · published ${event.vendorDisclosure.publishedAt ?? "n/a"}`);
  } else if (kind === "silent") {
    lines.push(`- **Vendor disclosure**: None located as of publication`);
  }

  return lines.join("\n");
}

function renderIncidents(issue: Issue): string {
  const parts: string[] = [`## Notable incidents, this week`, ``];

  const bySeverity = {
    critical: issue.incidents.filter((i) => i.severity === "critical"),
    regression: issue.incidents.filter((i) => i.severity === "regression"),
    advisory: issue.incidents.filter((i) => i.severity === "advisory"),
    informational: issue.incidents.filter((i) => i.severity === "informational"),
  };

  for (const [severity, group] of Object.entries(bySeverity)) {
    const label = severity.charAt(0).toUpperCase() + severity.slice(1);
    parts.push(`### ${label}`, ``);
    if (group.length === 0) {
      parts.push(`No ${severity}-class incidents this week.`, ``);
    } else {
      for (const incident of group) {
        parts.push(renderIncident(incident), ``);
      }
    }
  }

  return parts.join("\n").trim();
}

function renderIncident(incident: PublicIncident): string {
  return [
    `#### ${incident.product}`,
    ``,
    `- **Vendor / product**: ${formatVendor(incident.vendor as VendorId)} / ${incident.product}`,
    `- **Source**: <${incident.sourceUrl}>`,
    `- **Summary**: ${incident.summary}`,
    `- **Implications**: ${incident.implications}`,
  ].join("\n");
}

function renderMethodologyNotes(issue: Issue): string {
  const parts: string[] = [`## Methodology notes`, ``];

  if (issue.methodologyNotes.pendingChanges.length === 0) {
    parts.push(`*Methodology unchanged this week.*`);
  } else {
    parts.push(`**Pending methodology changes:**`, ``);
    for (const change of issue.methodologyNotes.pendingChanges) {
      parts.push(`- ${change}`);
    }
  }
  parts.push(``);

  if (issue.methodologyNotes.vendorDisputes.length === 0) {
    parts.push(`*No vendor disputes received this week.*`);
  } else {
    parts.push(`**Vendor disputes this week:**`, ``);
    for (const d of issue.methodologyNotes.vendorDisputes) {
      parts.push(`- **${formatVendor(d.vendor)}** (${d.receivedAt}): "${d.disputedFinding}"`);
      parts.push(`  Response: ${d.nobulexResponse}`);
      if (d.methodologyAdjustment) {
        parts.push(`  Adjustment: ${d.methodologyAdjustment}`);
      }
    }
  }
  parts.push(``);

  if (issue.methodologyNotes.disclosureItems.length === 0) {
    parts.push(`*No new disclosure items this week.*`);
  } else {
    parts.push(`**New disclosure items:**`, ``);
    for (const item of issue.methodologyNotes.disclosureItems) {
      parts.push(`- ${item}`);
    }
  }

  return parts.join("\n").trim();
}

function renderLookingAhead(issue: Issue): string {
  if (!issue.lookingAhead) return "";
  return [`## Looking ahead`, ``, issue.lookingAhead].join("\n");
}

function renderAbout(_issue: Issue): string {
  return [
    `## About Nobulex`,
    ``,
    `Nobulex is the cross-organization receipt format for AI agent transactions. The Agent Reliability Index is the public observatory layer of the Nobulex methodology. The receipt format is MIT-licensed; the methodology behind the index is open; the underlying prompt set and the proprietary analytical layer that scores per-customer agent deployments are private.`,
    ``,
    `For the strategic vision: [\`docs/OBSERVATORY-VISION.md\`](../docs/OBSERVATORY-VISION.md).`,
    `For the full methodology: [\`docs/AGENT-RELIABILITY-INDEX.md\`](../docs/AGENT-RELIABILITY-INDEX.md).`,
    ``,
    `To subscribe: email \`nobulex.dev@gmail.com\` with subject "Agent Reliability Index Subscription."`,
    `To submit methodology critique: open an issue at \`github.com/arian-gogani/nobulex/issues\` with label \`observatory:methodology\`.`,
    `To submit a vendor dispute: email \`feedback@nobulex.com\` with the dispute and proposed methodological correction.`,
  ].join("\n");
}

function renderFooter(issue: Issue): string {
  return `*Issue ${pad3(issue.number)} · Methodology ${issue.methodologyVersion} · ${formatWeek(issue.week)} · Nobulex.*`;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

function formatWeek(weekIso: string): string {
  // Expects "2026-W19" format; renders as "11 May 2026" for the Monday of that week
  const match = weekIso.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return weekIso;
  const [, yearStr, weekStr] = match;
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const monday = isoWeekToMonday(year, week);
  return monday.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function isoWeekToMonday(year: number, week: number): Date {
  // ISO 8601: Week 1 is the week containing the first Thursday of the year
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // Sunday = 7
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return target;
}

function formatVendor(vendor: VendorId): string {
  const map: Record<VendorId, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    microsoft: "Microsoft",
    meta: "Meta",
  };
  return map[vendor] ?? vendor;
}
