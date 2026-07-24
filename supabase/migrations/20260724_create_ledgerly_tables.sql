-- Ledgerly's application data. Raw CSV files are deliberately not retained.
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  filename text not null,
  institution text not null,
  account_name text not null,
  account_type text not null check (account_type in ('checking', 'savings', 'credit')),
  rows_read integer not null check (rows_read >= 0),
  rows_added integer not null check (rows_added >= 0),
  duplicates_ignored integer not null check (duplicates_ignored >= 0),
  created_at timestamptz not null default now()
);

create table public.transactions (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  institution text not null,
  account_id text not null,
  account_name text not null,
  account_type text not null check (account_type in ('checking', 'savings', 'credit')),
  date date not null,
  description text not null,
  amount numeric(12, 2) not null,
  category text not null,
  import_file text not null,
  excluded boolean not null default false,
  exclusion_reason text,
  transfer_group_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index transactions_user_date_idx on public.transactions (user_id, date desc);
create index imports_user_created_at_idx on public.imports (user_id, created_at desc);

grant select, insert, update, delete on public.imports to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;

alter table public.imports enable row level security;
alter table public.transactions enable row level security;

create policy "Users can manage their own imports"
  on public.imports for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can manage their own transactions"
  on public.transactions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
