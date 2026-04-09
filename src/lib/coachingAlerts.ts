import { LOW_SCORE_THRESHOLD } from "./dashboardHelpers";
import { getAvgAttemptsForModule } from "./attemptsFromRows";
import type { ProcessedDashboardData } from "./types";

export type CoachingAlertItem = {
  kind: "low-completion" | "high-attempts";
  text: string;
};

/**
 * Auto-generated coaching signals for Overview and Manager View.
 * Uses filtered `agents` and `modules` lists (same semantics as dashboard views).
 */
export function buildCoachingAlerts(
  data: ProcessedDashboardData,
  agents: string[],
  modules: string[]
): {
  alerts: CoachingAlertItem[];
  nextSteps: string[];
  atRiskAgents: { name: string; reasons: string[] }[];
} {
  const alerts: CoachingAlertItem[] = [];
  const nextSteps: string[] = [];
  const atRiskAgents: { name: string; reasons: string[] }[] = [];

  if (!agents.length || !modules.length) {
    return { alerts, nextSteps, atRiskAgents };
  }

  const lowModNames: string[] = [];
  const highAttMods: string[] = [];

  for (const mod of modules) {
    const done = agents.filter((a) => data.agent_modules[a]?.[mod]).length;
    const pct = done / agents.length;
    if (pct < 0.8) {
      lowModNames.push(mod);
      alerts.push({
        kind: "low-completion",
        text: `“${mod}” is below 80% completion (${Math.round(pct * 100)}% of agents done).`,
      });
    }
    const avgAtt = getAvgAttemptsForModule(data, mod, agents);
    if (done > 0 && avgAtt > 1.5) {
      highAttMods.push(mod);
      alerts.push({
        kind: "high-attempts",
        text: `“${mod}” averages ${avgAtt.toFixed(2)} attempts per completion (above 1.5).`,
      });
    }
  }

  if (lowModNames.length) {
    nextSteps.push(
      `Schedule team time or async resources for low-completion modules: ${lowModNames.slice(0, 5).join("; ")}${lowModNames.length > 5 ? "…" : ""}.`
    );
  }
  if (highAttMods.length) {
    nextSteps.push(
      `Review content difficulty or prerequisites for high-retry modules: ${highAttMods.slice(0, 5).join("; ")}${highAttMods.length > 5 ? "…" : ""}.`
    );
  }

  const scoreMap = data._raw_scores ?? {};
  for (const a of agents) {
    const reasons: string[] = [];
    const completed = modules.filter((m) => data.agent_modules[a]?.[m]);
    const pct = modules.length ? completed.length / modules.length : 0;
    if (pct < 0.8) {
      reasons.push(`Completion below 80% (${Math.round(pct * 100)}%)`);
    }
    const scores = completed
      .map((m) => scoreMap[a]?.[m])
      .filter((x): x is number => x !== undefined);
    const avgScore = scores.length
      ? scores.reduce((x, y) => x + y, 0) / scores.length
      : null;
    if (avgScore !== null && avgScore < LOW_SCORE_THRESHOLD) {
      reasons.push(`Average score below ${LOW_SCORE_THRESHOLD}%`);
    }
    if (reasons.length) atRiskAgents.push({ name: a, reasons });
  }

  if (!nextSteps.length && alerts.length) {
    nextSteps.push(
      "Review flagged modules in the By Module tab and follow up with affected agents."
    );
  }

  return { alerts, nextSteps, atRiskAgents };
}
