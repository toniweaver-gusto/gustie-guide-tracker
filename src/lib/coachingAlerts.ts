import { getAvgAttemptsForModule } from "./attemptsFromRows";
import type { ProcessedDashboardData } from "./types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function countAgentsMissingAnyModule(
  data: ProcessedDashboardData,
  agents: string[],
  mods: string[]
): number {
  const hit = new Set<string>();
  for (const a of agents) {
    for (const mod of mods) {
      if (!data.agent_modules[a]?.[mod]) {
        hit.add(a);
        break;
      }
    }
  }
  return hit.size;
}

/**
 * Returns HTML fragments for Upskill Alerts and Next Steps (Overview + Manager View).
 * Matches the vanilla dashboard markup/classes.
 */
export function buildCoachingAlerts(
  data: ProcessedDashboardData,
  agents: string[],
  modules: string[]
): {
  alertsHtml: string;
  nextStepsHtml: string;
  hasAlerts: boolean;
} {
  if (!agents.length || !modules.length) {
    return { alertsHtml: "", nextStepsHtml: "", hasAlerts: false };
  }

  type LowRow = { mod: string; pct: number; done: number };
  type HighRow = { mod: string; avgAtt: number };
  const lowRows: LowRow[] = [];
  const highRows: HighRow[] = [];

  for (const mod of modules) {
    const done = agents.filter((a) => data.agent_modules[a]?.[mod]).length;
    const pct = Math.round((done / agents.length) * 100);
    if (done / agents.length < 0.8) {
      lowRows.push({ mod, pct, done });
    }
    const avgAtt = getAvgAttemptsForModule(data, mod, agents);
    if (done > 0 && avgAtt > 1.5) {
      highRows.push({ mod, avgAtt });
    }
  }

  const alertParts: string[] = [];
  for (const { mod, pct, done } of lowRows) {
    const em = escapeHtml(mod);
    alertParts.push(
      `<div class="coaching-alert low-completion">` +
        `<span class="coaching-alert-icon" aria-hidden="true">🔴</span>` +
        `<div class="coaching-alert-body">` +
        `<div class="coaching-alert-title">LOW COMPLETION — ${em}</div>` +
        `<div class="coaching-alert-desc">Only ${pct}% of agents (${done}/${agents.length}) have completed this module. Consider office hours, async resources, or clearer due dates.</div>` +
        `</div></div>`
    );
  }
  for (const { mod, avgAtt } of highRows) {
    const em = escapeHtml(mod);
    alertParts.push(
      `<div class="coaching-alert high-attempts">` +
        `<span class="coaching-alert-icon" aria-hidden="true">⚠️</span>` +
        `<div class="coaching-alert-body">` +
        `<div class="coaching-alert-title">HIGH ATTEMPTS — ${em}</div>` +
        `<div class="coaching-alert-desc">Averages ${avgAtt.toFixed(2)} attempts per completion (above 1.5). Review difficulty, prerequisites, or job aids for this module.</div>` +
        `</div></div>`
    );
  }

  const alertsHtml =
    alertParts.length > 0
      ? `<div class="upskill-alerts-title">⚠️ Upskill Alerts</div>` +
        `<div class="coaching-alerts-list">${alertParts.join("")}</div>`
      : "";

  const lowModNames = lowRows.map((r) => r.mod);
  const highModNames = highRows.map((r) => r.mod);
  const stepItems: string[] = [];

  if (lowModNames.length > 0) {
    const missing = countAgentsMissingAnyModule(data, agents, lowModNames);
    const modSpans = lowModNames
      .slice(0, 6)
      .map(
        (m) =>
          `<strong class="next-step-highlight">${escapeHtml(m)}</strong>`
      )
      .join(", ");
    const tail = lowModNames.length > 6 ? ", …" : "";
    stepItems.push(
      `<li class="next-step-item">` +
        `<span class="next-step-num">1</span>` +
        `<span class="next-step-text">Prioritize ${modSpans}${tail} — <span class="next-step-highlight">${missing} agent${missing !== 1 ? "s" : ""}</span> still need at least one of these completions.</span>` +
        `</li>`
    );
  }

  if (highModNames.length > 0) {
    const idx = stepItems.length + 1;
    const modSpans = highModNames
      .slice(0, 6)
      .map(
        (m) =>
          `<strong class="next-step-highlight">${escapeHtml(m)}</strong>`
      )
      .join(", ");
    const tail = highModNames.length > 6 ? ", …" : "";
    stepItems.push(
      `<li class="next-step-item">` +
        `<span class="next-step-num">${idx}</span>` +
        `<span class="next-step-text">Review content and scaffolding for ${modSpans}${tail} — high retry rates suggest friction for <span class="next-step-highlight">${agents.length} agent${agents.length !== 1 ? "s" : ""}</span> in scope.</span>` +
        `</li>`
    );
  }

  if (!stepItems.length && alertParts.length > 0) {
    stepItems.push(
      `<li class="next-step-item">` +
        `<span class="next-step-num">1</span>` +
        `<span class="next-step-text">Review flagged modules on the <strong class="next-step-highlight">By Module</strong> tab and follow up with managers.</span>` +
        `</li>`
    );
  }

  const nextStepsHtml =
    stepItems.length > 0
      ? `<div class="next-steps-title">📋 Next Steps</div>` +
        `<ol class="next-steps-list">${stepItems.join("")}</ol>`
      : "";

  const hasAlerts = Boolean(alertsHtml) || Boolean(nextStepsHtml);

  return { alertsHtml, nextStepsHtml, hasAlerts };
}
