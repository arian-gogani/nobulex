/**
 * Agent Reliability Index — End-to-End Demo
 *
 * Runs synthetic data through the full pipeline and emits a publishable
 * markdown issue. Demonstrates that the harness composes correctly and
 * gives a runnable command that produces an actual artifact.
 *
 * Run with:
 *   node scripts/observatory/render-demo.mjs
 *
 * Output:
 *   observatory/_preview-issue-002.md  (a synthetic preview, not for publication)
 *
 * The demo deliberately uses synthetic data. It does NOT call vendor APIs.
 * It proves the rendering pipeline works, not that the measurements are real.
 *
 * For the real weekly run, see scripts/observatory/README.md.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

// ============================================================================
// Inline renderer (mirrors render.ts, sans types)
// ============================================================================

const pad3 = (n) => String(n).padStart(3, "0");

const formatVendor = (v) =>
  ({ anthropic: "Anthropic", openai: "OpenAI", google: "Google", microsoft: "Microsoft", meta: "Meta" })[v] ?? v;

const isoWeekToMonday = (year, week) => {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return target;
};

const formatWeek = (weekIso) => {
  const m = weekIso.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return weekIso;
  const d = isoWeekToMonday(parseInt(m[1], 10), parseInt(m[2], 10));
  return d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

function renderMasthead(issue) {
  return [
    `# Agent Reliability Index — Issue ${pad3(issue.number)}`,
    ``,
    `**Volume ${issue.volume}, Issue ${pad3(issue.number)} · Week of ${formatWeek(issue.week)}**`,
    ``,
    `*A weekly observatory of AI agent behavior change across frontier vendors.`,
    `Published by Nobulex.*`,
  ].join("\n");
}

function renderHeadline(issue) {
  return [`## This week's headline`, ``, issue.headline].join("\n");
}

function renderScorecards(issue) {
  const rows = issue.vendors.map((v) => {
    const delta = v.cvriDelta === 0 ? "—" : (v.cvriDelta > 0 ? "+" : "") + v.cvriDelta.toFixed(1);
    const driftCount = v.drift.silentDriftEvents.length + v.drift.announcedDriftEvents.length;
    return `| ${formatVendor(v.vendor).padEnd(9)} | ${v.cvri.toFixed(1).padStart(5)} | ${delta.padStart(15)} | ${String(driftCount).padStart(12)} | ${v.status.padEnd(10)} |`;
  });
  return [
    `## CVRI scorecards — this week`,
    ``,
    `| Vendor    | CVRI  | Δ vs. last week |  Drift events | Status     |`,
    `|-----------|-------|-----------------|---------------|------------|`,
    ...rows,
    ``,
    `*CVRI is a change detector versus each vendor's 12-week rolling baseline, not an absolute capability score. Lower CVRI means more drift, not "worse model."*`,
  ].join("\n");
}

function renderDriftEvent(vendor, event, kind) {
  const lines = [
    `#### ${formatVendor(vendor)} \`${event.endpointId}\` — ${event.taskClasses.join(", ")}`,
    ``,
    `- **Detected**: ${event.detectedAt}`,
    `- **Dimensions affected**: ${event.dimensionsAffected.join(", ")}`,
    `- **Magnitude**: ${event.magnitude.toFixed(2)}σ from baseline`,
    `- **Editorial annotation**: ${event.editorialAnnotation}`,
  ];
  if (kind === "announced" && event.vendorDisclosure?.url) {
    lines.push(`- **Vendor disclosure**: [${event.vendorDisclosure.type}](${event.vendorDisclosure.url}) · published ${event.vendorDisclosure.publishedAt ?? "n/a"}`);
  } else if (kind === "silent") {
    lines.push(`- **Vendor disclosure**: None located as of publication`);
  }
  return lines.join("\n");
}

function renderDriftSection(issue) {
  const parts = [`## Drift events — this week`, ``, `### Silent drift`, ``];
  const silent = issue.vendors.flatMap((v) => v.drift.silentDriftEvents.map((e) => ({ vendor: v.vendor, event: e })));
  if (silent.length === 0) {
    parts.push(`No silent drift events detected this week.`);
  } else {
    for (const { vendor, event } of silent) parts.push(renderDriftEvent(vendor, event, "silent"), "");
  }
  parts.push(``, `### Announced drift`, ``);
  const announced = issue.vendors.flatMap((v) => v.drift.announcedDriftEvents.map((e) => ({ vendor: v.vendor, event: e })));
  if (announced.length === 0) {
    parts.push(`No announced drift events this week.`);
  } else {
    for (const { vendor, event } of announced) parts.push(renderDriftEvent(vendor, event, "announced"), "");
  }
  return parts.join("\n").trim();
}

function renderIncidents(issue) {
  const parts = [`## Notable incidents — this week`, ``];
  for (const sev of ["critical", "regression", "advisory", "informational"]) {
    const group = issue.incidents.filter((i) => i.severity === sev);
    parts.push(`### ${sev.charAt(0).toUpperCase() + sev.slice(1)}`, ``);
    if (group.length === 0) {
      parts.push(`No ${sev}-class incidents this week.`, ``);
    } else {
      for (const i of group) {
        parts.push(
          `#### ${i.product}`,
          ``,
          `- **Vendor / product**: ${formatVendor(i.vendor)} / ${i.product}`,
          `- **Source**: <${i.sourceUrl}>`,
          `- **Summary**: ${i.summary}`,
          `- **Implications**: ${i.implications}`,
          ``,
        );
      }
    }
  }
  return parts.join("\n").trim();
}

function renderMethodologyNotes(issue) {
  const parts = [`## Methodology notes`, ``];
  if (issue.methodologyNotes.pendingChanges.length === 0) parts.push(`*Methodology unchanged this week.*`);
  else {
    parts.push(`**Pending methodology changes:**`, ``);
    for (const c of issue.methodologyNotes.pendingChanges) parts.push(`- ${c}`);
  }
  parts.push(``);
  if (issue.methodologyNotes.vendorDisputes.length === 0) parts.push(`*No vendor disputes received this week.*`);
  else {
    parts.push(`**Vendor disputes this week:**`, ``);
    for (const d of issue.methodologyNotes.vendorDisputes) {
      parts.push(`- **${formatVendor(d.vendor)}** (${d.receivedAt}): "${d.disputedFinding}"`);
      parts.push(`  Response: ${d.nobulexResponse}`);
      if (d.methodologyAdjustment) parts.push(`  Adjustment: ${d.methodologyAdjustment}`);
    }
  }
  parts.push(``);
  if (issue.methodologyNotes.disclosureItems.length === 0) parts.push(`*No new disclosure items this week.*`);
  else {
    parts.push(`**New disclosure items:**`, ``);
    for (const item of issue.methodologyNotes.disclosureItems) parts.push(`- ${item}`);
  }
  return parts.join("\n").trim();
}

function renderIssueToMarkdown(issue) {
  return [
    renderMasthead(issue),
    renderHeadline(issue),
    renderScorecards(issue),
    renderDriftSection(issue),
    renderIncidents(issue),
    renderMethodologyNotes(issue),
    issue.lookingAhead ? [`## Looking ahead`, ``, issue.lookingAhead].join("\n") : "",
    [
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
    ].join("\n"),
    `*Issue ${pad3(issue.number)} · Methodology ${issue.methodologyVersion} · ${formatWeek(issue.week)} · Nobulex.*`,
  ].filter(Boolean).join("\n\n---\n\n").trim() + "\n";
}

// ============================================================================
// Synthetic Issue for the demo
// ============================================================================

const demoIssue = {
  number: 2,
  volume: 1,
  week: "2026-W20",
  publishedAt: "2026-05-18T08:00:00Z",
  methodologyVersion: "v0.1",
  promptSetVersion: "v1.0",
  headline:
    "This is a SYNTHETIC PREVIEW with placeholder data, generated by render-demo.mjs to demonstrate the pipeline. The real Issue 002 — with actual measurements from the standardized prompt set — will be published the following Monday and will replace this preview.",
  vendors: [
    {
      vendor: "anthropic",
      week: "2026-W20",
      cvri: 98.4,
      cvriDelta: -1.6,
      status: "ok",
      drift: {
        silentDriftEvents: [],
        announcedDriftEvents: [],
      },
    },
    {
      vendor: "openai",
      week: "2026-W20",
      cvri: 89.2,
      cvriDelta: -8.3,
      status: "advisory",
      drift: {
        silentDriftEvents: [
          {
            endpointId: "openai:gpt-flagship",
            taskClasses: ["agentic_tool_use", "format_adherence"],
            dimensionsAffected: ["toolUseReliabilityZ", "outputStabilityZ"],
            magnitude: 2.4,
            detectedAt: "2026-05-15",
            vendorDisclosure: { type: "none", url: null, publishedAt: null },
            editorialAnnotation:
              "Tool-use success rate on the standardized scenario set dropped 12 percentage points week-over-week. No model card update detected. Pattern consistent with a routing or inference-stack change rather than a model rollout.",
          },
        ],
        announcedDriftEvents: [],
      },
    },
    {
      vendor: "google",
      week: "2026-W20",
      cvri: 99.1,
      cvriDelta: -0.6,
      status: "ok",
      drift: { silentDriftEvents: [], announcedDriftEvents: [] },
    },
    {
      vendor: "microsoft",
      week: "2026-W20",
      cvri: 94.7,
      cvriDelta: -2.1,
      status: "advisory",
      drift: {
        silentDriftEvents: [],
        announcedDriftEvents: [
          {
            endpointId: "microsoft:copilot-default",
            taskClasses: ["refusal_handling"],
            dimensionsAffected: ["refusalRateZ"],
            magnitude: 2.1,
            detectedAt: "2026-05-14",
            vendorDisclosure: {
              type: "release_note",
              url: "https://example.com/microsoft-release-notes/2026-05-14",
              publishedAt: "2026-05-14",
            },
            editorialAnnotation:
              "Refusal rate increased by 6.2 percentage points across the safety probe subset. Vendor announced a safety-filter tuning the same day; the observed shift is consistent with the announced change.",
          },
        ],
      },
    },
    {
      vendor: "meta",
      week: "2026-W20",
      cvri: 100,
      cvriDelta: 0,
      status: "ok",
      drift: { silentDriftEvents: [], announcedDriftEvents: [] },
    },
  ],
  incidents: [
    {
      id: "ai-incident-2026-05-13-001",
      severity: "advisory",
      vendor: "openai",
      product: "GPT flagship via OpenAI API",
      sourceUrl: "https://example.com/source-placeholder",
      summary:
        "Multiple enterprise users reported degraded tool-call reliability on agent workflows over a 36-hour window starting 14 May.",
      implications:
        "Customers running production agents that rely on tool-calling should review their fallback handling. The drift signal in this issue's scorecards corresponds.",
    },
  ],
  methodologyNotes: {
    pendingChanges: [],
    vendorDisputes: [],
    disclosureItems: [],
  },
  lookingAhead:
    "OpenAI's silent drift this week is the kind of signal the index was built to surface. Watch next week for whether the regression is reverted, disclosed, or persists. The pattern of detection-then-disclosure shapes how seriously the next quarter of issues will be taken.",
};

// ============================================================================
// Run
// ============================================================================

const markdown = renderIssueToMarkdown(demoIssue);
const outputPath = resolve(repoRoot, "observatory", "_preview-issue-002.md");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, markdown, "utf8");

console.log(`\nRendered synthetic Issue ${pad3(demoIssue.number)} preview.`);
console.log(`Written to: ${outputPath}`);
console.log(`Size: ${markdown.length} bytes, ${markdown.split("\n").length} lines`);
console.log(`\nThis is a PREVIEW with synthetic data — not for publication.`);
console.log(`The real Issue 002 will be produced from actual measurements.\n`);
