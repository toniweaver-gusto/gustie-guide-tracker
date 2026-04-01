import type { PicklistSelection } from "@/lib/picklistEngine";
import {
  filterValuesBySearch,
  itemChecked,
  selectAllChecked,
  selectAllIndeterminate,
} from "@/lib/picklistEngine";

type Props = {
  label: string;
  buttonLabel: string;
  allValues: string[];
  selected: PicklistSelection;
  open: boolean;
  search: string;
  onToggleOpen: () => void;
  onSearchChange: (s: string) => void;
  onToggleAll: (e: React.SyntheticEvent) => void;
  onToggleItem: (val: string, checked: boolean) => void;
  formatOption?: (v: string) => string;
};

export function FilterPicklist({
  label,
  buttonLabel,
  allValues,
  selected,
  open,
  search,
  onToggleOpen,
  onSearchChange,
  onToggleAll,
  onToggleItem,
  formatOption,
}: Props) {
  const visible = filterValuesBySearch(allValues, search, formatOption);
  const allOn = selectAllChecked(selected);
  const indeterminate = selectAllIndeterminate(selected, allValues);

  return (
    <div className={`picklist-wrap${open ? " open" : ""}`}>
      <span className="picklist-label">{label}</span>
      <button
        type="button"
        className="picklist-btn"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          onToggleOpen();
        }}
      >
        <span className="picklist-btn-text">{buttonLabel}</span>
        <span className="picklist-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          className="picklist-dropdown"
          role="listbox"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            type="search"
            className="picklist-search"
            placeholder="Search…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <label
            className="picklist-option picklist-select-all"
            onMouseDown={(e) => e.preventDefault()}
          >
            <input
              type="checkbox"
              checked={allOn}
              ref={(el) => {
                if (el) el.indeterminate = indeterminate;
              }}
              onChange={(e) => {
                e.stopPropagation();
                onToggleAll(e);
              }}
            />
            <span>Select All</span>
          </label>
          <div className="picklist-options-scroll">
            {visible.map((val) => (
              <label key={val} className="picklist-option">
                <input
                  type="checkbox"
                  checked={itemChecked(selected, val, allValues)}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleItem(val, e.target.checked);
                  }}
                />
                <span>{formatOption ? formatOption(val) : val}</span>
              </label>
            ))}
            {!visible.length ? (
              <div className="picklist-empty">No matches</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
