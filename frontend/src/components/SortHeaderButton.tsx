import type { SortKey, SortState } from "../types";

type SortHeaderButtonProps = {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
};

export default function SortHeaderButton({ label, sortKey, sort, onSort }: SortHeaderButtonProps) {
  const isActive = sort.key === sortKey;
  const indicator = sort.order === "asc" ? "icon-down" : "icon-up";

  return (
    <button
      type="button"
      className={`sort-button${isActive ? " is-active" : ""}`}
      onClick={() => onSort(sortKey)}
    >
      <span>{label}</span>
      <span
        className={`sort-indicator iconfont ${isActive ? indicator : "icon-down"}${isActive ? "" : " is-placeholder"}`}
        aria-hidden="true"
      >
      </span>
    </button>
  );
}
