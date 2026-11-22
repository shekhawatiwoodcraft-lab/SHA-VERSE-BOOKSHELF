import { useEffect, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBookInteractions } from "@/hooks/useBookInteractions";
import { canConfirmPermanentBookDelete } from "@/modules/bookshelf/lib/bookDeletion";

interface BookDeletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookId: string;
  bookTitle: string;
  onDeleted?: () => void;
}

const DELETION_REASONS = [
  { value: "incorrect_upload", label: "Incorrect upload" },
  { value: "copyright_issue", label: "Copyright issue" },
  { value: "want_to_remove", label: "Want to remove" },
  { value: "privacy_issue", label: "Privacy issue" },
  { value: "other", label: "Other" },
];

const BookDeletionDialog = ({
  open,
  onOpenChange,
  bookId,
  bookTitle,
  onDeleted,
}: BookDeletionDialogProps) => {
  const { deleteBookPermanently } = useBookInteractions(bookId);
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  // Always start unchecked when opening or closing so accidental deletions cannot happen
  useEffect(() => {
    if (!open) {
      setConfirmed(false);
      setReason("");
      setDescription("");
    }
  }, [open]);

  const canDelete = canConfirmPermanentBookDelete({
    bookId,
    confirmed,
    isDeleting: deleteBookPermanently.isPending,
  });

  const handleDelete = async () => {
    if (!canDelete) return;
    await deleteBookPermanently.mutateAsync();
    setReason("");
    setDescription("");
    setConfirmed(false);
    onOpenChange(false);
    onDeleted?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="w-5 h-5" />
            Delete Book Permanently
          </DialogTitle>
          <DialogDescription>
            Confirm below to permanently delete "{bookTitle}". This removes the book immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warning */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">
              This action cannot be undone. Once confirmed, this book and its files will be permanently deleted right away.
            </p>
          </div>

          {/* Book Info */}
          <div className="p-3 rounded-lg bg-muted">
            <p className="text-sm"><strong>Book:</strong> {bookTitle}</p>
            <p className="text-xs text-muted-foreground">ID: {bookId}</p>
          </div>

          {/* Optional Reason */}
          <div>
            <Label htmlFor="delete-reason">Reason (optional)</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="delete-reason" className="mt-2">
                <SelectValue placeholder="Select a reason (optional)" />
              </SelectTrigger>
              <SelectContent className="z-[80]">
                {DELETION_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Optional Details */}
          <div>
            <Label htmlFor="delete-description">Additional notes (optional)</Label>
            <Textarea
              id="delete-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
              className="mt-2"
            />
          </div>

          {/* Mandatory Confirmation Checkbox */}
          <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-muted/40">
            <Checkbox
              id="confirm-permanent-delete"
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
              disabled={deleteBookPermanently.isPending}
              className="mt-0.5"
            />
            <Label
              htmlFor="confirm-permanent-delete"
              className="text-sm leading-snug cursor-pointer select-none"
            >
              I confirm that I want to permanently delete this book immediately, and I understand this cannot be undone.
            </Label>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={deleteBookPermanently.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              onClick={handleDelete}
              disabled={!canDelete}
            >
              {deleteBookPermanently.isPending ? "Deleting..." : "Delete Permanently"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BookDeletionDialog;
