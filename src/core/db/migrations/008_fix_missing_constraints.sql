BEGIN;

ALTER TABLE group_loader_routes ADD CONSTRAINT group_loader_routes_group_id_key UNIQUE (group_id);
ALTER TABLE group_price_profile_assignments ADD CONSTRAINT group_price_profile_assignments_group_id_key UNIQUE (group_id);
ALTER TABLE group_payment_profile_assignments ADD CONSTRAINT group_payment_profile_assignments_group_id_key UNIQUE (group_id);

COMMIT;
