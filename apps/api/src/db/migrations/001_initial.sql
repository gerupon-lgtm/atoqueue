CREATE TABLE IF NOT EXISTS device_subscriptions (
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

CREATE TABLE IF NOT EXISTS reminder_jobs (
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

CREATE INDEX IF NOT EXISTS idx_reminder_jobs_due
ON reminder_jobs(status, scheduled_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_jobs_idempotency
ON reminder_jobs(device_id, idempotency_key);

CREATE TABLE IF NOT EXISTS device_idempotency_operations (
  device_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (device_id, operation, idempotency_key),
  FOREIGN KEY (device_id) REFERENCES device_subscriptions(device_id)
);
