-- Backward-compatible additive tables for AI Multilingual Translation & Audiobook Narration.
-- Leaves all existing books, channels, bookmarks, analytics, and book_reading_progress intact.

CREATE TABLE IF NOT EXISTS public.book_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  original_language text NOT NULL DEFAULT 'en',
  target_language text NOT NULL,
  translation_quality text NOT NULL DEFAULT 'high',
  translation_version integer NOT NULL DEFAULT 1,
  translation_status text NOT NULL DEFAULT 'pending',
  glossary jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id, target_language, translation_quality)
);

CREATE INDEX IF NOT EXISTS idx_book_translations_user_book
  ON public.book_translations(user_id, book_id);

ALTER TABLE public.book_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own book translations"
  ON public.book_translations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.translated_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  translation_id uuid NOT NULL REFERENCES public.book_translations(id) ON DELETE CASCADE,
  original_chapter_id text NOT NULL,
  chapter_order integer NOT NULL DEFAULT 0,
  content_hash text NOT NULL,
  translated_content jsonb NOT NULL,
  translation_status text NOT NULL DEFAULT 'completed',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (translation_id, original_chapter_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_translated_chapters_translation
  ON public.translated_chapters(translation_id, chapter_order);

ALTER TABLE public.translated_chapters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own translated chapters"
  ON public.translated_chapters FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.book_translations bt
      WHERE bt.id = translation_id AND bt.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.book_translations bt
      WHERE bt.id = translation_id AND bt.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.audiobook_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  language text NOT NULL DEFAULT 'en',
  voice_id text NOT NULL DEFAULT 'Kore',
  generation_status text NOT NULL DEFAULT 'pending',
  total_segments integer NOT NULL DEFAULT 0,
  completed_segments integer NOT NULL DEFAULT 0,
  failed_segments integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audiobook_jobs_user_book
  ON public.audiobook_jobs(user_id, book_id);

ALTER TABLE public.audiobook_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own audiobook jobs"
  ON public.audiobook_jobs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.audiobook_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  chapter_id text NOT NULL,
  paragraph_id text NOT NULL,
  sentence_index integer NOT NULL DEFAULT 0,
  language text NOT NULL,
  voice_id text NOT NULL,
  content_hash text NOT NULL,
  audio_duration numeric,
  generation_status text NOT NULL DEFAULT 'completed',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id, chapter_id, paragraph_id, sentence_index, language, voice_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_audiobook_segments_lookup
  ON public.audiobook_segments(user_id, book_id, chapter_id, language, voice_id);

ALTER TABLE public.audiobook_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own audiobook segments"
  ON public.audiobook_segments FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.listening_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  language text NOT NULL DEFAULT 'en',
  chapter_id text NOT NULL,
  block_id text,
  segment_id text,
  sentence_index integer NOT NULL DEFAULT 0,
  playback_position numeric NOT NULL DEFAULT 0,
  playback_speed numeric NOT NULL DEFAULT 1.0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_listening_progress_user_book
  ON public.listening_progress(user_id, book_id);

ALTER TABLE public.listening_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own listening progress"
  ON public.listening_progress FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.user_voice_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  preferred_target_language text NOT NULL DEFAULT 'hi',
  preferred_tts_language text NOT NULL DEFAULT 'en',
  preferred_voice text NOT NULL DEFAULT 'Kore',
  preferred_secondary_voice text NOT NULL DEFAULT 'Puck',
  preferred_style text NOT NULL DEFAULT 'natural',
  preferred_speed numeric NOT NULL DEFAULT 1.0,
  dialogue_mode boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.user_voice_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own voice preferences"
  ON public.user_voice_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
