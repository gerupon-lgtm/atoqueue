CREATE TABLE device_subscriptions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error_code TEXT NULL
);

CREATE TABLE reminder_jobs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'sent', 'cancelled', 'failed')),
  idempotency_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  claimed_at TEXT NULL,
  sent_at TEXT NULL,
  last_error_code TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES device_subscriptions(device_id)
);

CREATE INDEX idx_reminder_jobs_due
ON reminder_jobs(status, scheduled_at);

CREATE UNIQUE INDEX idx_reminder_jobs_idempotency
ON reminder_jobs(device_id, idempotency_key);
