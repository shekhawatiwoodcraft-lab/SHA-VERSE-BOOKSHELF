import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isSchemaMissingError } from "@/integrations/supabase/config";
import { isOwnerEmail } from "@/modules/bookshelf/lib/uploadAccess";

export function useAppOwner() {
  const { user } = useAuth();
  const isOwnerByEmail = isOwnerEmail(user?.email);

  const { data: isAdminRole = false, isLoading } = useQuery({
    queryKey: ["app-owner-check", user?.id, user?.email],
    queryFn: async () => {
      if (!user) return false;
      if (isOwnerEmail(user.email)) return true;

      const { data, error } = await supabase.rpc("is_admin", { _user_id: user.id });
      if (!error && typeof data === "boolean") return data;
      if (error && isSchemaMissingError(error)) return false;

      const { data: roleRow, error: roleErr } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (roleErr && isSchemaMissingError(roleErr)) return false;
      return !!roleRow;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  return {
    isAppOwner: isOwnerByEmail || isAdminRole,
    isLoading,
  };
}
