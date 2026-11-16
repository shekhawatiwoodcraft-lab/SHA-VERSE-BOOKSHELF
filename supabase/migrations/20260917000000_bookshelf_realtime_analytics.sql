-- ============================================================================
-- SHA-VERSE BOOKSHELF: Real-Time Book & Channel Analytics System
-- Production-grade normalized schema, atomic RPCs, triggers, RLS, & Realtime
-- ============================================================================

-- 1. Extend public.books with non-destructive analytics aggregate columns
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS shares_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saves_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unique_views_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reading_sessions_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_reading_seconds bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pages_read_total bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- 2. Harden protect_book_metrics() so clients can never directly mutate counters
CREATE OR REPLACE FUNCTION public.protect_book_metrics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
END; $function$;

-- 3. Normalized analytics tables
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

CREATE INDEX IF NOT EXISTS idx_book_analytics_channel_id
  ON public.book_analytics (channel_id);

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
    event_type IN (
      'view',
      'download',
      'like',
      'unlike',
      'comment',
      'share',
      'bookmark',
      'unbookmark',
      'reading_session'
    )
  ),
  idempotency_key text,
  duration_seconds integer NOT NULL DEFAULT 0,
  pages_read integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_book_analytics_events_idempotency
  ON public.book_analytics_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_book_analytics_events_book_time
  ON public.book_analytics_events (book_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_book_analytics_events_channel_time
  ON public.book_analytics_events (channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_book_analytics_events_type_time
  ON public.book_analytics_events (event_type, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_book_reading_sessions_channel
  ON public.book_reading_sessions (channel_id, last_heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS public.channel_subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('subscribe', 'unsubscribe')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_sub_events_channel_time
  ON public.channel_subscription_events (channel_id, created_at DESC);

-- 4. Row-Level Security (Strict owner & visibility enforcement; no direct counter tampering)
ALTER TABLE public.book_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_reading_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_subscription_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "book_analytics_select_policy" ON public.book_analytics;
CREATE POLICY "book_analytics_select_policy"
  ON public.book_analytics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.books b
      JOIN public.channels c ON c.id = b.channel_id
      WHERE b.id = book_analytics.book_id
        AND (b.visibility = 'public' OR c.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "channel_analytics_select_policy" ON public.channel_analytics;
CREATE POLICY "channel_analytics_select_policy"
  ON public.channel_analytics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_analytics.channel_id
        AND (c.channel_type = 'books' OR c.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "book_analytics_events_owner_read" ON public.book_analytics_events;
CREATE POLICY "book_analytics_events_owner_read"
  ON public.book_analytics_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = book_analytics_events.channel_id
        AND c.user_id = auth.uid()
    )
    OR book_analytics_events.user_id = auth.uid()
  );

DROP POLICY IF EXISTS "book_reading_sessions_owner_read" ON public.book_reading_sessions;
CREATE POLICY "book_reading_sessions_owner_read"
  ON public.book_reading_sessions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = book_reading_sessions.channel_id
        AND c.user_id = auth.uid()
    )
    OR book_reading_sessions.user_id = auth.uid()
  );

DROP POLICY IF EXISTS "channel_subscription_events_owner_read" ON public.channel_subscription_events;
CREATE POLICY "channel_subscription_events_owner_read"
  ON public.channel_subscription_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = channel_subscription_events.channel_id
        AND c.user_id = auth.uid()
    )
    OR channel_subscription_events.user_id = auth.uid()
  );

REVOKE INSERT, UPDATE, DELETE ON public.book_analytics FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.channel_analytics FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.book_analytics_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.book_reading_sessions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.channel_subscription_events FROM anon, authenticated;

GRANT SELECT ON public.book_analytics TO anon, authenticated;
GRANT SELECT ON public.channel_analytics TO anon, authenticated;
GRANT SELECT ON public.book_analytics_events TO authenticated;
GRANT SELECT ON public.book_reading_sessions TO authenticated;
GRANT SELECT ON public.channel_subscription_events TO authenticated;

