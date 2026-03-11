-- Security Fix: Remove SECURITY DEFINER from views and restrict anon access
-- Run this in Supabase SQL Editor to fix the security warnings

-- Step 1: Revoke anon access (prevents public exposure of API data)
REVOKE ALL ON daily_totals FROM anon;
REVOKE ALL ON monthly_totals FROM anon;

-- Step 2: Drop existing views
DROP VIEW IF EXISTS daily_totals;
DROP VIEW IF EXISTS monthly_totals;

-- Step 3: Recreate views with security_invoker=true (removes SECURITY DEFINER)
CREATE OR REPLACE VIEW daily_totals WITH (security_invoker=true) AS
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

CREATE OR REPLACE VIEW monthly_totals WITH (security_invoker=true) AS
SELECT
  DATE_TRUNC('month', created_at) as month,
  api_name,
  COUNT(*) as total_scans,
  SUM(estimated_cost) as total_cost,
  SUM(call_count) as total_api_calls
FROM api_tracking
GROUP BY DATE_TRUNC('month', created_at), api_name
ORDER BY month DESC, api_name;

-- Step 4: Grant access only to authenticated users (dashboard admins)
GRANT SELECT ON daily_totals TO authenticated;
GRANT SELECT ON monthly_totals TO authenticated;

-- Done! Check Security Advisor - errors should be gone
