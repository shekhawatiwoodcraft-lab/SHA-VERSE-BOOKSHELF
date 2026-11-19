import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3, Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { useChannelAnalytics } from "@/hooks/useChannelAnalytics";
import { ChannelAnalyticsPanel } from "@/components/bookshelf/analytics/ChannelAnalyticsPanel";
import { useSmartBack } from "@/lib/navigation";

const ChannelAnalytics = () => {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const handleBack = useSmartBack(channelId ? `/bookshelf/channel/${channelId}` : "/bookshelf");
  const { user } = useAuth();
  const { channel, isLoading } = useChannelAnalytics({
    channelId,
    enabled: !!channelId,
    subscribeRealtime: false,
  });

  if (isLoading && !channel) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!channel || !channelId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center">
        <Users className="w-12 h-12 text-muted-foreground mb-3" />
        <h1 className="text-xl font-semibold mb-1">Channel not found</h1>
        <p className="text-sm text-muted-foreground mb-4">
          This author channel does not exist or may have been removed.
        </p>
        <Button onClick={() => navigate("/bookshelf")}>Back to Bookshelf</Button>
      </div>
    );
  }

  const isOwner = user?.id && channel.user_id === user.id;

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-card/85 backdrop-blur-lg border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back"
              onClick={() => handleBack()}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Avatar className="w-9 h-9 border border-border shrink-0">
              <AvatarImage src={channel.avatar_url || ""} />
              <AvatarFallback>{channel.name?.charAt(0) || "C"}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="font-semibold text-base truncate flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary shrink-0" />
                {channel.name} — Analytics
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                Real-time channel studio metrics
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/bookshelf/channel/${channelId}`)}
          >
            View Channel
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {!isOwner ? (
          <Card className="p-8 text-center max-w-lg mx-auto">
            <Lock className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-1">Creator Analytics Only</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Detailed channel analytics are visible to the owner of{" "}
              <span className="font-medium text-foreground">{channel.name}</span>.
            </p>
            <Button onClick={() => navigate(`/bookshelf/channel/${channelId}`)}>
              Return to Channel
            </Button>
          </Card>
        ) : (
          <ChannelAnalyticsPanel channelId={channelId} />
        )}
      </main>
    </div>
  );
};

export default ChannelAnalytics;
