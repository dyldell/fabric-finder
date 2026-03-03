-- User Scans Tracking Table
-- Tracks anonymous user scan usage to prevent limit bypass

CREATE TABLE IF NOT EXISTS user_scans (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  fingerprint TEXT,
  scan_month TEXT NOT NULL, -- Format: "YYYY-MM"
  scan_count INTEGER DEFAULT 0,
  last_scan_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one record per user per month
  UNIQUE(user_id, scan_month)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_scans_user_month ON user_scans(user_id, scan_month);
CREATE INDEX IF NOT EXISTS idx_user_scans_fingerprint ON user_scans(fingerprint);

-- Admin whitelist table
CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  email TEXT, -- Optional: for reference
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default admin (you can add more via SQL or admin panel)
-- INSERT INTO admin_users (user_id, email, notes)
-- VALUES ('usr_admin_1', 'your-email@example.com', 'Main admin');

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for user_scans
DROP TRIGGER IF EXISTS update_user_scans_updated_at ON user_scans;
CREATE TRIGGER update_user_scans_updated_at
  BEFORE UPDATE ON user_scans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (optional, for future API access)
ALTER TABLE user_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Policies (allow server to read/write with service key)
CREATE POLICY "Allow service role all access on user_scans" ON user_scans
  FOR ALL USING (true);

CREATE POLICY "Allow service role all access on admin_users" ON admin_users
  FOR ALL USING (true);
