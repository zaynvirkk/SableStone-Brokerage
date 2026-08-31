BEGIN;
DROP TABLE IF EXISTS economic_floors;
DROP TABLE IF EXISTS cost_components;
DELETE FROM schema_migrations WHERE version = '0011_costs';
COMMIT;
