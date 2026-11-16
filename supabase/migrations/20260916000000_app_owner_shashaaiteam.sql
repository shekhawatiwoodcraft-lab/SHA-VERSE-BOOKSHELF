-- Ensure designated app owner email (shashaaiteam@gmail.com) is recognized as admin/owner
-- for app_promotions and user_roles without changing behavior for regular users.

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(email) = 'shashaaiteam@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.app_promotions') IS NOT NULL THEN
    ALTER TABLE public.app_promotions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Anyone can view active app promotions" ON public.app_promotions;
    CREATE POLICY "Anyone can view active app promotions"
      ON public.app_promotions FOR SELECT
      USING (true);

    DROP POLICY IF EXISTS "App owner can insert app promotions" ON public.app_promotions;
    CREATE POLICY "App owner can insert app promotions"
      ON public.app_promotions FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() = owner_id
        AND (
          public.is_admin(auth.uid())
          OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'shashaaiteam@gmail.com'
        )
      );

    DROP POLICY IF EXISTS "App owner can delete app promotions" ON public.app_promotions;
    CREATE POLICY "App owner can delete app promotions"
      ON public.app_promotions FOR DELETE
      TO authenticated
      USING (
        public.is_admin(auth.uid())
        OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'shashaaiteam@gmail.com'
      );
  END IF;
END $$;
