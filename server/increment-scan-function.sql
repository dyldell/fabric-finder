-- PostgreSQL function for atomic scan count increment
-- This ensures thread-safe increment operations

CREATE OR REPLACE FUNCTION increment_scan_count(
  p_user_id TEXT,
  p_scan_month TEXT,
  p_fingerprint TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Try to increment existing record
  UPDATE user_scans
  SET
    scan_count = scan_count + 1,
    last_scan_at = NOW(),
    updated_at = NOW(),
    fingerprint = COALESCE(fingerprint, p_fingerprint) -- Update fingerprint if not set
  WHERE user_id = p_user_id AND scan_month = p_scan_month;

  -- If no rows updated, insert new record
  IF NOT FOUND THEN
    INSERT INTO user_scans (user_id, scan_month, fingerprint, scan_count, last_scan_at)
    VALUES (p_user_id, p_scan_month, p_fingerprint, 1, NOW())
    ON CONFLICT (user_id, scan_month)
    DO UPDATE SET
      scan_count = user_scans.scan_count + 1,
      last_scan_at = NOW(),
      updated_at = NOW();
  END IF;
END;
$$;
