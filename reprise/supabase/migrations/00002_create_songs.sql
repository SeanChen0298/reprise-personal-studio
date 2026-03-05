create table public.songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,

  title text not null,
  artist text not null,
  youtube_url text,
  thumbnail_url text,
  thumbnail_b64 text,
  duration_ms integer,
  bpm integer,
  language text,
  tags text[] not null default '{}',
  notes text,
  pinned boolean not null default false,
  mastery integer not null default 0,

  -- Local file paths (desktop only, not synced meaningfully across devices)
  audio_path text,
  audio_folder text,
  vocals_path text,
  instrumental_path text,
  pitch_data_path text,

  -- Processing statuses
  download_status text not null default 'idle'
    check (download_status in ('idle', 'downloading', 'done', 'error')),
  download_error text,
  stem_status text not null default 'idle'
    check (stem_status in ('idle', 'processing', 'done', 'error')),
  stem_error text,
  pitch_status text not null default 'idle'
    check (pitch_status in ('idle', 'processing', 'done', 'error')),
  pitch_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.songs enable row level security;

create policy "Users can manage own songs"
  on public.songs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger songs_updated_at
  before update on public.songs
  for each row execute function public.set_updated_at();
