import { useState, useRef } from "react";
import { Upload, Image, FileText, X, Check, ChevronsUpDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useBooks } from "@/hooks/useBooks";
import { BOOK_CATEGORIES } from "@/lib/constants/bookshelf";
import { WORLD_LANGUAGES } from "@/lib/constants/languages";

interface UploadBookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
}

const UploadBookDialog = ({
  open,
  onOpenChange,
  channelId,
}: UploadBookDialogProps) => {
  const { uploadBook } = useBooks();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [pages, setPages] = useState("");
  const [category, setCategory] = useState<string>(BOOK_CATEGORIES[0]);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [language, setLanguage] = useState<string>("English");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [bookFile, setBookFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const bookInputRef = useRef<HTMLInputElement>(null);

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      setCoverFile(file);
      setCoverPreview(URL.createObjectURL(file));
    }
  };

  const handleBookSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setBookFile(file);
    }
  };

  const handleSubmit = async () => {
    if (!title || !author || !channelId) return;

    await uploadBook.mutateAsync({
      title,
      author,
      description,
      category,
      language,
      coverFile: coverFile || undefined,
      bookFile: bookFile || undefined,
      pages: pages ? parseInt(pages) : undefined,
      channelId,
    });

    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setTitle("");
    setAuthor("");
    setDescription("");
    setPages("");
    setCategory(BOOK_CATEGORIES[0]);
    setLanguage("English");
    setCoverFile(null);
    setBookFile(null);
    setCoverPreview(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 !w-full !h-full !max-w-none !max-h-none !rounded-none !border-0 !p-0 flex flex-col gap-0 overflow-hidden bg-background">
        {/* Sticky Full-Screen Header */}
        <DialogHeader className="px-4 sm:px-8 py-4 pr-14 border-b bg-background/95 backdrop-blur shrink-0 text-left">
          <div className="max-w-5xl mx-auto w-full flex items-center justify-between">
            <DialogTitle className="text-lg sm:text-xl font-bold">Upload Book</DialogTitle>
          </div>
        </DialogHeader>

        {/* Scrollable Full-Screen Form Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-6">
          <div className="max-w-5xl mx-auto w-full grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 lg:gap-8">
            {/* Left Column: Cover Image + Book File */}
            <div className="space-y-5">
              <div>
                <Label>Cover Image</Label>
                <div
                  onClick={() => coverInputRef.current?.click()}
                  className="mt-2 aspect-[2/3] w-[176px] mx-auto lg:mx-0 rounded-xl border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors cursor-pointer flex items-center justify-center overflow-hidden bg-muted/20"
                >
                  {coverPreview ? (
                    <div className="relative w-full h-full">
                      <img
                        src={coverPreview}
                        alt="Cover preview"
                        className="w-full h-full object-cover"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        aria-label="Remove cover image"
                        className="absolute top-2 right-2 h-7 w-7 rounded-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          URL.revokeObjectURL(coverPreview);
                          setCoverFile(null);
                          setCoverPreview(null);
                        }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center p-4">
                      <Image className="w-9 h-9 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm font-medium text-muted-foreground">
                        Click to upload cover
                      </p>
                      <p className="text-xs text-muted-foreground/75 mt-1">
                        JPG, PNG or WebP
                      </p>
                    </div>
                  )}
                </div>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleCoverSelect}
                />
              </div>

              <div>
                <Label>Book File (PDF, EPUB)</Label>
                <div
                  onClick={() => bookInputRef.current?.click()}
                  className="mt-2 p-4 rounded-xl border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors cursor-pointer bg-muted/20"
                >
                  {bookFile ? (
                    <div className="flex items-center gap-3">
                      <FileText className="w-8 h-8 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{bookFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(bookFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove book file"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBookFile(null);
                        }}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-2">
                      <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm font-medium text-muted-foreground">
                        Click to upload book file
                      </p>
                      <p className="text-xs text-muted-foreground/75 mt-1">
                        PDF, EPUB or MOBI
                      </p>
                    </div>
                  )}
                </div>
                <input
                  ref={bookInputRef}
                  type="file"
                  accept=".pdf,.epub,.mobi"
                  className="hidden"
                  onChange={handleBookSelect}
                />
              </div>
            </div>

            {/* Right Column: Metadata Fields */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter book title"
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <Label htmlFor="author">Author *</Label>
                  <Input
                    id="author"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="Enter author name"
                    className="mt-1.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Category *</Label>
                  <Popover open={categoryOpen} onOpenChange={setCategoryOpen} modal={true}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={categoryOpen}
                        className="w-full justify-between font-normal mt-1.5"
                      >
                        {category}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[--radix-popover-trigger-width] p-0 z-[110]"
                      align="start"
                      onWheel={(e) => e.stopPropagation()}
                      onTouchMove={(e) => e.stopPropagation()}
                    >
                      <Command>
                        <CommandInput placeholder="Search categories..." />
                        <CommandList className="max-h-[240px] overflow-y-auto overscroll-contain">
                          <CommandEmpty>No category found.</CommandEmpty>
                          <CommandGroup>
                            {BOOK_CATEGORIES.map((cat) => (
                              <CommandItem
                                key={cat}
                                value={cat}
                                onSelect={() => {
                                  setCategory(cat);
                                  setCategoryOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    category === cat ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                {cat}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <Label>Language *</Label>
                  <Popover open={languageOpen} onOpenChange={setLanguageOpen} modal={true}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={languageOpen}
                        className="w-full justify-between font-normal mt-1.5"
                      >
                        {language}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[--radix-popover-trigger-width] p-0 z-[110]"
                      align="start"
                      onWheel={(e) => e.stopPropagation()}
                      onTouchMove={(e) => e.stopPropagation()}
                    >
                      <Command>
                        <CommandInput placeholder="Search languages..." />
                        <CommandList className="max-h-[240px] overflow-y-auto overscroll-contain">
                          <CommandEmpty>No language found.</CommandEmpty>
                          <CommandGroup>
                            {WORLD_LANGUAGES.map((lang) => (
                              <CommandItem
                                key={lang}
                                value={lang}
                                onSelect={() => {
                                  setLanguage(lang);
                                  setLanguageOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    language === lang ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                {lang}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter book description"
                  rows={5}
                  className="mt-1.5"
                />
              </div>

              <div className="max-w-xs">
                <Label htmlFor="pages">Number of Pages</Label>
                <Input
                  id="pages"
                  type="number"
                  value={pages}
                  onChange={(e) => setPages(e.target.value)}
                  placeholder="e.g., 250"
                  className="mt-1.5"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Sticky Bottom Footer */}
        <div
          className="px-4 sm:px-8 py-4 border-t bg-background/95 backdrop-blur shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}
        >
          <div className="max-w-5xl mx-auto w-full flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1 sm:flex-none sm:min-w-[140px] h-11"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1 sm:flex-none sm:min-w-[180px] h-11"
              onClick={handleSubmit}
              disabled={!title || !author || uploadBook.isPending}
            >
              {uploadBook.isPending ? "Uploading..." : "Upload Book"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UploadBookDialog;
