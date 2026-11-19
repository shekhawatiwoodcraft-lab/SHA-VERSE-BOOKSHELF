import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { ChannelAnalyticsPanel } from "@/components/bookshelf/analytics/ChannelAnalyticsPanel";
import { isSchemaMissingError } from "@/integrations/supabase/config";

const AnalyticsDashboard = () => {
  const { user } = useAuth();

  const { data: userChannel, isLoading } = useQuery({
    queryKey: ["user-book-channel", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("channels")
        .select("id, name")
        .eq("user_id", user.id)
        .eq("channel_type", "books")
        .maybeSingle();
      if (error) {
        if (isSchemaMissingError(error)) return null;
        throw error;
      }
      return data;
    },
    enabled: !!user?.id,
  });

  if (isLoading) {
    return (
      <div className="py-12 flex items-center justify-center">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary" />
      </div>
    );
  }

  if (!userChannel?.id) {
    return (
      <Card className="p-8 text-center">
        <BarChart3 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <h2 className="font-semibold mb-1">No Author Channel Yet</h2>
        <p className="text-sm text-muted-foreground">
          Create a bookshelf author channel and publish a book to view live analytics.
        </p>
      </Card>
    );
  }

  return <ChannelAnalyticsPanel channelId={userChannel.id} />;
};

export default AnalyticsDashboard;