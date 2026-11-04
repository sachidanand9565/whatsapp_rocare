-- ============================================================
-- One-time fix: contacts that were never opted out by the customer.
-- contacts.opted_in defaults to 0, and "Import CSV" / "Add Contact" didn't
-- set it, so every contact added that way looked opted out and campaigns
-- skipped it ("opted_out"). This turns them back on — except contacts who
-- really sent STOP.
--
-- NOTE: shared database — this applies to both panels. It also turns back on
-- anyone opted out by hand with the Opt Out button (that isn't recorded
-- anywhere, so it can't be told apart). Run step 1 first and look at the count.
-- ============================================================

-- 1) How many would change (per project)
SELECT c.workspace_id, COUNT(*) AS will_opt_in
FROM contacts c
WHERE c.opted_in = 0
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.contact_id = c.id AND m.direction = 'inbound'
      AND (LOWER(TRIM(m.content)) = 'stop' OR LOWER(TRIM(m.content)) LIKE 'stop %')
  )
GROUP BY c.workspace_id;

-- 2) The fix. To limit it to one project add:  AND c.workspace_id = <id>
UPDATE contacts c
SET c.opted_in = 1
WHERE c.opted_in = 0
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.contact_id = c.id AND m.direction = 'inbound'
      AND (LOWER(TRIM(m.content)) = 'stop' OR LOWER(TRIM(m.content)) LIKE 'stop %')
  );
