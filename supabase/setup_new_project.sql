-- ============================================================================
-- SHA-VERSE: Complete Fresh Supabase Bootstrap Script
-- Run this single file once in Supabase Dashboard → SQL Editor → New Query
-- Target Project: gkmyhgebjqkdvjzgbrhr
-- Safe & idempotent (safe to re-run without destroying existing data)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Enums & Shared Trigger Helper
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.page_role AS ENUM ('admin', 'editor', 'moderator', 'advertiser', 'analyst');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Profiles, Roles, Sessions & Login Attempts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  bio text,
  avatar_url text,
  cover_url text,
  location text,
  website text,
  work text,
  education text,
  hometown text,
  current_city text,
  facebook_url text,
  instagram_url text,
  twitter_url text,
  hobbies text[],
  about_me text,
  phone text,
  phone_number text,
  birthdate text,
  gender text,
  relationship_status text,
  privacy jsonb DEFAULT '{}'::jsonb,
  provider text DEFAULT 'email',
  is_verified boolean DEFAULT false,
  is_deactivated boolean NOT NULL DEFAULT false,
  deactivated_at timestamptz,
  last_login timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_is_deactivated ON public.profiles(is_deactivated) WHERE is_deactivated = true;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

REVOKE UPDATE (is_verified) ON public.profiles FROM authenticated, anon;

-- Safe public profile views
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  id, username, display_name, bio, avatar_url, cover_url,
  location, website, work, education, hometown, current_city,
  facebook_url, instagram_url, twitter_url, hobbies, about_me,
  is_verified, is_deactivated, created_at, updated_at, provider
FROM public.profiles;

CREATE OR REPLACE VIEW public.profiles_safe AS
SELECT
  id, username, display_name, bio, avatar_url, cover_url,
  is_verified, provider, created_at
FROM public.profiles;

CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id, username, display_name, bio, avatar_url, cover_url,
  is_verified, created_at
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO anon, authenticated;
GRANT SELECT ON public.profiles_safe TO anon, authenticated;
GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- User Roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
$$;

DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- Auto-create profile on auth.users signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _base_username text;
  _final_username text;
  _display_name text;
  _provider text;
