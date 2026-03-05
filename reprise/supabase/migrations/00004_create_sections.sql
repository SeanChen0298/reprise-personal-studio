create table public.sections (
  id uuid primary key default gen_random_uuid(),
  song_id uuid references public.songs on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,

  name text not null,
  start_line_order integer not null,
  end_line_order integer not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sections enable row level security;

create policy "Users can manage own sections"
  on public.sections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index sections_song_id_idx on public.sections (song_id);

create trigger sections_updated_at
  before update on public.sections
  for each row execute function public.set_updated_at();
