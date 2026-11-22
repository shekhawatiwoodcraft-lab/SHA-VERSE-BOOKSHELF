import test from "node:test";
import assert from "node:assert/strict";
import {
  canConfirmPermanentBookDelete,
  extractStorageObjectPath,
} from "./bookDeletion";

test("extractStorageObjectPath extracts Supabase object path from public and signed URLs", () => {
  assert.equal(
    extractStorageObjectPath(
      "https://gkmyhgebjqkdvjzgbrhr.supabase.co/storage/v1/object/public/books/user-1/files/170000_abc.pdf",
      "books",
    ),
    "user-1/files/170000_abc.pdf",
  );
  assert.equal(
    extractStorageObjectPath(
      "https://gkmyhgebjqkdvjzgbrhr.supabase.co/storage/v1/object/sign/books/user-1/covers/my%20cover.jpg?token=xyz",
      "books",
    ),
    "user-1/covers/my cover.jpg",
  );
  assert.equal(
    extractStorageObjectPath("https://www.gutenberg.org/files/1342/1342-h/1342-h.htm", "books"),
    null,
  );
  assert.equal(extractStorageObjectPath(null, "books"), null);
});

test("canConfirmPermanentBookDelete requires confirmation checkbox to be checked", () => {
  assert.equal(
    canConfirmPermanentBookDelete({ bookId: "book-123", confirmed: false, isDeleting: false }),
    false,
  );
  assert.equal(
    canConfirmPermanentBookDelete({ bookId: "book-123", confirmed: true, isDeleting: true }),
    false,
  );
  assert.equal(
    canConfirmPermanentBookDelete({ bookId: "", confirmed: true, isDeleting: false }),
    false,
  );
  assert.equal(
    canConfirmPermanentBookDelete({ bookId: "book-123", confirmed: true, isDeleting: false }),
    true,
  );
});