BEGIN
  _provider := COALESCE(NEW.raw_app_meta_data ->> 'provider', 'email');
  _display_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'display_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'name'), ''),
    split_part(COALESCE(NEW.email, 'reader@sha-verse'), '@', 1),
    'Reader'
  );
  _base_username := regexp_replace(
    lower(COALESCE(
      NULLIF(trim(NEW.raw_user_meta_data ->> 'username'), ''),
      split_part(COALESCE(NEW.email, NEW.id::text), '@', 1)
    )),
    '[^a-z0-9_]',
    '',
    'g'
  );
  IF length(_base_username) < 3 THEN
    _base_username := 'user_' || left(replace(NEW.id::text, '-', ''), 8);
  END IF;

  _final_username := _base_username;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = _final_username AND id <> NEW.id) THEN
    _final_username := _base_username || '_' || left(replace(NEW.id::text, '-', ''), 5);
  END IF;

  INSERT INTO public.profiles (
    id, username, display_name, avatar_url, provider
  ) VALUES (
    NEW.id,
    _final_username,
    _display_name,
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture'),
    _provider
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF lower(COALESCE(NEW.email, '')) = 'shashaaiteam@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- User Sessions
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_token text UNIQUE,
  browser text,
  os text,
  device_info text,
  user_agent text,
  ip_address text,
  location text,
  is_current boolean DEFAULT true,
  last_active timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON public.user_sessions(session_token);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own sessions" ON public.user_sessions;
CREATE POLICY "Users manage own sessions"
  ON public.user_sessions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.upsert_current_session(
  p_session_token text,
  p_browser text DEFAULT NULL,
  p_os text DEFAULT NULL,
  p_device_info text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Ensure profile exists even if user predated trigger
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (_uid, 'user_' || left(replace(_uid::text, '-', ''), 8), 'Reader')
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.user_sessions
  SET is_current = false
  WHERE user_id = _uid AND session_token IS DISTINCT FROM p_session_token;

  INSERT INTO public.user_sessions (
    user_id, session_token, browser, os, device_info, user_agent, is_current, last_active
  ) VALUES (
    _uid, p_session_token, p_browser, p_os, p_device_info, p_user_agent, true, now()
  )
  ON CONFLICT (session_token) DO UPDATE SET
    last_active = now(),
    is_current = true,
    browser = COALESCE(EXCLUDED.browser, public.user_sessions.browser),
    os = COALESCE(EXCLUDED.os, public.user_sessions.os),
    device_info = COALESCE(EXCLUDED.device_info, public.user_sessions.device_info),
    user_agent = COALESCE(EXCLUDED.user_agent, public.user_sessions.user_agent)
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.profiles
  SET is_deactivated = true,
      deactivated_at = now()
  WHERE id = auth.uid();

  DELETE FROM public.user_sessions WHERE user_id = auth.uid();
END;
$$;

-- Login Attempts
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  attempt_type text NOT NULL,
  success boolean NOT NULL DEFAULT false,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON public.login_attempts(identifier, created_at DESC);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can record login attempts" ON public.login_attempts;
CREATE POLICY "Anyone can record login attempts"
  ON public.login_attempts FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view login attempts" ON public.login_attempts;
CREATE POLICY "Admins can view login attempts"
  ON public.login_attempts FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. Channels & Subscriptions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  username text UNIQUE,
  description text,
  category text,
  channel_type text NOT NULL DEFAULT 'books',
  avatar_url text,
  banner_url text,
  subscribers_count integer DEFAULT 0,
  approval_status text DEFAULT 'approved',
  approved_at timestamptz,
  approved_by uuid,
  rejection_reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channels_user_id ON public.channels(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_type ON public.channels(channel_type);

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Channels are viewable by everyone" ON public.channels;
CREATE POLICY "Channels are viewable by everyone"
  ON public.channels FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can create own channels" ON public.channels;
CREATE POLICY "Users can create own channels"
  ON public.channels FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own channels" ON public.channels;
CREATE POLICY "Users can update own channels"
  ON public.channels FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own channels" ON public.channels;
CREATE POLICY "Users can delete own channels"
  ON public.channels FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE UPDATE (subscribers_count) ON public.channels FROM authenticated, anon;

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  notification_level text DEFAULT 'all',
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_channel ON public.subscriptions(channel_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view subscriptions"
  ON public.subscriptions FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can manage own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can manage own subscriptions"
  ON public.subscriptions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 4. Books & Interactions (Likes, Saves, Ratings, Comments, Progress, Reports)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  title text NOT NULL,
  author text NOT NULL,
  description text,
  category text,
  language text DEFAULT 'English',
  tags text[],
  cover_url text,
  book_url text,
  pages integer,
  visibility text DEFAULT 'public',
  age_restriction text DEFAULT 'all',
  comments_enabled boolean DEFAULT true,
  ratings_enabled boolean DEFAULT true,
  file_hash text,
  views_count integer DEFAULT 0,
  unique_views_count integer NOT NULL DEFAULT 0,
  downloads_count integer DEFAULT 0,
  likes_count integer DEFAULT 0,
  comments_count integer DEFAULT 0,
  shares_count integer NOT NULL DEFAULT 0,
  saves_count integer NOT NULL DEFAULT 0,
  reading_sessions_count integer NOT NULL DEFAULT 0,
  total_reading_seconds bigint NOT NULL DEFAULT 0,
  pages_read_total bigint NOT NULL DEFAULT 0,
  rating_avg numeric DEFAULT 0,
  rating_count integer DEFAULT 0,
  last_activity_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_books_file_hash_unique ON public.books(file_hash) WHERE file_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_books_title_author_unique ON public.books(LOWER(title), LOWER(author));
CREATE INDEX IF NOT EXISTS idx_books_channel_id ON public.books(channel_id);
CREATE INDEX IF NOT EXISTS idx_books_created_at ON public.books(created_at DESC);

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Books visibility policy" ON public.books;
CREATE POLICY "Books visibility policy"
  ON public.books FOR SELECT
  USING (
    visibility = 'public'
    OR visibility IS NULL
    OR EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = books.channel_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Channel owners can insert books" ON public.books;
CREATE POLICY "Channel owners can insert books"
  ON public.books FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = books.channel_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Channel owners can update books" ON public.books;
CREATE POLICY "Channel owners can update books"
  ON public.books FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = books.channel_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = books.channel_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Channel owners can delete books" ON public.books;
CREATE POLICY "Channel owners can delete books"
  ON public.books FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = books.channel_id AND c.user_id = auth.uid()
    )
  );

REVOKE SELECT (file_hash) ON public.books FROM anon, authenticated;
REVOKE UPDATE (likes_count, comments_count, views_count, downloads_count, rating_avg, rating_count) ON public.books FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.check_book_duplicate(
  _file_hash text DEFAULT NULL,
  _title text DEFAULT NULL,
  _author text DEFAULT NULL
)
RETURNS TABLE (id uuid, title text, author text, match_type text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _file_hash IS NOT NULL AND trim(_file_hash) <> '' THEN
    RETURN QUERY
    SELECT b.id, b.title, b.author, 'file'::text AS match_type
    FROM public.books b
    WHERE b.file_hash = trim(_file_hash)
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF _title IS NOT NULL AND trim(_title) <> '' AND _author IS NOT NULL AND trim(_author) <> '' THEN
    RETURN QUERY
    SELECT b.id, b.title, b.author, 'metadata'::text AS match_type
    FROM public.books b
    WHERE lower(b.title) = lower(trim(_title))
      AND lower(b.author) = lower(trim(_author))
    LIMIT 1;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_book_duplicate(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_book_duplicate(text, text, text) TO authenticated;

-- Likes
CREATE TABLE IF NOT EXISTS public.likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
  post_id uuid,
  video_id uuid,
  comment_id uuid,
  group_post_id uuid,
  reaction_type text DEFAULT 'like',
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_user_book_unique ON public.likes(user_id, book_id) WHERE book_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_likes_book_id ON public.likes(book_id) WHERE book_id IS NOT NULL;

ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Likes are viewable by everyone" ON public.likes;
CREATE POLICY "Likes are viewable by everyone" ON public.likes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own likes" ON public.likes;
CREATE POLICY "Users can insert own likes" ON public.likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own likes" ON public.likes;
CREATE POLICY "Users can delete own likes" ON public.likes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Saved Books
CREATE TABLE IF NOT EXISTS public.saved_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_books_user ON public.saved_books(user_id);

ALTER TABLE public.saved_books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own saved books" ON public.saved_books;
CREATE POLICY "Users manage own saved books"
  ON public.saved_books FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Book Ratings
CREATE TABLE IF NOT EXISTS public.book_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (book_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_book_ratings_book ON public.book_ratings(book_id);

ALTER TABLE public.book_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Book ratings viewable by everyone" ON public.book_ratings;
CREATE POLICY "Book ratings viewable by everyone" ON public.book_ratings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users manage own book ratings" ON public.book_ratings;
CREATE POLICY "Users manage own book ratings"
  ON public.book_ratings FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.recalculate_book_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _book_id uuid := COALESCE(NEW.book_id, OLD.book_id);
BEGIN
  IF _book_id IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books
  SET
    rating_avg = COALESCE((SELECT AVG(rating)::numeric(3,2) FROM public.book_ratings WHERE book_id = _book_id), 0),
    rating_count = (SELECT COUNT(*) FROM public.book_ratings WHERE book_id = _book_id)
  WHERE id = _book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalculate_book_rating ON public.book_ratings;
CREATE TRIGGER trg_recalculate_book_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.book_ratings
  FOR EACH ROW EXECUTE FUNCTION public.recalculate_book_rating();

-- Book Comments & Comment Likes
CREATE TABLE IF NOT EXISTS public.book_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.book_comments(id) ON DELETE CASCADE,
  content text NOT NULL,
  likes_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_book_comments_book_id ON public.book_comments(book_id);
CREATE INDEX IF NOT EXISTS idx_book_comments_parent_id ON public.book_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_book_comments_created_at ON public.book_comments(created_at DESC);

ALTER TABLE public.book_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Book comments are viewable by everyone" ON public.book_comments;
CREATE POLICY "Book comments are viewable by everyone" ON public.book_comments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can create comments" ON public.book_comments;
CREATE POLICY "Authenticated users can create comments" ON public.book_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own comments" ON public.book_comments;
CREATE POLICY "Users can update own comments" ON public.book_comments FOR UPDATE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own comments" ON public.book_comments;
CREATE POLICY "Users can delete own comments" ON public.book_comments FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Channel owners can delete comments on their books" ON public.book_comments;
CREATE POLICY "Channel owners can delete comments on their books"
  ON public.book_comments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.books b
      JOIN public.channels c ON b.channel_id = c.id
      WHERE b.id = book_id AND c.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.comment_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.book_comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON public.comment_likes(comment_id);

ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comment likes are viewable by everyone" ON public.comment_likes;
CREATE POLICY "Comment likes are viewable by everyone" ON public.comment_likes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can like comments" ON public.comment_likes;
CREATE POLICY "Authenticated users can like comments" ON public.comment_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can unlike own likes" ON public.comment_likes;
CREATE POLICY "Users can unlike own likes" ON public.comment_likes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.comment_likes_count(p_comment_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN (SELECT COUNT(*)::int FROM public.comment_likes WHERE comment_id = p_comment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_book_comment_count(p_book_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books SET comments_count = COALESCE(comments_count, 0) + 1 WHERE id = p_book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_book_comment_count(p_book_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books SET comments_count = GREATEST(0, COALESCE(comments_count, 0) - 1) WHERE id = p_book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_comment_likes_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.book_comments SET likes_count = public.comment_likes_count(NEW.comment_id) WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.book_comments SET likes_count = public.comment_likes_count(OLD.comment_id) WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS update_comment_likes_trigger ON public.comment_likes;
CREATE TRIGGER update_comment_likes_trigger
  AFTER INSERT OR DELETE ON public.comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.update_comment_likes_count();

-- Book Reading Progress & Reader Bookmarks
CREATE TABLE IF NOT EXISTS public.book_reading_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  current_page integer DEFAULT 1,
  total_pages integer,
  completed boolean DEFAULT false,
  last_read_at timestamptz DEFAULT now(),
  UNIQUE (user_id, book_id)
);

ALTER TABLE public.book_reading_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own reading progress" ON public.book_reading_progress;
CREATE POLICY "Users manage own reading progress"
  ON public.book_reading_progress FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.reader_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  label text,
  color text,
  location jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reader_bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own bookmarks" ON public.reader_bookmarks;
CREATE POLICY "Users manage own bookmarks"
  ON public.reader_bookmarks FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Book Deletion Requests & Book Reports
CREATE TABLE IF NOT EXISTS public.book_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending',
  admin_notes text,
  scheduled_for timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.book_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own deletion requests" ON public.book_deletion_requests;
CREATE POLICY "Users manage own deletion requests"
  ON public.book_deletion_requests FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()))
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.book_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  description text,
  contact_email text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved', 'rejected')),
  admin_notes text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.book_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can create book reports" ON public.book_reports;
CREATE POLICY "Authenticated users can create book reports"
  ON public.book_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Users can view their own reports" ON public.book_reports;
CREATE POLICY "Users can view their own reports"
  ON public.book_reports FOR SELECT TO authenticated USING (auth.uid() = reporter_id OR public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_book_reports_updated_at ON public.book_reports;
CREATE TRIGGER trg_book_reports_updated_at
  BEFORE UPDATE ON public.book_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Legacy Book Counter Events & Simple View/Download RPCs
CREATE TABLE IF NOT EXISTS public.book_counter_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id, kind)
);

ALTER TABLE public.book_counter_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own counter events" ON public.book_counter_events;
CREATE POLICY "Users view own counter events"
  ON public.book_counter_events FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.increment_book_views(book_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _ins int;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.book_counter_events (user_id, book_id, kind)
  VALUES (_uid, book_id, 'view') ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _ins = ROW_COUNT;
  IF _ins > 0 THEN
    PERFORM set_config('app.book_metrics_trusted', 'on', true);
    UPDATE public.books SET views_count = COALESCE(views_count, 0) + 1 WHERE id = book_id;
    PERFORM set_config('app.book_metrics_trusted', 'off', true);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_book_downloads(book_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _ins int;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.book_counter_events (user_id, book_id, kind)
  VALUES (_uid, book_id, 'download') ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _ins = ROW_COUNT;
  IF _ins > 0 THEN
    PERFORM set_config('app.book_metrics_trusted', 'on', true);
    UPDATE public.books SET downloads_count = COALESCE(downloads_count, 0) + 1 WHERE id = book_id;
    PERFORM set_config('app.book_metrics_trusted', 'off', true);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_book_views(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.increment_book_downloads(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.increment_book_views(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_book_downloads(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Real-Time Book & Channel Analytics + Protection Triggers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_book_metrics()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.book_metrics_trusted', true) = 'on'
     OR current_setting('role', true) = 'service_role'
     OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.likes_count := OLD.likes_count;
  NEW.comments_count := OLD.comments_count;
  NEW.views_count := OLD.views_count;
  NEW.downloads_count := OLD.downloads_count;
  NEW.rating_avg := OLD.rating_avg;
  NEW.rating_count := OLD.rating_count;
  NEW.shares_count := OLD.shares_count;
  NEW.saves_count := OLD.saves_count;
  NEW.unique_views_count := OLD.unique_views_count;
  NEW.reading_sessions_count := OLD.reading_sessions_count;
  NEW.total_reading_seconds := OLD.total_reading_seconds;
  NEW.pages_read_total := OLD.pages_read_total;
  NEW.last_activity_at := OLD.last_activity_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_book_metrics ON public.books;
CREATE TRIGGER trg_protect_book_metrics
  BEFORE UPDATE ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.protect_book_metrics();

CREATE TABLE IF NOT EXISTS public.book_analytics (
  book_id uuid PRIMARY KEY REFERENCES public.books(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  total_views integer NOT NULL DEFAULT 0,
  unique_views integer NOT NULL DEFAULT 0,
  total_downloads integer NOT NULL DEFAULT 0,
  total_likes integer NOT NULL DEFAULT 0,
  total_comments integer NOT NULL DEFAULT 0,
  total_shares integer NOT NULL DEFAULT 0,
  total_bookmarks integer NOT NULL DEFAULT 0,
  total_reading_sessions integer NOT NULL DEFAULT 0,
  total_reading_seconds bigint NOT NULL DEFAULT 0,
  total_pages_read bigint NOT NULL DEFAULT 0,
  unique_readers integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.channel_analytics (
  channel_id uuid PRIMARY KEY REFERENCES public.channels(id) ON DELETE CASCADE,
  total_books integer NOT NULL DEFAULT 0,
  total_subscribers integer NOT NULL DEFAULT 0,
  total_views bigint NOT NULL DEFAULT 0,
  unique_views bigint NOT NULL DEFAULT 0,
  total_downloads bigint NOT NULL DEFAULT 0,
  total_likes bigint NOT NULL DEFAULT 0,
  total_comments bigint NOT NULL DEFAULT 0,
  total_shares bigint NOT NULL DEFAULT 0,
  total_bookmarks bigint NOT NULL DEFAULT 0,
  total_reading_sessions bigint NOT NULL DEFAULT 0,
  total_reading_seconds bigint NOT NULL DEFAULT 0,
  total_pages_read bigint NOT NULL DEFAULT 0,
  unique_readers integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.book_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id uuid,
  session_id text,
  event_type text NOT NULL CHECK (
    event_type IN ('view', 'download', 'like', 'unlike', 'comment', 'share', 'bookmark', 'unbookmark', 'reading_session')
  ),
  idempotency_key text,
  duration_seconds integer NOT NULL DEFAULT 0,
  pages_read integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_book_analytics_events_idempotency
  ON public.book_analytics_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_book_analytics_events_book_time ON public.book_analytics_events(book_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_book_analytics_events_channel_time ON public.book_analytics_events(channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.book_reading_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id uuid,
  session_key text NOT NULL,
  duration_seconds integer NOT NULL DEFAULT 0,
  pages_read integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, session_key)
);

CREATE TABLE IF NOT EXISTS public.channel_subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('subscribe', 'unsubscribe')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.book_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_reading_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_subscription_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "book_analytics_select_policy" ON public.book_analytics;
CREATE POLICY "book_analytics_select_policy" ON public.book_analytics FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.books b JOIN public.channels c ON c.id = b.channel_id WHERE b.id = book_analytics.book_id AND (b.visibility = 'public' OR c.user_id = auth.uid())));

DROP POLICY IF EXISTS "channel_analytics_select_policy" ON public.channel_analytics;
CREATE POLICY "channel_analytics_select_policy" ON public.channel_analytics FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.channels c WHERE c.id = channel_analytics.channel_id AND (c.channel_type = 'books' OR c.user_id = auth.uid())));

DROP POLICY IF EXISTS "book_analytics_events_owner_read" ON public.book_analytics_events;
CREATE POLICY "book_analytics_events_owner_read" ON public.book_analytics_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.channels c WHERE c.id = book_analytics_events.channel_id AND c.user_id = auth.uid()) OR book_analytics_events.user_id = auth.uid());

DROP POLICY IF EXISTS "book_reading_sessions_owner_read" ON public.book_reading_sessions;
CREATE POLICY "book_reading_sessions_owner_read" ON public.book_reading_sessions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.channels c WHERE c.id = book_reading_sessions.channel_id AND c.user_id = auth.uid()) OR book_reading_sessions.user_id = auth.uid());

DROP POLICY IF EXISTS "channel_subscription_events_owner_read" ON public.channel_subscription_events;
CREATE POLICY "channel_subscription_events_owner_read" ON public.channel_subscription_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.channels c WHERE c.id = channel_subscription_events.channel_id AND c.user_id = auth.uid()) OR channel_subscription_events.user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.refresh_channel_analytics(p_channel_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _seed_url constant text := 'https://www.gutenberg.org/files/1342/1342-h/1342-h.htm';
  _subs integer := 0;
  _unique_readers integer := 0;
  _unique_views integer := 0;
BEGIN
  IF p_channel_id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(c.subscribers_count, 0) INTO _subs FROM public.channels c WHERE c.id = p_channel_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(DISTINCT COALESCE(rs.user_id::text, rs.session_key)) INTO _unique_readers
  FROM public.book_reading_sessions rs JOIN public.books b ON b.id = rs.book_id
  WHERE rs.channel_id = p_channel_id AND (b.book_url IS NULL OR b.book_url <> _seed_url);

  SELECT COUNT(DISTINCT COALESCE(ev.user_id::text, ev.session_id)) INTO _unique_views
  FROM public.book_analytics_events ev JOIN public.books b ON b.id = ev.book_id
  WHERE ev.channel_id = p_channel_id AND ev.event_type = 'view' AND (b.book_url IS NULL OR b.book_url <> _seed_url);

  INSERT INTO public.channel_analytics (
    channel_id, total_books, total_subscribers, total_views, unique_views,
    total_downloads, total_likes, total_comments, total_shares, total_bookmarks,
    total_reading_sessions, total_reading_seconds, total_pages_read, unique_readers, last_activity_at, updated_at
  )
  SELECT
    p_channel_id, COUNT(*)::integer, _subs,
    COALESCE(SUM(COALESCE(b.views_count, 0)), 0)::bigint,
    GREATEST(_unique_views, COALESCE(MAX(b.unique_views_count), 0))::bigint,
    COALESCE(SUM(COALESCE(b.downloads_count, 0)), 0)::bigint,
    COALESCE(SUM(COALESCE(b.likes_count, 0)), 0)::bigint,
    COALESCE(SUM(COALESCE(b.comments_count, 0)), 0)::bigint,
    COALESCE(SUM(COALESCE(b.shares_count, 0)), 0)::bigint,
    COALESCE(SUM(COALESCE(b.saves_count, 0)), 0)::bigint,
    COALESCE(SUM(COALESCE(b.reading_sessions_count, 0)), 0)::bigint,
    COALESCE(SUM(COALESCE(b.total_reading_seconds, 0)), 0)::bigint,
    COALESCE(SUM(COALESCE(b.pages_read_total, 0)), 0)::bigint,
    _unique_readers,
    MAX(COALESCE(b.last_activity_at, b.created_at)), now()
  FROM public.books b
  WHERE b.channel_id = p_channel_id AND (b.book_url IS NULL OR b.book_url <> _seed_url)
  ON CONFLICT (channel_id) DO UPDATE SET
    total_books = EXCLUDED.total_books, total_subscribers = EXCLUDED.total_subscribers,
    total_views = EXCLUDED.total_views, unique_views = EXCLUDED.unique_views,
    total_downloads = EXCLUDED.total_downloads, total_likes = EXCLUDED.total_likes,
    total_comments = EXCLUDED.total_comments, total_shares = EXCLUDED.total_shares,
    total_bookmarks = EXCLUDED.total_bookmarks, total_reading_sessions = EXCLUDED.total_reading_sessions,
    total_reading_seconds = EXCLUDED.total_reading_seconds, total_pages_read = EXCLUDED.total_pages_read,
    unique_readers = EXCLUDED.unique_readers, last_activity_at = EXCLUDED.last_activity_at, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_book_analytics_row(p_book_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b record;
BEGIN
  SELECT * INTO _b FROM public.books WHERE id = p_book_id;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.book_analytics (
    book_id, channel_id, total_views, unique_views, total_downloads, total_likes,
    total_comments, total_shares, total_bookmarks, total_reading_sessions,
    total_reading_seconds, total_pages_read, unique_readers, last_activity_at, updated_at
  ) VALUES (
    _b.id, _b.channel_id, COALESCE(_b.views_count, 0), COALESCE(_b.unique_views_count, 0),
    COALESCE(_b.downloads_count, 0), COALESCE(_b.likes_count, 0), COALESCE(_b.comments_count, 0),
    COALESCE(_b.shares_count, 0), COALESCE(_b.saves_count, 0), COALESCE(_b.reading_sessions_count, 0),
    COALESCE(_b.total_reading_seconds, 0), COALESCE(_b.pages_read_total, 0),
    (SELECT COUNT(DISTINCT COALESCE(user_id::text, session_key)) FROM public.book_reading_sessions WHERE book_id = _b.id),
    COALESCE(_b.last_activity_at, _b.created_at), now()
  )
  ON CONFLICT (book_id) DO UPDATE SET
    channel_id = EXCLUDED.channel_id, total_views = EXCLUDED.total_views, unique_views = EXCLUDED.unique_views,
    total_downloads = EXCLUDED.total_downloads, total_likes = EXCLUDED.total_likes,
    total_comments = EXCLUDED.total_comments, total_shares = EXCLUDED.total_shares,
    total_bookmarks = EXCLUDED.total_bookmarks, total_reading_sessions = EXCLUDED.total_reading_sessions,
    total_reading_seconds = EXCLUDED.total_reading_seconds, total_pages_read = EXCLUDED.total_pages_read,
    unique_readers = EXCLUDED.unique_readers, last_activity_at = EXCLUDED.last_activity_at, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.record_book_view_v2(p_book_id uuid, p_session_key text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _book record; _actor text; _recent boolean := false; _unique_views integer;
BEGIN
  SELECT b.id, b.channel_id, b.visibility, c.user_id AS owner_id INTO _book
  FROM public.books b JOIN public.channels c ON c.id = b.channel_id WHERE b.id = p_book_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF _book.visibility = 'private' AND _book.owner_id IS DISTINCT FROM _uid THEN RETURN false; END IF;
  _actor := COALESCE(_uid::text, NULLIF(trim(p_session_key), ''));
  IF _actor IS NULL THEN RETURN false; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.book_analytics_events e
    WHERE e.book_id = p_book_id AND e.event_type = 'view'
      AND COALESCE(e.user_id::text, e.session_id) = _actor
      AND e.created_at > now() - interval '30 minutes'
  ) INTO _recent;
  IF _recent THEN RETURN false; END IF;

  INSERT INTO public.book_analytics_events (book_id, channel_id, user_id, session_id, event_type)
  VALUES (p_book_id, _book.channel_id, _uid, COALESCE(NULLIF(trim(p_session_key), ''), _uid::text), 'view');

  SELECT COUNT(DISTINCT COALESCE(user_id::text, session_id)) INTO _unique_views
  FROM public.book_analytics_events WHERE book_id = p_book_id AND event_type = 'view';

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books SET
    views_count = COALESCE(views_count, 0) + 1,
    unique_views_count = GREATEST(COALESCE(unique_views_count, 0), _unique_views),
    last_activity_at = now()
  WHERE id = p_book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(p_book_id);
  PERFORM public.refresh_channel_analytics(_book.channel_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_book_download(p_book_id uuid, p_idempotency_key text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _book record; _ins integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT b.id, b.channel_id, b.visibility, c.user_id AS owner_id INTO _book
  FROM public.books b JOIN public.channels c ON c.id = b.channel_id WHERE b.id = p_book_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF _book.visibility = 'private' AND _book.owner_id IS DISTINCT FROM _uid THEN RAISE EXCEPTION 'Not authorized'; END IF;

  INSERT INTO public.book_analytics_events (book_id, channel_id, user_id, event_type, idempotency_key)
  VALUES (p_book_id, _book.channel_id, _uid, 'download', NULLIF(trim(p_idempotency_key), ''))
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS _ins = ROW_COUNT;
  IF _ins = 0 THEN RETURN false; END IF;

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books SET downloads_count = COALESCE(downloads_count, 0) + 1, last_activity_at = now() WHERE id = p_book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);
  PERFORM public.refresh_book_analytics_row(p_book_id);
  PERFORM public.refresh_channel_analytics(_book.channel_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_book_share(p_book_id uuid, p_platform text DEFAULT 'link', p_idempotency_key text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _book record; _ins integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT b.id, b.channel_id, b.visibility, c.user_id AS owner_id INTO _book
  FROM public.books b JOIN public.channels c ON c.id = b.channel_id WHERE b.id = p_book_id;
  IF NOT FOUND OR _book.visibility = 'private' THEN RETURN false; END IF;

  INSERT INTO public.book_analytics_events (book_id, channel_id, user_id, event_type, idempotency_key, metadata)
  VALUES (p_book_id, _book.channel_id, _uid, 'share', NULLIF(trim(p_idempotency_key), ''), jsonb_build_object('platform', COALESCE(NULLIF(trim(p_platform), ''), 'link')))
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS _ins = ROW_COUNT;
  IF _ins = 0 THEN RETURN false; END IF;

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books SET shares_count = COALESCE(shares_count, 0) + 1, last_activity_at = now() WHERE id = p_book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);
  PERFORM public.refresh_book_analytics_row(p_book_id);
  PERFORM public.refresh_channel_analytics(_book.channel_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_reading_session_heartbeat(p_book_id uuid, p_session_key text, p_delta_seconds integer, p_pages_read integer DEFAULT 0)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _book record;
  _delta integer := LEAST(GREATEST(COALESCE(p_delta_seconds, 0), 0), 300);
  _pages integer := LEAST(GREATEST(COALESCE(p_pages_read, 0), 0), 500);
  _is_new_session boolean := false;
  _sess_count integer; _tot_secs bigint; _tot_pages bigint;
BEGIN
  IF _uid IS NULL OR p_session_key IS NULL OR trim(p_session_key) = '' THEN RETURN false; END IF;
  SELECT b.id, b.channel_id, b.visibility, c.user_id AS owner_id INTO _book
  FROM public.books b JOIN public.channels c ON c.id = b.channel_id WHERE b.id = p_book_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF _book.visibility = 'private' AND _book.owner_id IS DISTINCT FROM _uid THEN RETURN false; END IF;

  SELECT NOT EXISTS (SELECT 1 FROM public.book_reading_sessions WHERE book_id = p_book_id AND session_key = p_session_key) INTO _is_new_session;

  INSERT INTO public.book_reading_sessions (book_id, channel_id, user_id, session_key, duration_seconds, pages_read)
  VALUES (p_book_id, _book.channel_id, _uid, p_session_key, _delta, _pages)
  ON CONFLICT (book_id, session_key) DO UPDATE SET
    duration_seconds = public.book_reading_sessions.duration_seconds + EXCLUDED.duration_seconds,
    pages_read = GREATEST(public.book_reading_sessions.pages_read, EXCLUDED.pages_read),
    last_heartbeat_at = now();

  IF _is_new_session THEN
    INSERT INTO public.book_analytics_events (book_id, channel_id, user_id, session_id, event_type, duration_seconds, pages_read)
    VALUES (p_book_id, _book.channel_id, _uid, p_session_key, 'reading_session', _delta, _pages);
  END IF;

  SELECT COUNT(*)::integer, COALESCE(SUM(duration_seconds), 0)::bigint, COALESCE(SUM(pages_read), 0)::bigint
  INTO _sess_count, _tot_secs, _tot_pages
  FROM public.book_reading_sessions WHERE book_id = p_book_id;

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books SET reading_sessions_count = _sess_count, total_reading_seconds = _tot_secs, pages_read_total = _tot_pages, last_activity_at = now()
  WHERE id = p_book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(p_book_id);
  PERFORM public.refresh_channel_analytics(_book.channel_id);
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_book_view_v2(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_book_download(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_book_share(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_reading_session_heartbeat(uuid, text, integer, integer) TO authenticated;

-- Sync Triggers
CREATE OR REPLACE FUNCTION public.sync_book_likes_and_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _book_id uuid := COALESCE(NEW.book_id, OLD.book_id); _channel_id uuid;
BEGIN
  IF _book_id IS NULL THEN RETURN NULL; END IF;
  SELECT channel_id INTO _channel_id FROM public.books WHERE id = _book_id;
  IF _channel_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.book_analytics_events (book_id, channel_id, user_id, event_type)
  VALUES (_book_id, _channel_id, COALESCE(NEW.user_id, OLD.user_id), CASE WHEN TG_OP = 'DELETE' THEN 'unlike' ELSE 'like' END);

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books SET likes_count = (SELECT COUNT(*) FROM public.likes WHERE book_id = _book_id), last_activity_at = now() WHERE id = _book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(_book_id);
  PERFORM public.refresh_channel_analytics(_channel_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_book_likes_analytics ON public.likes;
CREATE TRIGGER trg_book_likes_analytics
  AFTER INSERT OR DELETE ON public.likes
  FOR EACH ROW WHEN (pg_trigger_depth() < 2)
  EXECUTE FUNCTION public.sync_book_likes_and_events();

CREATE OR REPLACE FUNCTION public.sync_book_comments_and_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _book_id uuid := COALESCE(NEW.book_id, OLD.book_id); _channel_id uuid;
BEGIN
  IF _book_id IS NULL THEN RETURN NULL; END IF;
  SELECT channel_id INTO _channel_id FROM public.books WHERE id = _book_id;
  IF _channel_id IS NULL THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.book_analytics_events (book_id, channel_id, user_id, event_type)
    VALUES (_book_id, _channel_id, NEW.user_id, 'comment');
  END IF;

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books SET comments_count = (SELECT COUNT(*) FROM public.book_comments WHERE book_id = _book_id), last_activity_at = now() WHERE id = _book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(_book_id);
  PERFORM public.refresh_channel_analytics(_channel_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_book_comments_analytics ON public.book_comments;
CREATE TRIGGER trg_book_comments_analytics
  AFTER INSERT OR DELETE ON public.book_comments
  FOR EACH ROW EXECUTE FUNCTION public.sync_book_comments_and_events();

CREATE OR REPLACE FUNCTION public.sync_saved_book_analytics()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _book_id uuid := COALESCE(NEW.book_id, OLD.book_id); _channel_id uuid;
BEGIN
  IF _book_id IS NULL THEN RETURN NULL; END IF;
  SELECT channel_id INTO _channel_id FROM public.books WHERE id = _book_id;
  IF _channel_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.book_analytics_events (book_id, channel_id, user_id, event_type)
  VALUES (_book_id, _channel_id, COALESCE(NEW.user_id, OLD.user_id), CASE WHEN TG_OP = 'DELETE' THEN 'unbookmark' ELSE 'bookmark' END);

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books SET saves_count = (SELECT COUNT(*) FROM public.saved_books WHERE book_id = _book_id), last_activity_at = now() WHERE id = _book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(_book_id);
  PERFORM public.refresh_channel_analytics(_channel_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_saved_books_analytics ON public.saved_books;
CREATE TRIGGER trg_saved_books_analytics
  AFTER INSERT OR DELETE ON public.saved_books
  FOR EACH ROW EXECUTE FUNCTION public.sync_saved_book_analytics();

CREATE OR REPLACE FUNCTION public.sync_channel_on_book_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 2 THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_channel_analytics(OLD.channel_id);
    RETURN NULL;
  END IF;
  PERFORM public.refresh_book_analytics_row(NEW.id);
  PERFORM public.refresh_channel_analytics(NEW.channel_id);
  IF TG_OP = 'UPDATE' AND OLD.channel_id IS DISTINCT FROM NEW.channel_id THEN
    PERFORM public.refresh_channel_analytics(OLD.channel_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_books_channel_analytics ON public.books;
CREATE TRIGGER trg_books_channel_analytics
  AFTER INSERT OR UPDATE OF channel_id, visibility, views_count, downloads_count, likes_count, comments_count, shares_count, saves_count, reading_sessions_count, total_reading_seconds
  OR DELETE ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.sync_channel_on_book_change();

CREATE OR REPLACE FUNCTION public.subscribe_to_channel(target_channel_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ins integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.subscriptions (user_id, channel_id) VALUES (auth.uid(), target_channel_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _ins = ROW_COUNT;
  IF _ins > 0 THEN
    INSERT INTO public.channel_subscription_events (channel_id, user_id, event_type) VALUES (target_channel_id, auth.uid(), 'subscribe');
  END IF;
  UPDATE public.channels SET subscribers_count = (SELECT COUNT(*) FROM public.subscriptions WHERE channel_id = target_channel_id) WHERE id = target_channel_id;
  PERFORM public.refresh_channel_analytics(target_channel_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.unsubscribe_from_channel(target_channel_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _del integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.subscriptions WHERE user_id = auth.uid() AND channel_id = target_channel_id;
  GET DIAGNOSTICS _del = ROW_COUNT;
  IF _del > 0 THEN
    INSERT INTO public.channel_subscription_events (channel_id, user_id, event_type) VALUES (target_channel_id, auth.uid(), 'unsubscribe');
  END IF;
  UPDATE public.channels SET subscribers_count = (SELECT COUNT(*) FROM public.subscriptions WHERE channel_id = target_channel_id) WHERE id = target_channel_id;
  PERFORM public.refresh_channel_analytics(target_channel_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. AI Translation & Audiobook Tables
-- ----------------------------------------------------------------------------
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id, target_language, translation_quality)
);

ALTER TABLE public.book_translations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own book translations" ON public.book_translations;
CREATE POLICY "Users manage own book translations" ON public.book_translations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.translated_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  translation_id uuid NOT NULL REFERENCES public.book_translations(id) ON DELETE CASCADE,
  original_chapter_id text NOT NULL,
  chapter_order integer NOT NULL DEFAULT 0,
  content_hash text NOT NULL,
  translated_content jsonb NOT NULL,
  translation_status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (translation_id, original_chapter_id, content_hash)
);

ALTER TABLE public.translated_chapters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own translated chapters" ON public.translated_chapters;
CREATE POLICY "Users manage own translated chapters" ON public.translated_chapters FOR ALL
  USING (EXISTS (SELECT 1 FROM public.book_translations bt WHERE bt.id = translation_id AND bt.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.book_translations bt WHERE bt.id = translation_id AND bt.user_id = auth.uid()));

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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audiobook_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own audiobook jobs" ON public.audiobook_jobs;
CREATE POLICY "Users manage own audiobook jobs" ON public.audiobook_jobs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

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
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id, chapter_id, paragraph_id, sentence_index, language, voice_id, content_hash)
);

ALTER TABLE public.audiobook_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own audiobook segments" ON public.audiobook_segments;
CREATE POLICY "Users manage own audiobook segments" ON public.audiobook_segments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

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
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, book_id)
);

ALTER TABLE public.listening_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own listening progress" ON public.listening_progress;
CREATE POLICY "Users manage own listening progress" ON public.listening_progress FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

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
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_voice_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own voice preferences" ON public.user_voice_preferences;
CREATE POLICY "Users manage own voice preferences" ON public.user_voice_preferences FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 7. Ads & App Promotions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ad_impressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  video_id uuid,
  ad_unit_id text,
  ad_category text,
  placement text,
  revenue numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ad_impressions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own ad impressions" ON public.ad_impressions;
CREATE POLICY "Users can view their own ad impressions" ON public.ad_impressions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create their own ad impressions" ON public.ad_impressions;
CREATE POLICY "Users can create their own ad impressions" ON public.ad_impressions FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE TABLE IF NOT EXISTS public.user_ad_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  hidden_ad_id text,
  blocked_category text,
  blocked_until timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ad_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own ad preferences" ON public.user_ad_preferences;
CREATE POLICY "Users manage own ad preferences" ON public.user_ad_preferences FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.rewarded_ad_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reward_type text NOT NULL,
  reward_value integer NOT NULL DEFAULT 0,
  resource_id uuid,
  expires_at timestamptz,
  consumed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rewarded_ad_unlocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own rewards" ON public.rewarded_ad_unlocks;
CREATE POLICY "Users can view their own rewards" ON public.rewarded_ad_unlocks FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.grant_rewarded_ad_unlock(
  _reward_type text,
  _reward_value integer DEFAULT NULL,
  _resource_id uuid DEFAULT NULL,
  _expires_minutes integer DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _new_id uuid; _recent_count int; _value int; _minutes int; _expires timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  CASE _reward_type
    WHEN 'novachat_messages' THEN _value := 5; _minutes := NULL;
    WHEN 'bookshelf_premium' THEN _value := 1; _minutes := 60;
    WHEN 'movion_ad_free'    THEN _value := 1; _minutes := 30;
    WHEN 'group_boost'       THEN _value := 1; _minutes := 1440;
    ELSE RAISE EXCEPTION 'Invalid reward type';
  END CASE;

  SELECT count(*) INTO _recent_count FROM public.rewarded_ad_unlocks WHERE user_id = _uid AND created_at > now() - interval '1 hour';
  IF _recent_count >= 10 THEN RAISE EXCEPTION 'Rate limit exceeded'; END IF;
  IF _minutes IS NOT NULL THEN _expires := now() + make_interval(mins => _minutes); END IF;

  INSERT INTO public.rewarded_ad_unlocks (user_id, reward_type, reward_value, resource_id, expires_at)
  VALUES (_uid, _reward_type, _value, _resource_id, _expires)
  RETURNING id INTO _new_id;
  RETURN _new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_rewarded_ad_unlock(text, integer, uuid, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.grant_rewarded_ad_unlock(text, integer, uuid, integer) TO authenticated;

CREATE TABLE IF NOT EXISTS public.app_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  media_url text NOT NULL DEFAULT '',
  media_type text NOT NULL DEFAULT 'image',
  text_content text,
  background_color text,
  caption text,
  link_url text,
  views_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

ALTER TABLE public.app_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active app promotions" ON public.app_promotions;
CREATE POLICY "Anyone can view active app promotions" ON public.app_promotions FOR SELECT USING (true);

DROP POLICY IF EXISTS "App owner can insert app promotions" ON public.app_promotions;
CREATE POLICY "App owner can insert app promotions" ON public.app_promotions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id AND (public.is_admin(auth.uid()) OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'shashaaiteam@gmail.com'));

DROP POLICY IF EXISTS "App owner can delete app promotions" ON public.app_promotions;
CREATE POLICY "App owner can delete app promotions" ON public.app_promotions FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'shashaaiteam@gmail.com');

CREATE TABLE IF NOT EXISTS public.app_promotion_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES public.app_promotions(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, viewer_id)
);

ALTER TABLE public.app_promotion_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own promo views" ON public.app_promotion_views;
CREATE POLICY "Users manage own promo views" ON public.app_promotion_views FOR ALL USING (auth.uid() = viewer_id) WITH CHECK (auth.uid() = viewer_id);

-- Account Deletion RPC
CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    raise exception 'Not authorized to delete this account';
  END IF;
  UPDATE public.book_deletion_requests SET reviewed_by = null WHERE reviewed_by = p_user_id;
  UPDATE public.book_reports SET reviewed_by = null WHERE reviewed_by = p_user_id;
  UPDATE public.channels SET approved_by = null WHERE approved_by = p_user_id;
  DELETE FROM public.profiles WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_account(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. Storage Buckets (books & avatars)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('books', 'books', true),
  ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read books storage" ON storage.objects;
CREATE POLICY "Public read books storage" ON storage.objects FOR SELECT USING (bucket_id IN ('books', 'avatars'));

DROP POLICY IF EXISTS "Auth upload books and avatars" ON storage.objects;
CREATE POLICY "Auth upload books and avatars" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('books', 'avatars'));

DROP POLICY IF EXISTS "Auth update own storage objects" ON storage.objects;
CREATE POLICY "Auth update own storage objects" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('books', 'avatars') AND (owner = auth.uid() OR (storage.foldername(name))[1] = auth.uid()::text));

DROP POLICY IF EXISTS "Auth delete own storage objects" ON storage.objects;
CREATE POLICY "Auth delete own storage objects" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('books', 'avatars') AND (owner = auth.uid() OR (storage.foldername(name))[1] = auth.uid()::text));

-- ----------------------------------------------------------------------------
-- 9. Realtime Replication
-- ----------------------------------------------------------------------------
ALTER TABLE public.books REPLICA IDENTITY FULL;
ALTER TABLE public.channels REPLICA IDENTITY FULL;
ALTER TABLE public.book_comments REPLICA IDENTITY FULL;
ALTER TABLE public.book_ratings REPLICA IDENTITY FULL;
ALTER TABLE public.book_analytics REPLICA IDENTITY FULL;
ALTER TABLE public.channel_analytics REPLICA IDENTITY FULL;
ALTER TABLE public.book_analytics_events REPLICA IDENTITY FULL;
ALTER TABLE public.channel_subscription_events REPLICA IDENTITY FULL;
ALTER TABLE public.user_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.app_promotions REPLICA IDENTITY FULL;
ALTER TABLE public.book_reports REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.books; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.channels; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.likes; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.book_comments; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.book_ratings; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.book_analytics; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_analytics; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.book_analytics_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_subscription_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_sessions; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.app_promotions; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.book_reports; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 10. Library Workspace: Shelves, Goals, Notes, Loans, Notifications, Admin
-- ----------------------------------------------------------------------------
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS subtitle text,
  ADD COLUMN IF NOT EXISTS isbn text,
  ADD COLUMN IF NOT EXISTS publisher text,
  ADD COLUMN IF NOT EXISTS publication_date text,
  ADD COLUMN IF NOT EXISTS edition text,
  ADD COLUMN IF NOT EXISTS book_format text NOT NULL DEFAULT 'ebook',
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_books_is_archived ON public.books(is_archived) WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_books_isbn ON public.books(isbn) WHERE isbn IS NOT NULL;

ALTER TABLE public.book_reading_progress
  ADD COLUMN IF NOT EXISTS reading_status text NOT NULL DEFAULT 'currently_reading'
    CHECK (reading_status IN ('want_to_read', 'currently_reading', 'completed', 'on_hold', 'abandoned')),
  ADD COLUMN IF NOT EXISTS reading_seconds bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS personal_rating integer
    CHECK (personal_rating IS NULL OR (personal_rating >= 1 AND personal_rating <= 5)),
  ADD COLUMN IF NOT EXISTS started_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_reading_progress_user_status
  ON public.book_reading_progress(user_id, reading_status, last_read_at DESC);

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = _user_id
        AND lower(COALESCE(u.email, '')) = 'shashaaiteam@gmail.com'
    )
$$;

CREATE TABLE IF NOT EXISTS public.shelves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT '#3b82f6',
  cover_url text,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  is_default boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shelves_user_name_unique ON public.shelves(user_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_shelves_user_id ON public.shelves(user_id);
ALTER TABLE public.shelves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own or public shelves" ON public.shelves;
CREATE POLICY "Users read own or public shelves" ON public.shelves FOR SELECT USING (auth.uid() = user_id OR visibility = 'public');
DROP POLICY IF EXISTS "Users insert own shelves" ON public.shelves;
CREATE POLICY "Users insert own shelves" ON public.shelves FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own shelves" ON public.shelves;
CREATE POLICY "Users update own shelves" ON public.shelves FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own shelves" ON public.shelves;
CREATE POLICY "Users delete own shelves" ON public.shelves FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_shelves_updated_at ON public.shelves;
CREATE TRIGGER trg_shelves_updated_at BEFORE UPDATE ON public.shelves FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.shelf_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shelf_id uuid NOT NULL REFERENCES public.shelves(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shelf_id, book_id)
);
CREATE INDEX IF NOT EXISTS idx_shelf_books_shelf ON public.shelf_books(shelf_id, position);
CREATE INDEX IF NOT EXISTS idx_shelf_books_user ON public.shelf_books(user_id, book_id);
ALTER TABLE public.shelf_books ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own or public shelf_books" ON public.shelf_books;
CREATE POLICY "Users view own or public shelf_books" ON public.shelf_books FOR SELECT
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.shelves s WHERE s.id = shelf_books.shelf_id AND s.visibility = 'public'));
DROP POLICY IF EXISTS "Users manage own shelf_books" ON public.shelf_books;
CREATE POLICY "Users manage own shelf_books" ON public.shelf_books FOR ALL TO authenticated
  USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.shelves s WHERE s.id = shelf_books.shelf_id AND s.user_id = auth.uid()))
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.shelves s WHERE s.id = shelf_books.shelf_id AND s.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.reading_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  goal_type text NOT NULL CHECK (goal_type IN ('books', 'pages', 'minutes')),
  period text NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly', 'yearly', 'custom')),
  target_value integer NOT NULL CHECK (target_value > 0),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days')::date,
  is_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reading_goals_user ON public.reading_goals(user_id, end_date DESC);
ALTER TABLE public.reading_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own reading_goals" ON public.reading_goals;
CREATE POLICY "Users manage own reading_goals" ON public.reading_goals FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_reading_goals_updated_at ON public.reading_goals;
CREATE TRIGGER trg_reading_goals_updated_at BEFORE UPDATE ON public.reading_goals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.book_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  note_type text NOT NULL DEFAULT 'note' CHECK (note_type IN ('note', 'highlight')),
  title text,
  content text NOT NULL,
  page_number integer,
  chapter text,
  highlight_color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_book_notes_user_book ON public.book_notes(user_id, book_id, created_at DESC);
ALTER TABLE public.book_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users strictly manage own notes" ON public.book_notes;
CREATE POLICY "Users strictly manage own notes" ON public.book_notes FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_book_notes_updated_at ON public.book_notes;
CREATE TRIGGER trg_book_notes_updated_at BEFORE UPDATE ON public.book_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.book_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id uuid REFERENCES public.books(id) ON DELETE SET NULL,
  book_title text NOT NULL,
  author_name text,
  loan_type text NOT NULL CHECK (loan_type IN ('borrowed', 'lent')),
  counterparty_name text NOT NULL,
  counterparty_contact text,
  loan_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_return_date date,
  actual_return_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'overdue')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_book_loans_user ON public.book_loans(user_id, status, expected_return_date);
ALTER TABLE public.book_loans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own book_loans" ON public.book_loans;
CREATE POLICY "Users manage own book_loans" ON public.book_loans FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_book_loans_updated_at ON public.book_loans;
CREATE TRIGGER trg_book_loans_updated_at BEFORE UPDATE ON public.book_loans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  category text NOT NULL DEFAULT 'system' CHECK (category IN ('goal', 'loan', 'reading', 'account', 'system')),
  is_read boolean NOT NULL DEFAULT false,
  action_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own notifications" ON public.notifications;
CREATE POLICY "Users manage own notifications" ON public.notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users insert own audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users insert own audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = actor_id);
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update book reports" ON public.book_reports;
CREATE POLICY "Admins can update book reports" ON public.book_reports FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_get_platform_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _result jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN RAISE EXCEPTION 'forbidden: admin access required'; END IF;
  SELECT jsonb_build_object(
    'total_users', (SELECT COUNT(*) FROM public.profiles),
    'total_books', (SELECT COUNT(*) FROM public.books),
    'total_channels', (SELECT COUNT(*) FROM public.channels WHERE channel_type = 'books'),
    'total_shelves', (SELECT COUNT(*) FROM public.shelves),
    'total_reading_sessions', (SELECT COUNT(*) FROM public.book_reading_sessions),
    'pending_reports', (SELECT COUNT(*) FROM public.book_reports WHERE status IN ('pending', 'reviewing')),
    'active_sessions', (SELECT COUNT(*) FROM public.user_sessions)
  ) INTO _result;
  RETURN _result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_get_platform_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_platform_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_users_with_roles()
RETURNS TABLE (user_id uuid, username text, display_name text, avatar_url text, provider text, is_deactivated boolean, created_at timestamptz, roles text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN RAISE EXCEPTION 'forbidden: admin access required'; END IF;
  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_url, p.provider, p.is_deactivated, p.created_at,
    COALESCE(ARRAY(SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id = p.id), ARRAY['user']::text[])
  FROM public.profiles p ORDER BY p.created_at DESC LIMIT 100;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_users_with_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users_with_roles() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_target_user_id uuid, p_role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN RAISE EXCEPTION 'forbidden: admin access required'; END IF;
  DELETE FROM public.user_roles WHERE user_id = p_target_user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_target_user_id, p_role) ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'set_user_role', 'user', p_target_user_id::text, jsonb_build_object('role', p_role::text));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.app_role) TO authenticated;

ALTER TABLE public.shelves REPLICA IDENTITY FULL;
ALTER TABLE public.shelf_books REPLICA IDENTITY FULL;
ALTER TABLE public.reading_goals REPLICA IDENTITY FULL;
ALTER TABLE public.book_notes REPLICA IDENTITY FULL;
ALTER TABLE public.book_loans REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shelves; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shelf_books; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.reading_goals; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.book_notes; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.book_loans; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

