-- Removes duplicate UNIQUE constraints: two or more unique constraints on exactly the same
-- columns (same order) of the same table. The one with the canonical name is kept - the
-- shortest, e.g. users_email_key over users_email_key1 - so every rule stays enforced exactly as
-- before under the name Sequelize expects; no data changes.
--
-- Why they exist: `db:init` used sequelize.sync({ alter: true }), and Sequelize re-applies a
-- column-level `unique: true` (users.email) as a NEW constraint on every alter run -
-- users_email_key, then users_email_key1, users_email_key2... Each duplicate is a redundant
-- index that every insert/update of that column has to maintain. db:init now uses plain sync(),
-- so no new duplicates appear; this cleans up the ones already there, in any environment.
DO $$
DECLARE
  dup record;
BEGIN
  FOR dup IN
    SELECT c.conrelid::regclass AS tbl, c.conname
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema()
      AND c.contype = 'u'
      AND EXISTS (
        SELECT 1 FROM pg_constraint keep
        WHERE keep.conrelid = c.conrelid AND keep.contype = 'u' AND keep.conkey = c.conkey
          AND (length(keep.conname), keep.conname) < (length(c.conname), c.conname)
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', dup.tbl, dup.conname);
    RAISE NOTICE 'Dropped duplicate unique constraint % on %', dup.conname, dup.tbl;
  END LOOP;
END $$;
