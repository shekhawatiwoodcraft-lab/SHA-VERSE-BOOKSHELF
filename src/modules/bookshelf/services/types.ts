export interface BookSummary {
  id: string;
  title: string;
  author?: string | null;
  description?: string | null;
  cover_url?: string | null;
  file_url?: string | null;
  file_type?: 'epub' | 'pdf' | string;
  channel_id: string;
  visibility?: string;
  views_count?: number;
  likes_count?: number;
  created_at: string;
}

export interface IBookshelfService {
  listPublicBooks(params?: { category?: string; limit?: number }): Promise<BookSummary[]>;
  getBookById(bookId: string): Promise<BookSummary | null>;
  saveReadingProgress(params: {
    bookId: string;
    userId: string;
    progress: number;
    location?: string;
  }): Promise<void>;
}
