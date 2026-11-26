import type { RecurringJob } from './scheduler.ts';

export const SALES_RECURRING_JOBS: readonly RecurringJob[] = [
  {
    type: 'payment.reconcile_orders',
    schedule: { kind: 'interval', everyMinutes: 5 },
    payload: {},
  },
  {
    type: 'payment.reconcile_refunds',
    schedule: { kind: 'interval', everyMinutes: 30 },
    payload: {},
  },
];
