import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SEO } from "@/components/seo/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import {
  ArrowLeft,
  Shield,
  ShieldAlert,
  Users,
  BookOpen,
  Flag,
  Activity,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useAdminPanel } from "@/hooks/useAdminPanel";

export default function AdminPanel() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const admin = useAdminPanel();
  const [userSearch, setUserSearch] = useState("");

  if (admin.ownerLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!admin.isAppOwner) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-6 text-center space-y-4">
          <ShieldAlert className="w-12 h-12 text-destructive mx-auto" />
          <h1 className="text-xl font-bold">Access Denied</h1>
          <p className="text-sm text-muted-foreground">
            This console is restricted to platform Administrators and Super Admins.
          </p>
          <Button onClick={() => navigate("/bookshelf")}>Return to Bookshelf</Button>
        </Card>
      </div>
    );
  }

  const filteredUsers = admin.users.filter((u) => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    return u.display_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
  });

  const handleRoleChange = async (userId: string, role: "admin" | "moderator" | "user") => {
    try {
      await admin.setUserRole.mutateAsync({ targetUserId: userId, role });
      toast({ title: "Role Updated", description: `Assigned role "${role}".` });
    } catch (err) {
      toast({
        title: "Role Update Failed",
        description: err instanceof Error ? err.message : "Could not update role.",
        variant: "destructive",
      });
    }
  };

  const handleReportStatus = async (reportId: string, status: "pending" | "reviewing" | "resolved" | "rejected") => {
    try {
      await admin.updateReportStatus.mutateAsync({ reportId, status });
      toast({ title: "Report Updated", description: `Report marked as ${status}.` });
    } catch (err) {
      toast({
        title: "Moderation Update Failed",
        description: err instanceof Error ? err.message : "Could not update report.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-subtle pb-16">
      <SEO title="Admin Console — Sha-Verse Bookshelf" description="Role management, content moderation, analytics, and audit logs." path="/admin" />

      <header className="sticky top-0 z-40 bg-card/85 backdrop-blur-lg border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/bookshelf")} aria-label="Back to Bookshelf">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Platform Admin Console
              </h1>
              <p className="text-xs text-muted-foreground">RBAC Governance, Moderation &amp; Audit Trail</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
            Library Workspace
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {admin.schemaMissing && (
          <Card className="p-4 border-amber-500/40 bg-amber-500/10 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm space-y-1">
              <p className="font-semibold">Admin RPCs Pending SQL Migration</p>
              <p className="text-muted-foreground">
                Run <code>supabase/migrations/20261120000000_bookshelf_management_complete.sql</code> in Supabase SQL Editor to enable <code>admin_get_platform_stats</code>, <code>admin_list_users_with_roles</code>, and <code>audit_logs</code>.
              </p>
            </div>
          </Card>
        )}

        <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: "Users", value: admin.stats?.total_users ?? 0, icon: Users },
            { label: "Books", value: admin.stats?.total_books ?? 0, icon: BookOpen },
            { label: "Author Channels", value: admin.stats?.total_channels ?? 0, icon: Users },
            { label: "Shelves", value: admin.stats?.total_shelves ?? 0, icon: BookOpen },
            { label: "Read Sessions", value: admin.stats?.total_reading_sessions ?? 0, icon: Activity },
            { label: "Pending Reports", value: admin.stats?.pending_reports ?? 0, icon: Flag },
            { label: "Active Devices", value: admin.stats?.active_sessions ?? 0, icon: Shield },
          ].map((item) => (
            <Card key={item.label} className="p-3.5">
              <item.icon className="w-4 h-4 text-primary mb-1" />
              <div className="text-xl font-bold">{item.value}</div>
              <div className="text-[11px] text-muted-foreground">{item.label}</div>
            </Card>
          ))}
        </section>

        <Tabs defaultValue="users" className="space-y-4">
          <TabsList>
            <TabsTrigger value="users">Users &amp; Roles ({admin.users.length})</TabsTrigger>
            <TabsTrigger value="reports">Moderation Reports ({admin.reports.length})</TabsTrigger>
            <TabsTrigger value="audit">Audit Logs ({admin.auditLogs.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            <Input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search users by name or username..."
              className="max-w-sm"
            />
            <div className="space-y-2">
              {filteredUsers.map((u) => {
                const currentRole = (u.roles[0] || "user") as "admin" | "moderator" | "user";
                return (
                  <Card key={u.user_id} className="p-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-sm">
                        {u.display_name} <span className="text-muted-foreground font-normal">@{u.username}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Provider: {u.provider || "email"} · Joined {new Date(u.created_at).toLocaleDateString()}
                        {u.is_deactivated ? " · Deactivated" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`Role for ${u.username}`}
                        value={currentRole}
                        onChange={(e) => void handleRoleChange(u.user_id, e.target.value as "admin" | "moderator" | "user")}
                        className="h-9 rounded-md border border-input bg-background px-2.5 text-xs"
                      >
                        <option value="user">User</option>
                        <option value="moderator">Moderator</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </Card>
                );
              })}
              {filteredUsers.length === 0 && (
                <Card className="p-6 text-center text-sm text-muted-foreground">No matching users loaded.</Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="reports" className="space-y-3">
            {admin.reports.map((report) => (
              <Card key={report.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{report.book?.title || "Reported Book"}</span>
                    <Badge variant={report.status === "pending" ? "destructive" : "secondary"}>{report.status}</Badge>
                  </div>
                  <p className="text-xs font-medium text-foreground/85">Reason: {report.reason}</p>
                  {report.description && <p className="text-xs text-muted-foreground">{report.description}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(["reviewing", "resolved", "rejected"] as const).map((status) => (
                    <Button
                      key={status}
                      size="sm"
                      variant={report.status === status ? "default" : "outline"}
                      onClick={() => void handleReportStatus(report.id, status)}
                    >
                      {status}
                    </Button>
                  ))}
                </div>
              </Card>
            ))}
            {admin.reports.length === 0 && (
              <Card className="p-6 text-center text-sm text-muted-foreground">No user reports to review.</Card>
            )}
          </TabsContent>

          <TabsContent value="audit" className="space-y-2">
            {admin.auditLogs.map((log) => (
              <Card key={log.id} className="p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-semibold">{log.action}</span> on{" "}
                  <span className="text-muted-foreground">{log.target_type}</span>{" "}
                  {log.target_id ? `(${log.target_id})` : ""}
                </div>
                <span className="text-muted-foreground">{new Date(log.created_at).toLocaleString()}</span>
              </Card>
            ))}
            {admin.auditLogs.length === 0 && (
              <Card className="p-6 text-center text-sm text-muted-foreground">No audit events logged yet.</Card>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
