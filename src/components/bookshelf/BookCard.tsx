import { memo } from "react";
import { Book, Eye, ThumbsUp, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNavigate } from "react-router-dom";
import { Book as BookType } from "@/hooks/useBooks";
import { recordBookView } from "@/lib/analytics/tracking";

interface BookCardProps {
  book: BookType;
  rankBadge?: number;
}

const getRankBadgeStyle = (rank: number) => {
  if (rank === 1) return "bg-amber-400 text-amber-950 border-amber-300";
  if (rank === 2) return "bg-slate-200 text-slate-900 border-slate-300";
  if (rank === 3) return "bg-orange-600 text-white border-orange-500";
  return "bg-zinc-900/85 text-white border-white/15";
};

const BookCardComponent = ({ book, rankBadge }: BookCardProps) => {
  const navigate = useNavigate();

  const handleBookOpen = () => {
    void recordBookView(book.id);
    navigate(`/bookshelf/book/${book.id}`, { state: { countedView: true } });
  };

  const formatCount = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  return (
    <Card
      className="overflow-hidden cursor-pointer group hover:shadow-glow transition-all"
      onClick={handleBookOpen}
      role="article"
      aria-label={`Book: ${book.title} by ${book.author}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleBookOpen();
        }
      }}
    >
      {/* Book Cover */}
      <div className="relative aspect-[2/3] bg-gradient-primary flex items-center justify-center overflow-hidden">
        {typeof rankBadge === "number" && rankBadge > 0 && (
          <span
            className={`absolute top-2 left-2 z-10 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold shadow-sm ${getRankBadgeStyle(rankBadge)}`}
          >
            #{rankBadge}
          </span>
        )}
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt={book.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <>
            <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors" />
            <Book className="w-10 h-10 sm:w-12 sm:h-12 lg:w-16 lg:h-16 text-white drop-shadow-lg" />
          </>
        )}

        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="absolute bottom-2 left-2 right-2">
            <div className="flex items-center gap-2 text-white text-xs">
              <span className="flex items-center gap-1">
                <Eye className="w-3 h-3" />
                {formatCount(book.views_count || 0)}
              </span>
              <span className="flex items-center gap-1">
                <ThumbsUp className="w-3 h-3" />
                {formatCount(book.likes_count || 0)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Book Info */}
      <div className="p-2 sm:p-3">
        <h3 className="font-semibold text-xs sm:text-sm mb-0.5 sm:mb-1 line-clamp-2">
          {book.title}
        </h3>
        <p className="text-[10px] sm:text-xs text-muted-foreground mb-1.5 sm:mb-2 truncate">
          {book.author}
        </p>

        {/* Channel info (clickable) */}
        {book.channel && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/bookshelf/channel/${book.channel!.id}`);
            }}
            className="flex items-center gap-1.5 focus:outline-none hover:text-primary transition-colors focus-visible:ring focus-visible:ring-primary/40 rounded cursor-pointer"
            title={`Visit ${book.channel.name}`}
            aria-label={`Visit ${book.channel.name}`}
          >
            <Avatar className="w-4 h-4 sm:w-5 sm:h-5">
              <AvatarImage src={book.channel.avatar_url || ""} />
              <AvatarFallback className="text-[8px]">
                {book.channel.name.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <span className="text-[10px] sm:text-xs text-muted-foreground truncate">
              {book.channel.name}
            </span>
          </button>
        )}

        {/* Stats */}
        <div className="flex items-center gap-2 mt-1.5 sm:mt-2 text-[10px] sm:text-xs text-muted-foreground">
          <span className="flex items-center gap-0.5">
            <Eye className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
            {formatCount(book.views_count || 0)} views
          </span>
          {book.pages && (
            <span>• {book.pages} pages</span>
          )}
        </div>
      </div>
    </Card>
  );
};

// Memoize to prevent unnecessary re-renders
export default memo(BookCardComponent, (prevProps, nextProps) => {
  return (
    prevProps.rankBadge === nextProps.rankBadge &&
    prevProps.book.id === nextProps.book.id &&
    prevProps.book.title === nextProps.book.title &&
    prevProps.book.author === nextProps.book.author &&
    prevProps.book.views_count === nextProps.book.views_count &&
    prevProps.book.likes_count === nextProps.book.likes_count &&
    prevProps.book.cover_url === nextProps.book.cover_url
  );
});
