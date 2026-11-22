-- ============================================================================
-- SHA-VERSE BOOKSHELF: Complete Production Management Schema Extension
-- Safe, idempotent migration — preserves all existing tables & data.
-- Run in Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

-- 1. Extend public.books with full catalog & archival metadata
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

-- 2. Extend public.book_reading_progress with statuses, timestamps & reading time
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

-- Ensure is_admin() also recognizes designated app owner email safely
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = _user_id
        AND lower(COALESCE(u.email, '')) = 'shashaaiteam@gmail.com'
    )
$$;

-- 3. Custom Shelves & Book-to-Shelf Mapping (no book duplication across shelves)
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_shelves_user_name_unique
  ON public.shelves(user_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_shelves_user_id ON public.shelves(user_id);

ALTER TABLE public.shelves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own or public shelves" ON public.shelves;
CREATE POLICY "Users read own or public shelves"
  ON public.shelves FOR SELECT
  USING (auth.uid() = user_id OR visibility = 'public');

DROP POLICY IF EXISTS "Users insert own shelves" ON public.shelves;
CREATE POLICY "Users insert own shelves"
  ON public.shelves FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own shelves" ON public.shelves;
CREATE POLICY "Users update own shelves"
  ON public.shelves FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own shelves" ON public.shelves;
CREATE POLICY "Users delete own shelves"
  ON public.shelves FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_shelves_updated_at ON public.shelves;
CREATE TRIGGER trg_shelves_updated_at
  BEFORE UPDATE ON public.shelves
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
CREATE POLICY "Users view own or public shelf_books"
  ON public.shelf_books FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.shelves s
      WHERE s.id = shelf_books.shelf_id AND s.visibility = 'public'
    )
  );

DROP POLICY IF EXISTS "Users manage own shelf_books" ON public.shelf_books;
CREATE POLICY "Users manage own shelf_books"
  ON public.shelf_books FOR ALL TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.shelves s
      WHERE s.id = shelf_books.shelf_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.shelves s
      WHERE s.id = shelf_books.shelf_id AND s.user_id = auth.uid()
    )
  );

-- 4. Reading Goals
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
CREATE POLICY "Users manage own reading_goals"
  ON public.reading_goals FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_reading_goals_updated_at ON public.reading_goals;
CREATE TRIGGER trg_reading_goals_updated_at
  BEFORE UPDATE ON public.reading_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Synced Personal Notes & Highlights (strictly user-isolated)
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
CREATE POLICY "Users strictly manage own notes"
  ON public.book_notes FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_book_notes_updated_at ON public.book_notes;
CREATE TRIGGER trg_book_notes_updated_at
  BEFORE UPDATE ON public.book_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Borrowed & Lent Books Circulation
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
CREATE POLICY "Users manage own book_loans"
  ON public.book_loans FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_book_loans_updated_at ON public.book_loans;
CREATE TRIGGER trg_book_loans_updated_at
  BEFORE UPDATE ON public.book_loans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. In-App Notifications
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
CREATE POLICY "Users manage own notifications"
  ON public.notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 8. Security Audit Logs
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
CREATE POLICY "Authenticated users insert own audit logs"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = actor_id);

DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- 9. Admin RPCs (Server-Enforced Authorization)
CREATE OR REPLACE FUNCTION public.admin_get_platform_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _result jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'forbidden: admin access required';
  END IF;

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
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  provider text,
  is_deactivated boolean,
  created_at timestamptz,
  roles text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'forbidden: admin access required';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.provider,
    p.is_deactivated,
    p.created_at,
    COALESCE(ARRAY(SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id = p.id), ARRAY['user']::text[])
  FROM public.profiles p
  ORDER BY p.created_at DESC
  LIMIT 100;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_users_with_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users_with_roles() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_target_user_id uuid,
  p_role public.app_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'forbidden: admin access required';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = p_target_user_id;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_target_user_id, p_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'set_user_role', 'user', p_target_user_id::text, jsonb_build_object('role', p_role::text));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.app_role) TO authenticated;

-- 10. Admin Moderation Policies on book_reports
DROP POLICY IF EXISTS "Admins can update book reports" ON public.book_reports;
CREATE POLICY "Admins can update book reports"
  ON public.book_reports FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 11. Realtime Replication for Workspace Tables
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

