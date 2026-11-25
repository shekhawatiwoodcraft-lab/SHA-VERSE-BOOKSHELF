import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Download, Upload, Search, Loader2, CheckCircle2, AlertTriangle, BookPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { buildAiApiUrl } from "@/lib/ai/apiBase";
import {
  parseAndValidateBookImport,
  serializeBooksToCsv,
  type ValidatedImportRow,
} from "@/modules/bookshelf/lib/libraryWorkspace";
import type { WorkspaceBookItem } from "@/hooks/useLibraryWorkspace";

interface IsbnLookupResult {
  isbn: string;
  title: string;
  subtitle?: string;
  author: string;
  publisher?: string;
  publicationDate?: string;
  pages?: number;
  coverUrl?: string;
  description?: string;
  subjects?: string[];
}

interface ImportExportTabProps {
  books: WorkspaceBookItem[];
  userChannelId?: string;
  userId?: string;
}

export function ImportExportTab({ books, userChannelId, userId }: ImportExportTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isbnQuery, setIsbnQuery] = useState("");
  const [isbnLoading, setIsbnLoading] = useState(false);
  const [isbnResult, setIsbnResult] = useState<IsbnLookupResult | null>(null);
  const [savingIsbnBook, setSavingIsbnBook] = useState(false);

  const [importRows, setImportRows] = useState<ValidatedImportRow[]>([]);
  const [importing, setImporting] = useState(false);

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csv = serializeBooksToCsv(books);
    downloadFile(csv, `sha-verse-books-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8;");
    toast({ title: "CSV Exported", description: `${books.length} books exported.` });
  };

  const handleExportJson = () => {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), count: books.length, books }, null, 2);
    downloadFile(payload, `sha-verse-books-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
    toast({ title: "JSON Exported", description: `${books.length} books exported.` });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const format = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
      const parsed = parseAndValidateBookImport(text, format, books);
      setImportRows(parsed);
      if (parsed.length === 0) {
        toast({ title: "No Rows Detected", description: "Upload a CSV or JSON file with title and author fields.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Invalid Import File", description: "Could not parse the selected file.", variant: "destructive" });
    }
  };

  const handleConfirmImport = async () => {
    const readyRows = importRows.filter((r) => r.status === "ready");
    if (readyRows.length === 0) return;
    if (!userChannelId) {
      toast({
        title: "Author Channel Required",
        description: "Create your Author Channel from Bookshelf first so imported books have an owner catalog.",
        variant: "destructive",
      });
      return;
    }

    setImporting(true);
    try {
      const payload = readyRows.map((row) => ({
        channel_id: userChannelId,
        title: row.title,
        author: row.author,
        category: row.category,
        language: row.language,
        pages: row.pages ?? null,
        description: row.description ?? null,
        visibility: "public",
      }));
      const { error } = await supabase.from("books").insert(payload as never);
      if (error) throw error;
      toast({ title: "Import Complete", description: `${readyRows.length} books added to your bookshelf.` });
      setImportRows([]);
      void queryClient.invalidateQueries({ queryKey: ["workspace-books", userId] });
      void queryClient.invalidateQueries({ queryKey: ["books"] });
    } catch (err) {
      toast({
        title: "Import Failed",
        description: err instanceof Error ? err.message : "Could not insert imported books.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const handleLookupIsbn = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = isbnQuery.replace(/[^0-9Xx]/g, "");
    if (!cleaned) return;
    setIsbnLoading(true);
    setIsbnResult(null);
    try {
      const resp = await fetch(
        buildAiApiUrl(
          `/api/v1/books/lookup-isbn/${encodeURIComponent(cleaned)}`,
          import.meta.env.VITE_API_BASE_URL,
        ),
      );
      const body = (await resp.json()) as IsbnLookupResult & { error?: string };
      if (!resp.ok) throw new Error(body.error || "Lookup failed");
      setIsbnResult(body);
    } catch (err) {
      toast({
        title: "ISBN Lookup Failed",
        description: err instanceof Error ? err.message : "Book metadata not found.",
        variant: "destructive",
      });
    } finally {
      setIsbnLoading(false);
    }
  };

  const handleSaveIsbnBook = async () => {
    if (!isbnResult) return;
    if (!userChannelId) {
      toast({
        title: "Author Channel Required",
        description: "Create your Author Channel first on the Bookshelf page.",
        variant: "destructive",
      });
      return;
    }
    setSavingIsbnBook(true);
    try {
      const { error } = await supabase.from("books").insert({
        channel_id: userChannelId,
        title: isbnResult.title || `ISBN ${isbnResult.isbn}`,
        author: isbnResult.author || "Unknown Author",
        description: isbnResult.description || isbnResult.subtitle || null,
        category: "Education",
        language: "English",
        pages: isbnResult.pages ?? null,
        cover_url: isbnResult.coverUrl || null,
        visibility: "public",
      } as never);
      if (error) throw error;
      toast({ title: "Book Added", description: `"${isbnResult.title}" saved to your catalog.` });
      setIsbnResult(null);
      setIsbnQuery("");
      void queryClient.invalidateQueries({ queryKey: ["workspace-books", userId] });
      void queryClient.invalidateQueries({ queryKey: ["books"] });
    } catch (err) {
      toast({
        title: "Save Failed",
        description: err instanceof Error ? err.message : "Could not add book.",
        variant: "destructive",
      });
    } finally {
      setSavingIsbnBook(false);
    }
  };

  const readyCount = importRows.filter((r) => r.status === "ready").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold">Export Catalog</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Download your full catalog ({books.length} books) for backup or migration.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleExportCsv} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
            <Button onClick={handleExportJson} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Export JSON
            </Button>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold">ISBN Metadata Lookup</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Auto-fetch title, author, publisher, pages, and cover from ISBN-10 or ISBN-13.
            </p>
          </div>
          <form onSubmit={handleLookupIsbn} className="flex gap-2">
            <Input
              value={isbnQuery}
              onChange={(e) => setIsbnQuery(e.target.value)}
              placeholder="e.g. 9780140328721"
              aria-label="ISBN number"
            />
            <Button type="submit" disabled={isbnLoading || !isbnQuery.trim()} className="gap-1.5 shrink-0">
              {isbnLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Lookup
            </Button>
          </form>

          {isbnResult && (
            <div className="rounded-lg border p-3 flex gap-3 items-start bg-muted/30">
              {isbnResult.coverUrl && (
                <img src={isbnResult.coverUrl} alt={isbnResult.title} className="w-12 h-16 object-cover rounded shrink-0" />
              )}
              <div className="flex-1 min-w-0 space-y-1">
                <p className="font-semibold text-sm line-clamp-1">{isbnResult.title}</p>
                <p className="text-xs text-muted-foreground">
                  {isbnResult.author || "Unknown Author"}
                  {isbnResult.pages ? ` · ${isbnResult.pages} pages` : ""}
                </p>
                {isbnResult.publisher && (
                  <p className="text-[11px] text-muted-foreground">{isbnResult.publisher}</p>
                )}
                <Button size="sm" onClick={handleSaveIsbnBook} disabled={savingIsbnBook} className="mt-2 gap-1.5">
                  <BookPlus className="w-3.5 h-3.5" />
                  {savingIsbnBook ? "Saving..." : "Add to Catalog"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">Import Books (CSV / JSON)</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Expected columns: title, author, category, language, pages, description. Duplicates and invalid rows are flagged before import.
            </p>
          </div>
          <Label className="cursor-pointer inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
            <Upload className="w-4 h-4" />
            Choose CSV or JSON
            <input type="file" accept=".csv,.json,text/csv,application/json" onChange={handleFileChange} className="sr-only" />
          </Label>
        </div>

        {importRows.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                Previewing {importRows.length} rows · <strong className="text-foreground">{readyCount} ready to import</strong>
              </div>
              <Button onClick={handleConfirmImport} disabled={importing || readyCount === 0} size="sm">
                {importing ? "Importing..." : `Import ${readyCount} Books`}
              </Button>
            </div>
            <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
              {importRows.map((row) => (
                <div key={row.rowNumber} className="p-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      #{row.rowNumber}: {row.title || "(missing title)"} — {row.author || "(missing author)"}
                    </p>
                    {row.error && <p className="text-destructive">{row.error}</p>}
                  </div>
                  <Badge
                    variant={row.status === "ready" ? "default" : row.status === "duplicate" ? "secondary" : "destructive"}
                    className="shrink-0 gap-1"
                  >
                    {row.status === "ready" ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <AlertTriangle className="w-3 h-3" />
                    )}
                    {row.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
