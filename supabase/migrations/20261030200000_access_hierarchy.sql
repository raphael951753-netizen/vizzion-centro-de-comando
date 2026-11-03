-- MASTERADMIN is derived only from the Edge Function secret.
-- Persisted profiles intentionally remain limited to admin/member.
create index if not exists "idx_vizzion_profiles_role"
  on public.vizzion_profiles using btree (role);
