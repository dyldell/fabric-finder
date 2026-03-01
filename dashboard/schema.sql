-- API Tracking Database Schema for Fabric Finder
-- Run this once in Supabase SQL Editor

-- Main tracking table
CREATE TABLE IF NOT EXISTS api_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scan_url TEXT NOT NULL,
  api_name TEXT NOT NULL CHECK (api_name IN ('claude', 'serpapi', 'firecrawl', 'supabase')),
  call_count INTEGER NOT NULL DEFAULT 1,
  estimated_cost DECIMAL(10, 6) NOT NULL DEFAULT 0,
  response_time_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'cached')),
  tokens_used INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_api_tracking_created_at ON api_tracking(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_tracking_api_name ON api_tracking(api_name);
CREATE INDEX IF NOT EXISTS idx_api_tracking_status ON api_tracking(status);
CREATE INDEX IF NOT EXISTS idx_api_tracking_date ON api_tracking(DATE(created_at));

-- Daily totals view (aggregated for performance)
CREATE OR REPLACE VIEW daily_totals AS
SELECT
  DATE(created_at) as date,
  api_name,
  COUNT(*) as total_calls,
  SUM(estimated_cost) as total_cost,
  SUM(call_count) as total_api_calls,
  AVG(response_time_ms) as avg_response_time,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
  COUNT(CASE WHEN status = 'error' THEN 1 END) as error_count,
  COUNT(CASE WHEN status = 'cached' THEN 1 END) as cached_count
FROM api_tracking
GROUP BY DATE(created_at), api_name
ORDER BY date DESC, api_name;

-- Monthly totals view
CREATE OR REPLACE VIEW monthly_totals AS
SELECT
  DATE_TRUNC('month', created_at) as month,
  api_name,
  COUNT(*) as total_scans,
  SUM(estimated_cost) as total_cost,
  SUM(call_count) as total_api_calls
FROM api_tracking
GROUP BY DATE_TRUNC('month', created_at), api_name
ORDER BY month DESC, api_name;

-- Enable Row Level Security (RLS)
ALTER TABLE api_tracking ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role to do everything
CREATE POLICY "Service role can do everything" ON api_tracking
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Policy: Allow authenticated users to read (for dashboard)
CREATE POLICY "Authenticated users can read" ON api_tracking
  FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

-- Grant permissions
GRANT SELECT ON daily_totals TO authenticated, anon;
GRANT SELECT ON monthly_totals TO authenticated, anon;

-- Create function to get today's stats (faster than view for dashboard)
CREATE OR REPLACE FUNCTION get_todays_stats()
RETURNS TABLE (
  api_name TEXT,
  total_calls BIGINT,
  total_cost NUMERIC,
  success_count BIGINT,
  error_count BIGINT,
  avg_response_time NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.api_name,
    COUNT(*)::BIGINT as total_calls,
    SUM(a.estimated_cost)::NUMERIC as total_cost,
    COUNT(CASE WHEN a.status = 'success' THEN 1 END)::BIGINT as success_count,
    COUNT(CASE WHEN a.status = 'error' THEN 1 END)::BIGINT as error_count,
    AVG(a.response_time_ms)::NUMERIC as avg_response_time
  FROM api_tracking a
  WHERE DATE(a.created_at) = CURRENT_DATE
  GROUP BY a.api_name;
END;
$$ LANGUAGE plpgsql STABLE;
