create table public.lines (
  id uuid primary key default gen_random_uuid(),
  song_id uuid references public.songs on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,

  text text not null,
  custom_text text,
  annotations jsonb not null default '[]',
  "order" integer not null,
  start_ms integer,
  end_ms integer,
  status text not null default 'not_started'
    check (status in ('not_started', 'learning', 'mastered')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lines enable row level security;

create policy "Users can manage own lines"
  on public.lines for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index lines_song_id_idx on public.lines (song_id);

create trigger lines_updated_at
  before update on public.lines
  for each row execute function public.set_updated_at();
