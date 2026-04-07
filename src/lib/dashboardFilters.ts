import type { PicklistSelection } from "@/lib/picklistEngine";
import type { PeriodMode } from "@/lib/periodMode";

/** Global filter bar + period mode. `managers` is always null (manager scope is Manager View only). */
export type DashboardFilters = {
  agents: PicklistSelection;
  months: PicklistSelection;
  moduleSearch: string;
  managers: null;
  teams: PicklistSelection;
  periodMode: PeriodMode;
};
