ALTER TABLE reminder_jobs
  ADD COLUMN IF NOT EXISTS repeat_cadence TEXT NULL
  CHECK (repeat_cadence IN ('weekly', 'monthly'));
