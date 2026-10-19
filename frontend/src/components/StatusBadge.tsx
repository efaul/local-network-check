import type { StatusName } from '../types';
import { STATUS_TEXT } from '../format';

export function StatusBadge({ status, pulse = false }: { status: StatusName; pulse?: boolean }) {
  return (
    <span className={`badge badge-${status}`} data-pulse={pulse ? 'true' : 'false'}>
      <span className="badge-dot" />
      {STATUS_TEXT[status]}
    </span>
  );
}
