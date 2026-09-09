ALTER TABLE device_subscriptions ADD COLUMN IF NOT EXISTS app_id TEXT NOT NULL DEFAULT 'atoqueue';
ALTER TABLE device_subscriptions ADD COLUMN IF NOT EXISTS protocol_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reminder_jobs ADD COLUMN IF NOT EXISTS route_key TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_device_subscriptions_app ON device_subscriptions(app_id, device_id);
