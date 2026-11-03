-- Organiza o catálogo por projeto sem remover nem recriar dados existentes.
alter table public.vizzion_products
  add column if not exists project_id text,
  add column if not exists search_text text not null default '';

update public.vizzion_products
set
  project_id = nullif(product_data->>'projectId', ''),
  search_text = lower(
    trim(
      coalesce(title, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(product_data->>'title', '') || ' ' ||
      coalesce(product_data->>'category', '')
    )
  )
where project_id is distinct from nullif(product_data->>'projectId', '')
   or search_text = '';

create index if not exists idx_vizzion_products_project_id
  on public.vizzion_products (project_id);

create index if not exists idx_vizzion_products_project_category
  on public.vizzion_products (project_id, category);

create index if not exists idx_vizzion_products_project_title
  on public.vizzion_products (project_id, title);
