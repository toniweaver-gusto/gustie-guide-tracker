import type { ReactNode } from "react";
import { buildCoachingAlerts } from "@/lib/coachingAlerts";
import type { ProcessedDashboardData } from "@/lib/types";

export function CoachingPanel({
  data,
  agents,
  modules,
}: {
  data: ProcessedDashboardData;
  agents: string[];
  modules: string[];
}): ReactNode {
  const { alerts, nextSteps, atRiskAgents } = buildCoachingAlerts(
    data,
    agents,
    modules
  );

  if (!alerts.length && !nextSteps.length && !atRiskAgents.length) {
    return null;
  }

  return (
    <div className="section-block coaching-wrap">
      <div className="ov-section-title coaching-panel-heading">
        Coaching alerts &amp; next steps
      </div>

      {alerts.length > 0 ? (
        <div className="coaching-alerts" role="list">
          {alerts.map((a, i) => (
            <div
              key={i}
              role="listitem"
              className={`coaching-alert ${
                a.kind === "low-completion"
                  ? "low-completion"
                  : "high-attempts"
              }`}
            >
              {a.text}
            </div>
          ))}
        </div>
      ) : null}

      {atRiskAgents.length > 0 ? (
        <div className="coaching-at-risk">
          <div className="coaching-at-risk-title">At risk</div>
          <ul className="coaching-at-risk-list">
            {atRiskAgents.map(({ name, reasons }) => (
              <li key={name}>
                <strong>{name}</strong>
                <span className="coaching-at-risk-reasons">
                  {" "}
                  — {reasons.join("; ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {nextSteps.length > 0 ? (
        <ol className="coaching-next-steps">
          {nextSteps.map((step, i) => (
            <li key={i} className="next-step-item">
              <span className="next-step-num">{i + 1}</span>
              <span className="next-step-text">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