-- 5. Channel & Book Refresh / Reconciliation Helpers
CREATE OR REPLACE FUNCTION public.refresh_channel_analytics(p_channel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _seed_url constant text := 'https://www.gutenberg.org/files/1342/1342-h/1342-h.htm';
  _subs integer := 0;
  _unique_readers integer := 0;
  _unique_views integer := 0;
BEGIN
  IF p_channel_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(c.subscribers_count, 0) INTO _subs
  FROM public.channels c WHERE c.id = p_channel_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(DISTINCT COALESCE(rs.user_id::text, rs.session_key))
  INTO _unique_readers
  FROM public.book_reading_sessions rs
  JOIN public.books b ON b.id = rs.book_id
  WHERE rs.channel_id = p_channel_id
    AND (b.book_url IS NULL OR b.book_url <> _seed_url);

  SELECT COUNT(DISTINCT COALESCE(ev.user_id::text, ev.session_id))
  INTO _unique_views
  FROM public.book_analytics_events ev
  JOIN public.books b ON b.id = ev.book_id
  WHERE ev.channel_id = p_channel_id
    AND ev.event_type = 'view'
    AND (b.book_url IS NULL OR b.book_url <> _seed_url);

  INSERT INTO public.channel_analytics (
    channel_id,
    total_books,
    total_subscribers,
    total_views,
    unique_views,
    total_downloads,
    total_likes,
    total_comments,
    total_shares,
    total_bookmarks,
    total_reading_sessions,
    total_reading_seconds,
    total_pages_read,
    unique_readers,
    last_activity_at,
    updated_at
  )
  SELECT
    p_channel_id,
    COUNT(*)::integer,
    _subs,
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
    MAX(COALESCE(b.last_activity_at, b.created_at)),
    now()
  FROM public.books b
  WHERE b.channel_id = p_channel_id
    AND (b.book_url IS NULL OR b.book_url <> _seed_url)
  ON CONFLICT (channel_id) DO UPDATE SET
    total_books = EXCLUDED.total_books,
    total_subscribers = EXCLUDED.total_subscribers,
    total_views = EXCLUDED.total_views,
    unique_views = EXCLUDED.unique_views,
    total_downloads = EXCLUDED.total_downloads,
    total_likes = EXCLUDED.total_likes,
    total_comments = EXCLUDED.total_comments,
    total_shares = EXCLUDED.total_shares,
    total_bookmarks = EXCLUDED.total_bookmarks,
    total_reading_sessions = EXCLUDED.total_reading_sessions,
    total_reading_seconds = EXCLUDED.total_reading_seconds,
    total_pages_read = EXCLUDED.total_pages_read,
    unique_readers = EXCLUDED.unique_readers,
    last_activity_at = EXCLUDED.last_activity_at,
    updated_at = now();
END; $function$;

CREATE OR REPLACE FUNCTION public.refresh_book_analytics_row(p_book_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _b record;
BEGIN
  SELECT * INTO _b FROM public.books WHERE id = p_book_id;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.book_analytics (
    book_id, channel_id, total_views, unique_views, total_downloads, total_likes,
    total_comments, total_shares, total_bookmarks, total_reading_sessions,
    total_reading_seconds, total_pages_read, unique_readers, last_activity_at, updated_at
  )
  VALUES (
    _b.id, _b.channel_id,
    COALESCE(_b.views_count, 0),
    COALESCE(_b.unique_views_count, 0),
    COALESCE(_b.downloads_count, 0),
    COALESCE(_b.likes_count, 0),
    COALESCE(_b.comments_count, 0),
    COALESCE(_b.shares_count, 0),
    COALESCE(_b.saves_count, 0),
    COALESCE(_b.reading_sessions_count, 0),
    COALESCE(_b.total_reading_seconds, 0),
    COALESCE(_b.pages_read_total, 0),
    (SELECT COUNT(DISTINCT COALESCE(user_id::text, session_key)) FROM public.book_reading_sessions WHERE book_id = _b.id),
    COALESCE(_b.last_activity_at, _b.created_at),
    now()
  )
  ON CONFLICT (book_id) DO UPDATE SET
    channel_id = EXCLUDED.channel_id,
    total_views = EXCLUDED.total_views,
    unique_views = EXCLUDED.unique_views,
    total_downloads = EXCLUDED.total_downloads,
    total_likes = EXCLUDED.total_likes,
    total_comments = EXCLUDED.total_comments,
    total_shares = EXCLUDED.total_shares,
    total_bookmarks = EXCLUDED.total_bookmarks,
    total_reading_sessions = EXCLUDED.total_reading_sessions,
    total_reading_seconds = EXCLUDED.total_reading_seconds,
    total_pages_read = EXCLUDED.total_pages_read,
    unique_readers = EXCLUDED.unique_readers,
    last_activity_at = EXCLUDED.last_activity_at,
    updated_at = now();
END; $function$;

-- 6. Atomic, Authorized Event Tracking RPCs
CREATE OR REPLACE FUNCTION public.record_book_view_v2(p_book_id uuid, p_session_key text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _book record;
  _actor text;
  _recent boolean := false;
  _unique_views integer;
BEGIN
  SELECT b.id, b.channel_id, b.visibility, c.user_id AS owner_id
  INTO _book
  FROM public.books b
  JOIN public.channels c ON c.id = b.channel_id
  WHERE b.id = p_book_id;

  IF NOT FOUND THEN RETURN false; END IF;
  IF _book.visibility = 'private' AND _book.owner_id IS DISTINCT FROM _uid THEN
    RETURN false;
  END IF;

  _actor := COALESCE(_uid::text, NULLIF(trim(p_session_key), ''));
  IF _actor IS NULL THEN RETURN false; END IF;

  -- Deduplicate views within a 30-minute window per actor/session
  SELECT EXISTS (
    SELECT 1 FROM public.book_analytics_events e
    WHERE e.book_id = p_book_id
      AND e.event_type = 'view'
      AND COALESCE(e.user_id::text, e.session_id) = _actor
      AND e.created_at > now() - interval '30 minutes'
  ) INTO _recent;

  IF _recent THEN
    RETURN false;
  END IF;

  INSERT INTO public.book_analytics_events (book_id, channel_id, user_id, session_id, event_type)
  VALUES (p_book_id, _book.channel_id, _uid, COALESCE(NULLIF(trim(p_session_key), ''), _uid::text), 'view');

  SELECT COUNT(DISTINCT COALESCE(user_id::text, session_id))
  INTO _unique_views
  FROM public.book_analytics_events
  WHERE book_id = p_book_id AND event_type = 'view';

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books
  SET
    views_count = COALESCE(views_count, 0) + 1,
    unique_views_count = GREATEST(COALESCE(unique_views_count, 0), _unique_views),
    last_activity_at = now()
  WHERE id = p_book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(p_book_id);
  PERFORM public.refresh_channel_analytics(_book.channel_id);
  RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION public.record_book_download(p_book_id uuid, p_idempotency_key text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _book record;
  _ins integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT b.id, b.channel_id, b.visibility, c.user_id AS owner_id
  INTO _book
  FROM public.books b
  JOIN public.channels c ON c.id = b.channel_id
  WHERE b.id = p_book_id;

  IF NOT FOUND THEN RETURN false; END IF;
  IF _book.visibility = 'private' AND _book.owner_id IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.book_analytics_events (
    book_id, channel_id, user_id, event_type, idempotency_key
  )
  VALUES (
    p_book_id,
    _book.channel_id,
    _uid,
    'download',
    NULLIF(trim(p_idempotency_key), '')
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS _ins = ROW_COUNT;
  IF _ins = 0 THEN RETURN false; END IF;

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books
  SET
    downloads_count = COALESCE(downloads_count, 0) + 1,
    last_activity_at = now()
  WHERE id = p_book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(p_book_id);
  PERFORM public.refresh_channel_analytics(_book.channel_id);
  RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION public.record_book_share(
  p_book_id uuid,
  p_platform text DEFAULT 'link',
  p_idempotency_key text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _book record;
  _ins integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT b.id, b.channel_id, b.visibility, c.user_id AS owner_id
  INTO _book
  FROM public.books b
  JOIN public.channels c ON c.id = b.channel_id
  WHERE b.id = p_book_id;

  IF NOT FOUND THEN RETURN false; END IF;
  IF _book.visibility = 'private' THEN
    RETURN false;
  END IF;

  INSERT INTO public.book_analytics_events (
    book_id, channel_id, user_id, event_type, idempotency_key, metadata
  )
  VALUES (
    p_book_id,
    _book.channel_id,
    _uid,
    'share',
    NULLIF(trim(p_idempotency_key), ''),
    jsonb_build_object('platform', COALESCE(NULLIF(trim(p_platform), ''), 'link'))
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS _ins = ROW_COUNT;
  IF _ins = 0 THEN RETURN false; END IF;

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books
  SET
    shares_count = COALESCE(shares_count, 0) + 1,
    last_activity_at = now()
  WHERE id = p_book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(p_book_id);
  PERFORM public.refresh_channel_analytics(_book.channel_id);
  RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION public.record_reading_session_heartbeat(
  p_book_id uuid,
  p_session_key text,
  p_delta_seconds integer,
  p_pages_read integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _book record;
  _delta integer := LEAST(GREATEST(COALESCE(p_delta_seconds, 0), 0), 300);
  _pages integer := LEAST(GREATEST(COALESCE(p_pages_read, 0), 0), 500);
  _is_new_session boolean := false;
  _sess_count integer;
  _tot_secs bigint;
  _tot_pages bigint;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  IF p_session_key IS NULL OR trim(p_session_key) = '' THEN RETURN false; END IF;

  SELECT b.id, b.channel_id, b.visibility, c.user_id AS owner_id
  INTO _book
  FROM public.books b
  JOIN public.channels c ON c.id = b.channel_id
  WHERE b.id = p_book_id;

  IF NOT FOUND THEN RETURN false; END IF;
  IF _book.visibility = 'private' AND _book.owner_id IS DISTINCT FROM _uid THEN
    RETURN false;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.book_reading_sessions
    WHERE book_id = p_book_id AND session_key = p_session_key
  ) INTO _is_new_session;

  INSERT INTO public.book_reading_sessions (
    book_id, channel_id, user_id, session_key, duration_seconds, pages_read
  )
  VALUES (
    p_book_id, _book.channel_id, _uid, p_session_key, _delta, _pages
  )
  ON CONFLICT (book_id, session_key) DO UPDATE SET
    duration_seconds = public.book_reading_sessions.duration_seconds + EXCLUDED.duration_seconds,
    pages_read = GREATEST(public.book_reading_sessions.pages_read, EXCLUDED.pages_read),
    last_heartbeat_at = now();

  IF _is_new_session THEN
    INSERT INTO public.book_analytics_events (
      book_id, channel_id, user_id, session_id, event_type, duration_seconds, pages_read
    )
    VALUES (
      p_book_id, _book.channel_id, _uid, p_session_key, 'reading_session', _delta, _pages
    );
  END IF;

  SELECT COUNT(*)::integer, COALESCE(SUM(duration_seconds), 0)::bigint, COALESCE(SUM(pages_read), 0)::bigint
  INTO _sess_count, _tot_secs, _tot_pages
  FROM public.book_reading_sessions
  WHERE book_id = p_book_id;

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books
  SET
    reading_sessions_count = _sess_count,
    total_reading_seconds = _tot_secs,
    pages_read_total = _tot_pages,
    last_activity_at = now()
  WHERE id = p_book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(p_book_id);
  PERFORM public.refresh_channel_analytics(_book.channel_id);
  RETURN true;
END; $function$;

-- 7. Triggers keeping Likes, Comments, Bookmarks, Subscriptions & Channel Aggregates synced
CREATE OR REPLACE FUNCTION public.sync_book_likes_and_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _book_id uuid := COALESCE(NEW.book_id, OLD.book_id);
  _channel_id uuid;
BEGIN
  IF _book_id IS NULL THEN RETURN NULL; END IF;
  SELECT channel_id INTO _channel_id FROM public.books WHERE id = _book_id;
  IF _channel_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.book_analytics_events (book_id, channel_id, user_id, event_type)
  VALUES (
    _book_id,
    _channel_id,
    COALESCE(NEW.user_id, OLD.user_id),
    CASE WHEN TG_OP = 'DELETE' THEN 'unlike' ELSE 'like' END
  );

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books
  SET
    likes_count = (SELECT COUNT(*) FROM public.likes WHERE book_id = _book_id),
    last_activity_at = now()
  WHERE id = _book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(_book_id);
  PERFORM public.refresh_channel_analytics(_channel_id);
  RETURN NULL;
END; $function$;

DROP TRIGGER IF EXISTS trg_book_likes_analytics ON public.likes;
CREATE TRIGGER trg_book_likes_analytics
  AFTER INSERT OR DELETE ON public.likes
  FOR EACH ROW
  WHEN (pg_trigger_depth() < 2)
  EXECUTE FUNCTION public.sync_book_likes_and_events();

CREATE OR REPLACE FUNCTION public.sync_book_comments_and_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _book_id uuid := COALESCE(NEW.book_id, OLD.book_id);
  _channel_id uuid;
BEGIN
  IF _book_id IS NULL THEN RETURN NULL; END IF;
  SELECT channel_id INTO _channel_id FROM public.books WHERE id = _book_id;
  IF _channel_id IS NULL THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.book_analytics_events (book_id, channel_id, user_id, event_type)
    VALUES (_book_id, _channel_id, NEW.user_id, 'comment');
  END IF;

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books
  SET
    comments_count = (SELECT COUNT(*) FROM public.book_comments WHERE book_id = _book_id),
    last_activity_at = now()
  WHERE id = _book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(_book_id);
  PERFORM public.refresh_channel_analytics(_channel_id);
  RETURN NULL;
END; $function$;

DROP TRIGGER IF EXISTS trg_book_comments_analytics ON public.book_comments;
CREATE TRIGGER trg_book_comments_analytics
  AFTER INSERT OR DELETE ON public.book_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_book_comments_and_events();

CREATE OR REPLACE FUNCTION public.sync_saved_book_analytics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _book_id uuid := COALESCE(NEW.book_id, OLD.book_id);
  _channel_id uuid;
BEGIN
  IF _book_id IS NULL THEN RETURN NULL; END IF;
  SELECT channel_id INTO _channel_id FROM public.books WHERE id = _book_id;
  IF _channel_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.book_analytics_events (book_id, channel_id, user_id, event_type)
  VALUES (
    _book_id,
    _channel_id,
    COALESCE(NEW.user_id, OLD.user_id),
    CASE WHEN TG_OP = 'DELETE' THEN 'unbookmark' ELSE 'bookmark' END
  );

  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  UPDATE public.books
  SET
    saves_count = (SELECT COUNT(*) FROM public.saved_books WHERE book_id = _book_id),
    last_activity_at = now()
  WHERE id = _book_id;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  PERFORM public.refresh_book_analytics_row(_book_id);
  PERFORM public.refresh_channel_analytics(_channel_id);
  RETURN NULL;
END; $function$;

DROP TRIGGER IF EXISTS trg_saved_books_analytics ON public.saved_books;
CREATE TRIGGER trg_saved_books_analytics
  AFTER INSERT OR DELETE ON public.saved_books
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_saved_book_analytics();

-- Trigger on books insert/update/delete/channel-transfer to keep channel_analytics authoritative
CREATE OR REPLACE FUNCTION public.sync_channel_on_book_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF pg_trigger_depth() > 2 THEN
    RETURN NULL;
  END IF;

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
END; $function$;

DROP TRIGGER IF EXISTS trg_books_channel_analytics ON public.books;
CREATE TRIGGER trg_books_channel_analytics
  AFTER INSERT OR UPDATE OF channel_id, visibility, views_count, downloads_count, likes_count, comments_count, shares_count, saves_count, reading_sessions_count, total_reading_seconds
  OR DELETE ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_channel_on_book_change();

-- Enhance subscriber RPCs to emit subscription history events + keep channel_analytics synced
CREATE OR REPLACE FUNCTION public.subscribe_to_channel(target_channel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _ins integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.subscriptions (user_id, channel_id)
  VALUES (auth.uid(), target_channel_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _ins = ROW_COUNT;

  IF _ins > 0 THEN
    INSERT INTO public.channel_subscription_events (channel_id, user_id, event_type)
    VALUES (target_channel_id, auth.uid(), 'subscribe');
  END IF;

  PERFORM set_config('app.channel_metrics_trusted', 'on', true);
  UPDATE public.channels
  SET subscribers_count = (SELECT COUNT(*) FROM public.subscriptions WHERE channel_id = target_channel_id)
  WHERE id = target_channel_id;
  PERFORM set_config('app.channel_metrics_trusted', 'off', true);

  PERFORM public.refresh_channel_analytics(target_channel_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.unsubscribe_from_channel(target_channel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _del integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.subscriptions
  WHERE user_id = auth.uid() AND channel_id = target_channel_id;
  GET DIAGNOSTICS _del = ROW_COUNT;

  IF _del > 0 THEN
    INSERT INTO public.channel_subscription_events (channel_id, user_id, event_type)
    VALUES (target_channel_id, auth.uid(), 'unsubscribe');
  END IF;

  PERFORM set_config('app.channel_metrics_trusted', 'on', true);
  UPDATE public.channels
  SET subscribers_count = (SELECT COUNT(*) FROM public.subscriptions WHERE channel_id = target_channel_id)
  WHERE id = target_channel_id;
  PERFORM set_config('app.channel_metrics_trusted', 'off', true);

  PERFORM public.refresh_channel_analytics(target_channel_id);
END; $function$;

-- 8. Reconciliation RPC for full consistency checks
CREATE OR REPLACE FUNCTION public.reconcile_bookshelf_analytics(p_channel_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _b record;
  _c record;
BEGIN
  PERFORM set_config('app.book_metrics_trusted', 'on', true);
  FOR _b IN
    SELECT id FROM public.books
    WHERE p_channel_id IS NULL OR channel_id = p_channel_id
  LOOP
    UPDATE public.books b
    SET
      likes_count = (SELECT COUNT(*) FROM public.likes l WHERE l.book_id = b.id),
      comments_count = (SELECT COUNT(*) FROM public.book_comments bc WHERE bc.book_id = b.id),
      saves_count = (SELECT COUNT(*) FROM public.saved_books sb WHERE sb.book_id = b.id)
    WHERE b.id = _b.id;

    PERFORM public.refresh_book_analytics_row(_b.id);
  END LOOP;
  PERFORM set_config('app.book_metrics_trusted', 'off', true);

  FOR _c IN
    SELECT id FROM public.channels
    WHERE channel_type = 'books' AND (p_channel_id IS NULL OR id = p_channel_id)
  LOOP
    PERFORM public.refresh_channel_analytics(_c.id);
  END LOOP;
END; $function$;

-- Permissions
REVOKE EXECUTE ON FUNCTION public.record_book_view_v2(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_book_view_v2(uuid, text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.record_book_download(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_book_download(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_book_share(uuid, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_book_share(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_reading_session_heartbeat(uuid, text, integer, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_reading_session_heartbeat(uuid, text, integer, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reconcile_bookshelf_analytics(uuid) FROM anon, authenticated, public;

-- 9. Realtime replication for instant <= 3s updates
ALTER TABLE public.books REPLICA IDENTITY FULL;
ALTER TABLE public.channels REPLICA IDENTITY FULL;
ALTER TABLE public.book_analytics REPLICA IDENTITY FULL;
ALTER TABLE public.channel_analytics REPLICA IDENTITY FULL;
ALTER TABLE public.book_analytics_events REPLICA IDENTITY FULL;
ALTER TABLE public.channel_subscription_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.book_analytics; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_analytics; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.book_analytics_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_subscription_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- Initial backfill of existing books and channels
SELECT public.reconcile_bookshelf_analytics(NULL);
