import { useState } from 'react';
import {
  Link, Copy, Send, Check, ExternalLink,
  Facebook, Twitter, Mail, Globe, Lock, UserCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getEntityUrl, handleShare as nativeShare, type ShareEntityType } from "@/lib/deepLinks";
import { recordBookShare } from "@/lib/analytics/tracking";
import { useQueryClient } from "@tanstack/react-query";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string;
  postType?: ShareEntityType;
  postContent?: string;
  postImage?: string;
  postVisibility?: string;
}

export const ShareDialog = ({
  open,
  onOpenChange,
  postId,
  postType = 'book',
  postContent,
  postVisibility = 'public',
}: ShareDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const postUrl = getEntityUrl(postType, postId);

  const trackBookShareEvent = (platform: string) => {
    if (postType === "book" && postVisibility !== "private" && postId) {
      void recordBookShare(postId, platform).then((ok) => {
        if (ok) {
          queryClient.invalidateQueries({ queryKey: ["book-analytics-raw", postId] });
          queryClient.invalidateQueries({ queryKey: ["channel-analytics-raw"] });
        }
      });
    }
  };

  const handleCopyLink = async () => {
    if (postVisibility === "private") return;
    try {
      await navigator.clipboard.writeText(postUrl);
      setCopied(true);
      trackBookShareEvent("copy_link");
      toast({ title: 'Link copied!' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Failed to copy',
        description: 'Please copy the link manually',
        variant: 'destructive',
      });
    }
  };

  const handleNativeShare = async () => {
    if (postVisibility === 'private') {
      toast({
        title: 'Cannot share externally',
        description: 'Private content cannot be shared outside the app',
        variant: 'destructive',
      });
      return;
    }
    const result = await nativeShare(
      postType,
      postId,
      postContent?.slice(0, 60) || 'SHA-VERSE Bookshelf',
      postContent?.slice(0, 140) || 'Check this out on SHA-VERSE Bookshelf',
    );
    if (result === 'shared') {
      trackBookShareEvent("native");
      toast({ title: 'Shared!' });
      onOpenChange(false);
    } else if (result === 'copied') {
      trackBookShareEvent("copy_link");
      toast({ title: 'Link copied to clipboard' });
    }
  };

  const handleExternalShare = (platform: 'facebook' | 'twitter' | 'whatsapp' | 'email') => {
    if (postVisibility === 'private') {
      toast({
        title: 'Cannot share externally',
        description: 'Private content cannot be shared outside the app',
        variant: 'destructive',
      });
      return;
    }

    const text = postContent?.slice(0, 100) || 'Check this out!';
    const encodedUrl = encodeURIComponent(postUrl);
    const encodedText = encodeURIComponent(text);

    let shareUrl = '';
    switch (platform) {
      case 'facebook':
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
        break;
      case 'twitter':
        shareUrl = `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`;
        break;
      case 'whatsapp':
        shareUrl = `https://api.whatsapp.com/send?text=${encodedText}%20${encodedUrl}`;
        break;
      case 'email':
        shareUrl = `mailto:?subject=${encodedText}&body=${encodedUrl}`;
        break;
    }

    if (shareUrl) {
      trackBookShareEvent(platform);
      window.open(shareUrl, '_blank', 'width=600,height=400');
    }
  };

  const getVisibilityIcon = () => {
    switch (postVisibility) {
      case 'private': return <Lock className="w-4 h-4" />;
      case 'friends': return <UserCheck className="w-4 h-4" />;
      default: return <Globe className="w-4 h-4" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[90vw] md:max-w-lg p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col z-[70]">
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2.5 text-base font-bold">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Send className="w-4 h-4 text-primary" />
            </div>
            Share
            <span className="ml-auto mr-10 flex items-center gap-1.5 text-xs text-muted-foreground font-normal bg-secondary px-2.5 py-1 rounded-full">
              {getVisibilityIcon()}
              {postVisibility}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 py-4 overflow-y-auto">
          {postVisibility === 'private' ? (
            <div className="flex items-center gap-2 p-3 bg-destructive/8 text-destructive rounded-xl text-sm border border-destructive/20">
              <Lock className="w-4 h-4 shrink-0" />
              <span>Private content cannot be shared externally</span>
            </div>
          ) : null}

          {/* Copy Link */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-secondary rounded-xl border border-border">
            <Link className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={postUrl}
              readOnly
              className="flex-1 text-xs bg-transparent outline-none truncate text-muted-foreground"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyLink}
              className={`shrink-0 h-7 px-2.5 text-xs gap-1 rounded-lg font-medium transition-colors ${copied ? 'text-green-600 bg-green-500/10' : ''}`}
              disabled={postVisibility === 'private'}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>

          {/* Share platform buttons */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Share via…', icon: Send, color: 'text-primary', bg: 'bg-primary/10', action: handleNativeShare },
              { label: 'WhatsApp', icon: ExternalLink, color: 'text-green-500', bg: 'bg-green-500/10', action: () => handleExternalShare('whatsapp') },
              { label: 'Facebook', icon: Facebook, color: 'text-blue-600', bg: 'bg-blue-600/10', action: () => handleExternalShare('facebook') },
              { label: 'Twitter', icon: Twitter, color: 'text-sky-500', bg: 'bg-sky-500/10', action: () => handleExternalShare('twitter') },
            ].map(({ label, icon: Icon, color, bg, action }) => (
              <button
                key={label}
                onClick={action}
                disabled={postVisibility === 'private'}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <span className="text-[10px] font-medium text-muted-foreground leading-tight">{label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => handleExternalShare('email')}
            disabled={postVisibility === 'private'}
            className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <div className="w-9 h-9 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
              <Mail className="w-4.5 h-4.5 text-orange-500" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium">Email</p>
              <p className="text-xs text-muted-foreground">Share via email</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted-foreground ml-auto" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
