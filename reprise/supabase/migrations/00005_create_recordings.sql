create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  song_id uuid references public.songs on delete cascade not null,
  line_id uuid references public.lines on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,

  file_path text not null,
  duration_ms integer not null,
  is_master_take boolean not null default false,
  section_id uuid references public.sections on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.recordings enable row level security;

create policy "Users can manage own recordings"
  on public.recordings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index recordings_song_id_idx on public.recordings (song_id);
create index recordings_line_id_idx on public.recordings (line_id);

create trigger recordings_updated_at
  before update on public.recordings
  for each row execute function public.set_updated_at();
