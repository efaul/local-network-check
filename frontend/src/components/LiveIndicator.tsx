/**
 * Small pulsing dot marking a view as actively polling, as distinct from a
 * static snapshot that only updates on manual reload. Deliberately not
 * StatusBadge: that component's colour is tied to StatusName (ok/degraded/
 * down/error/unknown) and has no "I am live right now" meaning to borrow.
 */
export function LiveIndicator({ label = 'Live' }: { label?: string }) {
  return (
    <span className="live-indicator" title="This view refreshes automatically">
      <span className="live-indicator-dot" />
      {label}
    </span>
  );
}
