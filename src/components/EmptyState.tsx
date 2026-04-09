import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon != null ? (
        <div className="empty-state-icon" aria-hidden>
          {icon}
        </div>
      ) : null}
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-msg">{children}</div>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
