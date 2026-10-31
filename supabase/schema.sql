-- AdrrexAI: tabulka pro ukládání chatů. Spusť v Supabase → SQL Editor → New query → Run.
create table if not exists public.chats (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Nový chat',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chats_user_updated_idx on public.chats (user_id, updated_at desc);

-- Každý uživatel vidí a mění jen své vlastní chaty.
alter table public.chats enable row level security;

drop policy if exists "chats_select_own" on public.chats;
drop policy if exists "chats_insert_own" on public.chats;
drop policy if exists "chats_update_own" on public.chats;
drop policy if exists "chats_delete_own" on public.chats;

create policy "chats_select_own" on public.chats for select to authenticated using ((select auth.uid()) = user_id);
create policy "chats_insert_own" on public.chats for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "chats_update_own" on public.chats for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "chats_delete_own" on public.chats for delete to authenticated using ((select auth.uid()) = user_id);
