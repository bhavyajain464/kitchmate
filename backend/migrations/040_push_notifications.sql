-- Remote push tokens (Expo) and marketing opt-in for product announcements.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS marketing_push_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS device_push_tokens (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    expo_push_token    TEXT NOT NULL,
    platform           TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    device_id          TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (expo_push_token)
);

CREATE INDEX IF NOT EXISTS ix_device_push_tokens_user ON device_push_tokens (user_id);

CREATE TABLE IF NOT EXISTS push_notification_log (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_key       TEXT,
    title              TEXT NOT NULL,
    body               TEXT NOT NULL,
    audience           TEXT NOT NULL,
    target_user_id     UUID REFERENCES users(user_id) ON DELETE SET NULL,
    tokens_targeted    INT NOT NULL DEFAULT 0,
    tickets_ok         INT NOT NULL DEFAULT 0,
    tickets_error      INT NOT NULL DEFAULT 0,
    created_by_email   TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_push_notification_log_created ON push_notification_log (created_at DESC);
