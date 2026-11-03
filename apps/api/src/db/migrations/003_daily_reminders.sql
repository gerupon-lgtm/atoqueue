ALTER TABLE reminder_jobs
  DROP CONSTRAINT IF EXISTS reminder_jobs_repeat_cadence_check;

ALTER TABLE reminder_jobs
  ADD CONSTRAINT reminder_jobs_repeat_cadence_check
  CHECK (repeat_cadence IN ('daily', 'weekly', 'monthly'));
