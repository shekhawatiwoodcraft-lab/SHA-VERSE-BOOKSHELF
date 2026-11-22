import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMissingError } from "@/integrations/supabase/config";
import { useAppOwner } from "@/hooks/useAppOwner";

export interface PlatformAdminStats {
  total_users: number;
  total_books: number;
  total_channels: number;
  total_shelves: number;
  total_reading_sessions: number;
  pending_reports: number;
  active_sessions: number;
}

export interface AdminUserRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  provider: string | null;
  is_deactivated: boolean;
  created_at: string;
  roles: string[];
}

export interface BookReportAdminRow {
  id: string;
  book_id: string;
  reporter_id: string;
  reason: string;
  description: string | null;
  contact_email: string | null;
  status: "pending" | "reviewing" | "resolved" | "rejected";
  admin_notes: string | null;
  created_at: string;
  book?: {
    id: string;
    title: string;
    author: string;
  } | null;
}

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function useAdminPanel() {
  const { isAppOwner, isLoading: ownerLoading } = useAppOwner();
  const queryClient = useQueryClient();

  const statsQuery = useQuery({
    queryKey: ["admin-platform-stats"],
    enabled: isAppOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_platform_stats" as never);
      if (error) {
        if (isSchemaMissingError(error)) return { stats: null as PlatformAdminStats | null, schemaMissing: true };
        throw error;
      }
      return { stats: data as PlatformAdminStats, schemaMissing: false };
    },
  });

  const usersQuery = useQuery({
    queryKey: ["admin-users-roles"],
    enabled: isAppOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users_with_roles" as never);
      if (error) {
        if (isSchemaMissingError(error)) return { rows: [] as AdminUserRow[], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as AdminUserRow[], schemaMissing: false };
    },
  });

  const reportsQuery = useQuery({
    queryKey: ["admin-book-reports"],
    enabled: isAppOwner,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("book_reports")
        .select("id, book_id, reporter_id, reason, description, contact_email, status, admin_notes, created_at, book:books(id, title, author)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        if (isSchemaMissingError(error)) return { rows: [] as BookReportAdminRow[], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as unknown as BookReportAdminRow[], schemaMissing: false };
    },
  });

  const auditLogsQuery = useQuery({
    queryKey: ["admin-audit-logs"],
    enabled: isAppOwner,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        if (isSchemaMissingError(error)) return { rows: [] as AuditLogRow[], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as AuditLogRow[], schemaMissing: false };
    },
  });

  const setUserRole = useMutation({
    mutationFn: async ({ targetUserId, role }: { targetUserId: string; role: "admin" | "moderator" | "user" }) => {
      const { error } = await supabase.rpc("admin_set_user_role" as never, {
        p_target_user_id: targetUserId,
        p_role: role,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-users-roles"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-audit-logs"] });
    },
  });

  const updateReportStatus = useMutation({
    mutationFn: async ({
      reportId,
      status,
      adminNotes,
    }: {
      reportId: string;
      status: "pending" | "reviewing" | "resolved" | "rejected";
      adminNotes?: string;
    }) => {
      const { error } = await supabase
        .from("book_reports")
        .update({
          status,
          admin_notes: adminNotes?.trim() || null,
          reviewed_at: new Date().toISOString(),
        } as never)
        .eq("id", reportId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-book-reports"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-platform-stats"] });
    },
  });

  const schemaMissing = Boolean(
    statsQuery.data?.schemaMissing ||
      usersQuery.data?.schemaMissing ||
      reportsQuery.data?.schemaMissing ||
      auditLogsQuery.data?.schemaMissing,
  );

  return {
    isAppOwner,
    ownerLoading,
    stats: statsQuery.data?.stats ?? null,
    users: usersQuery.data?.rows ?? [],
    reports: reportsQuery.data?.rows ?? [],
    auditLogs: auditLogsQuery.data?.rows ?? [],
    schemaMissing,
    isLoading:
      ownerLoading ||
      (isAppOwner && (statsQuery.isLoading || usersQuery.isLoading || reportsQuery.isLoading)),
    setUserRole,
    updateReportStatus,
  };
}
