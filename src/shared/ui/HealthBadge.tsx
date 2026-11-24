/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { HEALTH_CHECK_STATUS_META, HealthCheckStatus } from '../../types';

interface HealthBadgeProps {
  status: HealthCheckStatus;
}

const BADGE_STYLES: Record<
  HealthCheckStatus,
  { container: string; dot: string }
> = {
  pass: {
    container: 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
    dot: 'bg-emerald-400',
  },
  fail: {
    container: 'bg-red-950/80 text-red-300 border-red-800',
    dot: 'bg-red-400',
  },
  incomplete: {
    container: 'bg-slate-900 text-sky-300 border-sky-800/80',
    dot: 'bg-sky-400',
  },
  not_applicable: {
    container: 'bg-slate-900 text-indigo-300 border-indigo-800/80',
    dot: 'bg-indigo-400',
  },
  warning: {
    container: 'bg-amber-950/80 text-amber-300 border-amber-800',
    dot: 'bg-amber-400',
  },
};

export const HealthBadge: React.FC<HealthBadgeProps> = ({ status }) => {
  const meta = HEALTH_CHECK_STATUS_META[status];
  const style = BADGE_STYLES[status];

  return (
    <span
      data-health-status={status}
      title={meta.descriptionAr}
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold border whitespace-nowrap ${style.container}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
      <span>{meta.labelAr}</span>
    </span>
  );
};
