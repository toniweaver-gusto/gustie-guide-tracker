/** `null` = all selected, `[]` = none, `[...]` = explicit subset */
export type PicklistSelection = string[] | null;

export type PicklistId =
  | "agent"
  | "month"
  | "module"
  | "team"
  | "manager";

export type PicklistSlice = {
  open: boolean;
  search: string;
  selected: PicklistSelection;
};

export function initialPicklistState(): Record<PicklistId, PicklistSlice> {
  return {
    agent: { open: false, search: "", selected: null },
    month: { open: false, search: "", selected: null },
    module: { open: false, search: "", selected: null },
    team: { open: false, search: "", selected: null },
    manager: { open: false, search: "", selected: null },
  };
}

/** Selection semantics for data filtering: same as `selected` in slice. */
export function getPicklistValues(
  slice: PicklistSlice | undefined
): PicklistSelection {
  return slice?.selected ?? null;
}

export function itemChecked(
  selected: PicklistSelection,
  val: string,
  allValues: string[]
): boolean {
  if (allValues.length === 0) return false;
  if (selected === null) return true;
  if (selected.length === 0) return false;
  return selected.includes(val);
}

export function selectAllChecked(selected: PicklistSelection): boolean {
  return selected === null;
}

export function selectAllIndeterminate(
  selected: PicklistSelection,
  allValues: string[]
): boolean {
  return (
    Array.isArray(selected) &&
    selected.length > 0 &&
    selected.length < allValues.length
  );
}

/** Next selection after toggling one item (checkbox or label click). */
export function applyPicklistItemToggle(
  selected: PicklistSelection,
  val: string,
  checked: boolean,
  allValues: string[]
): PicklistSelection {
  if (allValues.length === 0) return [];
  if (selected === null) {
    if (!checked) {
      const next = allValues.filter((v) => v !== val);
      if (next.length === 0) return [];
      if (next.length === allValues.length) return null;
      return next;
    }
    return null;
  }
  if (selected.length === 0) {
    if (checked) {
      const next = [val];
      if (next.length === allValues.length) return null;
      return next;
    }
    return [];
  }
  let next: string[];
  if (checked) {
    next = [...new Set([...selected, val])];
  } else {
    next = selected.filter((x) => x !== val);
  }
  if (next.length === 0) return [];
  if (next.length === allValues.length) return null;
  return next;
}

/** Select all → null; any other → [] (then user can check items). */
export function toggleAllPicklist(
  selected: PicklistSelection,
  _allValues: string[]
): PicklistSelection {
  if (selected === null) return [];
  return null;
}

export function picklistButtonLabel(
  selected: PicklistSelection,
  allValues: string[],
  allLabel: string,
  noneLabel: string,
  format?: (v: string) => string
): string {
  if (selected === null) return allLabel;
  if (selected.length === 0) return noneLabel;
  if (
    allValues.length > 0 &&
    selected.length === allValues.length
  )
    return allLabel;
  if (selected.length === 1) {
    const v = selected[0]!;
    return format ? format(v) : v;
  }
  return `${selected.length} selected`;
}

export function filterValuesBySearch(
  values: string[],
  search: string,
  format?: (v: string) => string
): string[] {
  const q = search.trim().toLowerCase();
  if (!q) return values;
  return values.filter((v) => {
    const hay = (format ? format(v) : v).toLowerCase();
    return hay.includes(q) || v.toLowerCase().includes(q);
  });
}
