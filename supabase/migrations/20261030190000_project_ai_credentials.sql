create table "public"."vizzion_project_ai_credentials" (
  "project_id" text not null,
  "provider" text not null default 'gemini'::text,
  "ciphertext" text not null,
  "iv" text not null,
  "key_hint" text not null,
  "key_version" integer not null default 1,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  "last_tested_at" timestamp with time zone,
  "last_test_status" text,
  "last_error_code" text,
  constraint "vizzion_project_ai_credentials_provider_check" check ("provider" = 'gemini'::text),
  constraint "vizzion_project_ai_credentials_key_version_check" check ("key_version" > 0),
  constraint "vizzion_project_ai_credentials_test_status_check" check (
    "last_test_status" is null or "last_test_status" = any (array['success'::text, 'error'::text])
  )
);

alter table "public"."vizzion_project_ai_credentials" enable row level security;

create unique index "vizzion_project_ai_credentials_pkey"
  on "public"."vizzion_project_ai_credentials" using btree ("project_id");

create index "idx_vizzion_project_ai_credentials_updated_at"
  on "public"."vizzion_project_ai_credentials" using btree ("updated_at" desc);

create index "idx_vizzion_project_ai_credentials_created_by"
  on "public"."vizzion_project_ai_credentials" using btree ("created_by");

alter table "public"."vizzion_project_ai_credentials"
  add constraint "vizzion_project_ai_credentials_pkey"
  primary key using index "vizzion_project_ai_credentials_pkey";

alter table "public"."vizzion_project_ai_credentials"
  add constraint "vizzion_project_ai_credentials_created_by_fkey"
  foreign key ("created_by") references auth.users(id) on delete set null not valid;

alter table "public"."vizzion_project_ai_credentials"
  validate constraint "vizzion_project_ai_credentials_created_by_fkey";

alter table "public"."vizzion_project_ai_credentials"
  add constraint "vizzion_project_ai_credentials_updated_by_fkey"
  foreign key ("updated_by") references auth.users(id) on delete set null not valid;

alter table "public"."vizzion_project_ai_credentials"
  validate constraint "vizzion_project_ai_credentials_updated_by_fkey";

revoke all on table "public"."vizzion_project_ai_credentials" from anon, authenticated;

grant delete on table "public"."vizzion_project_ai_credentials" to service_role;
grant insert on table "public"."vizzion_project_ai_credentials" to service_role;
grant select on table "public"."vizzion_project_ai_credentials" to service_role;
grant update on table "public"."vizzion_project_ai_credentials" to service_role;
