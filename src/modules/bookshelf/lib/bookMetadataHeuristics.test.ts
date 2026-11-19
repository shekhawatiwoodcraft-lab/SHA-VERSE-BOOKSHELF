import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoDescription,
  detectCategory,
  detectLanguage,
  extractTitleAuthorFromPageLines,
  isJunkMetadataValue,
  MAX_BULK_BOOKS,
  parseTitleAndAuthorFromFilename,
  validateBulkFileSelection,
} from "./bookMetadataHeuristics";

test("parseTitleAndAuthorFromFilename parses Title - Author, Title by Author, and cleans watermarks", () => {
  assert.deepEqual(parseTitleAndAuthorFromFilename("Atomic Habits - James Clear (z-lib.org).pdf"), {
    title: "Atomic Habits",
    author: "James Clear",
  });
  assert.deepEqual(parseTitleAndAuthorFromFilename("Deep Work by Cal Newport.epub"), {
    title: "Deep Work",
    author: "Cal Newport",
  });
  assert.deepEqual(parseTitleAndAuthorFromFilename("[O'Reilly] learning_typescript_2024 (2024).pdf"), {
    title: "Learning Typescript 2024",
    author: "",
  });
});

test("isJunkMetadataValue rejects Word/Scanner/OS boilerplate while keeping real titles", () => {
  assert.equal(isJunkMetadataValue("Microsoft Word - Document1.docx"), true);
  assert.equal(isJunkMetadataValue("CamScanner 02-11-2025"), true);
  assert.equal(isJunkMetadataValue("Untitled"), true);
  assert.equal(isJunkMetadataValue("Admin"), true);
  assert.equal(isJunkMetadataValue("The Pragmatic Programmer"), false);
  assert.equal(isJunkMetadataValue("Andrew Hunt"), false);
});

test("extractTitleAuthorFromPageLines selects largest font lines for title and finds byline author", () => {
  const result = extractTitleAuthorFromPageLines([
    {
      pageNumber: 1,
      lines: [
        { text: "CLEAN", fontSize: 32 },
        { text: "ARCHITECTURE", fontSize: 32 },
        { text: "A Craftsman's Guide to Software Structure", fontSize: 16 },
        { text: "by Robert C. Martin", fontSize: 18 },
      ],
    },
  ]);
  assert.equal(result.title, "Clean Architecture");
  assert.equal(result.author, "Robert C. Martin");
});

test("detectLanguage detects English, Hindi, Urdu, Arabic, Spanish, Japanese accurately even against bogus metadata", () => {
  assert.equal(
    detectLanguage(
      "यह पुस्तक जीवन के सिद्धांतों और सफलता के मार्ग को स्पष्ट करती है। मनुष्य को निरंतर प्रयास करना चाहिए।",
      "en"
    ),
    "Hindi"
  );
  assert.equal(
    detectLanguage(
      "یہ کتاب اردو ادب اور شاعری کے بارے میں ہے اور اس میں بہت سے مضامین شامل ہیں جو پڑھنے والوں کے لیے مفید ہیں۔",
      "en"
    ),
    "Urdu"
  );
  assert.equal(
    detectLanguage(
      "El conocimiento científico y la historia de las civilizaciones humanas muestran cómo el progreso transforma el mundo para todos.",
      null
    ),
    "Spanish"
  );
  assert.equal(
    detectLanguage(
      "Software engineering focuses on building reliable, maintainable systems with clear interfaces and thorough automated testing.",
      "en-US"
    ),
    "English"
  );
});

test("detectCategory classifies books accurately across categories", () => {
  assert.equal(
    detectCategory({
      title: "Learning TypeScript & React Microservices",
      description: "A practical guide to full-stack web development and software architecture.",
    }),
    "Technology"
  );
  assert.equal(
    detectCategory({
      title: "Tafsir & Seerah Studies",
      description: "Detailed commentary on the Quran and Hadith.",
    }),
    "Religion"
  );
  assert.equal(
    detectCategory({
      title: "Diwan-e-Ghalib",
      subjects: ["Urdu Poetry", "Ghazal"],
    }),
    "Poetry"
  );
  assert.equal(
    detectCategory({
      title: "Quantum Mechanics Fundamentals",
      description: "Physics, wave functions, thermodynamics, and relativity experiments.",
    }),
    "Science"
  );
});

test("buildAutoDescription skips TOC/copyright boilerplate and extracts clean paragraphs", () => {
  const sample = [
    "Copyright © 2024 Example Press. All rights reserved.",
    "Chapter 1 ..... 12\nChapter 2 ..... 28",
    "Modern software teams succeed when architecture remains adaptable and easy to verify. This book walks step by step through modular design principles used in large-scale systems.",
  ].join("\n\n");

  const desc = buildAutoDescription({
    title: "Modular Systems",
    author: "Jane Doe",
    sampleText: sample,
    pages: 240,
    language: "English",
    category: "Technology",
  });

  assert.ok(desc.includes("Modern software teams succeed"));
  assert.ok(!desc.includes("All rights reserved"));
  assert.ok(!desc.includes("....."));
});

test("validateBulkFileSelection enforces max 20 books, file size, extension, and dedupe", () => {
  const mkFile = (name: string, size = 1024) =>
    ({ name, size } as unknown as File);

  const files25 = Array.from({ length: 25 }, (_, i) => mkFile(`Book_${i + 1}.pdf`, 2048));
  const res = validateBulkFileSelection([], files25);
  assert.equal(res.accepted.length, MAX_BULK_BOOKS);
  assert.equal(res.cappedCount, 5);

  const dupAndBad = validateBulkFileSelection(
    [{ name: "Book_1.pdf", size: 2048 }],
    [
      mkFile("Book_1.pdf", 2048),
      mkFile("virus.exe", 500),
      mkFile("empty.pdf", 0),
      mkFile("Book_2.epub", 4096),
    ]
  );
  assert.equal(dupAndBad.accepted.length, 1);
  assert.equal(dupAndBad.accepted[0].name, "Book_2.epub");
  assert.equal(dupAndBad.rejectedReasons.length, 3);
});
