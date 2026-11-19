import { BOOK_CATEGORIES, type BookCategory } from "@/lib/constants/bookshelf";
import { WORLD_LANGUAGES } from "@/lib/constants/languages";

export const MAX_BULK_BOOKS = 20;
export const MAX_BOOK_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB (matches storage limit)
export const SUPPORTED_BOOK_EXTENSIONS = ["pdf", "epub", "mobi", "txt"] as const;

export interface PageLineSample {
  text: string;
  fontSize: number;
}

export interface PageTextSample {
  pageNumber: number;
  lines: PageLineSample[];
}

export interface DetectedBookMetadata {
  title: string;
  author: string;
  category: BookCategory;
  language: string;
  description: string;
  pages: number;
  subjects: string[];
  sampleText: string;
}

const VALID_LANGUAGES_SET = new Set<string>(WORLD_LANGUAGES);

const ISO_TO_WORLD_LANGUAGE: Record<string, string> = {
  en: "English",
  eng: "English",
  hi: "Hindi",
  hin: "Hindi",
  ur: "Urdu",
  urd: "Urdu",
  ar: "Arabic",
  ara: "Arabic",
  fa: "Farsi",
  fas: "Farsi",
  per: "Farsi",
  bn: "Bengali",
  ben: "Bengali",
  pa: "Punjabi",
  pan: "Punjabi",
  mr: "Marathi",
  mar: "Marathi",
  gu: "Gujarati",
  guj: "Gujarati",
  ta: "Tamil",
  tam: "Tamil",
  te: "Telugu",
  tel: "Telugu",
  kn: "Kannada",
  kan: "Kannada",
  zh: "Mandarin Chinese",
  zho: "Mandarin Chinese",
  chi: "Mandarin Chinese",
  ja: "Japanese",
  jpn: "Japanese",
  ko: "Korean",
  kor: "Korean",
  ru: "Russian",
  rus: "Russian",
  uk: "Ukrainian",
  ukr: "Ukrainian",
  es: "Spanish",
  spa: "Spanish",
  fr: "French",
  fra: "French",
  fre: "French",
  de: "German",
  deu: "German",
  ger: "German",
  pt: "Portuguese",
  por: "Portuguese",
  it: "Italian",
  ita: "Italian",
  tr: "Turkish",
  tur: "Turkish",
  nl: "Dutch",
  nld: "Dutch",
  dut: "Dutch",
  pl: "Polish",
  pol: "Polish",
  vi: "Vietnamese",
  vie: "Vietnamese",
  th: "Thai",
  tha: "Thai",
  id: "Indonesian",
  ind: "Indonesian",
  ms: "Malay",
  msa: "Malay",
  may: "Malay",
  he: "Hebrew",
  heb: "Hebrew",
  el: "Greek",
  ell: "Greek",
  gre: "Greek",
  sv: "Swedish",
  swe: "Swedish",
  no: "Norwegian",
  nb: "Norwegian",
  nn: "Norwegian",
  da: "Danish",
  dan: "Danish",
  fi: "Finnish",
  fin: "Finnish",
  ro: "Romanian",
  ron: "Romanian",
  rum: "Romanian",
  hu: "Hungarian",
  hun: "Hungarian",
  cs: "Czech",
  ces: "Czech",
  cze: "Czech",
  bg: "Bulgarian",
  bul: "Bulgarian",
  hr: "Croatian",
  sr: "Serbian",
  sk: "Slovak",
  sl: "Slovenian",
  ca: "Catalan",
  af: "Afrikaans",
  sw: "Swahili",
  tl: "Filipino",
  fil: "Filipino",
};

const JUNK_METADATA_PATTERNS: RegExp[] = [
  /^untitled(\s+\d+)?$/i,
  /^document\s*\d*$/i,
  /^doc\s*\d*$/i,
  /^book\s*\d*$/i,
  /^presentation\s*\d*$/i,
  /^slide\s*\d*$/i,
  /^microsoft\s+(word|powerpoint|excel)/i,
  /^adobe\s+(acrobat|indesign|illustrator|photoshop)/i,
  /^camscanner/i,
  /^ilovepdf/i,
  /^smallpdf/i,
  /^pdfcreator/i,
  /^libreoffice/i,
  /^openoffice/i,
  /^calibre/i,
  /^latex/i,
  /^tex$/i,
  /^scanned\s+document/i,
  /^admin(istrator)?$/i,
  /^user$/i,
  /^owner$/i,
  /^windows\s+user$/i,
  /^hp$/i,
  /^dell$/i,
  /^lenovo$/i,
  /^asus$/i,
  /^unknown$/i,
  /^n\/?a$/i,
  /^none$/i,
  /^[a-z]:\\/i,
  /\.(pdf|epub|mobi|docx?|pptx?|txt)$/i,
  /^\d{4}[-_/]\d{2}[-_/]\d{2}/,
];

export function cleanTextWhitespace(input: string): string {
  return input.split("\0").join("").replace(/\s+/g, " ").trim();
}

export function stripHtmlTags(input: string): string {
  return cleanTextWhitespace(
    input
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
  );
}

/**
 * Rejects common garbage strings injected by Word, Scanners, OS usernames, or PDF converters.
 */
export function isJunkMetadataValue(raw?: string | null): boolean {
  if (!raw) return true;
  const val = cleanTextWhitespace(raw);
  if (val.length < 2 || val.length > 180) return true;
  if (/^\d+$/.test(val)) return true;
  if (/^[\W_]+$/.test(val)) return true;
  return JUNK_METADATA_PATTERNS.some((re) => re.test(val));
}

function toTitleCaseIfFlat(value: string): string {
  const letters = value.replace(/[^a-zA-Z]/g, "");
  if (!letters) return value;
  const isAllUpper = letters === letters.toUpperCase();
  const isAllLower = letters === letters.toLowerCase();
  if (!isAllUpper && !isAllLower) return value;

  const minorWords = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
  return value
    .split(/\s+/)
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && minorWords.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * Cleans book filenames such as "Atomic_Habits_-_James_Clear_(z-lib.org).pdf"
 * into accurate Title and Author guesses.
 */
export function parseTitleAndAuthorFromFilename(filename: string): { title: string; author: string } {
  let base = filename.replace(/\.[^/.]+$/, "");
  // Remove common library/site watermarks and bracketed metadata tags
  base = base
    .replace(/\((?:z-lib\.org|pdfdrive(?:\.com)?|oceanofpdf(?:\.com)?|libgen[^)]*|anna'?s\s*archive[^)]*|1lib[^)]*|b-ok[^)]*)\)/gi, " ")
    .replace(/\[(?:z-lib\.org|pdfdrive|oceanofpdf|ebook|pdf|epub|retail|v\d+(?:\.\d+)?)\]/gi, " ")
    .replace(/_(?:oceanofpdf|z-lib|pdfdrive)(?:_com)?_/gi, " ")
    .replace(/\(\s*(?:19|20)\d{2}\s*\)\s*$/g, " ")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip trailing publisher bracket "[O'Reilly]" or leading "[Series]"
  base = base.replace(/^\[[^\]]+\]\s*/g, "").replace(/\s*\[[^\]]+\]$/g, "").trim();

  let title = base;
  let author = "";

  // Pattern 1: "Title by Author"
  const byMatch = /^(.{3,}?)\s+by\s+([^\s()[\]][^()[\]]{2,60})$/i.exec(base);
  if (byMatch) {
    title = byMatch[1].trim();
    author = byMatch[2].trim();
  } else {
    // Pattern 2: "Title - Author" or "Title — Author"
    const dashParts = base.split(/\s+[-–—]\s+/);
    if (dashParts.length >= 2) {
      const last = dashParts[dashParts.length - 1].trim();
      const first = dashParts.slice(0, -1).join(" - ").trim();
      // If the right-hand part looks like a person's name (2-4 words, no digits, short)
      const wordCount = last.split(/\s+/).length;
      if (first.length >= 2 && last.length >= 3 && last.length <= 50 && wordCount <= 5 && !/\d/.test(last)) {
        title = first;
        author = last;
      }
    }
  }

  title = cleanTextWhitespace(title.replace(/^[-–—.\s]+|[-–—.\s]+$/g, ""));
  author = cleanTextWhitespace(author.replace(/^[-–—.\s]+|[-–—.\s]+$/g, ""));

  return {
    title: toTitleCaseIfFlat(title || "Untitled Book"),
    author: author ? toTitleCaseIfFlat(author) : "",
  };
}

const SKIP_TITLE_LINE_RE =
  /^(table of contents|contents|preface|foreword|acknowledg(e)?ments?|dedication|copyright|all rights reserved|isbn\b|edition\b|published by|chapter\s+\d+|page\s+\d+|\d+|https?:\/\/|www\.)/i;

function cleanAuthorCandidate(raw: string): string {
  return cleanTextWhitespace(
    raw
      .replace(/^(?:written\s+by|authored\s+by|edited\s+by|compiled\s+by|translated\s+by|author\s*:|by\s+|लेखक\s*(?::|ः|-)?|مصنف\s*(?::|؛|-)?)\s*/i, "")
      .replace(/[,;.]\s*(?:ph\.?d\.?|m\.?d\.?|ed\.?|et al\.?).*$/i, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
  );
}

function looksLikePersonName(text: string): boolean {
  const cleaned = cleanTextWhitespace(text);
  if (!cleaned || cleaned.length < 3 || cleaned.length > 60) return false;
  if (/\d|https?:|www\.|@|isbn|copyright|all rights reserved|edition|press|university|chapter/i.test(cleaned)) {
    return false;
  }
  const words = cleaned.split(/\s+/);
  if (words.length > 6) return false;
  return true;
}

/**
 * Extracts Title and Author directly from the visual typography & text of the first 1-3 PDF pages.
 */
export function extractTitleAuthorFromPageLines(pages: PageTextSample[]): {
  title?: string;
  author?: string;
} {
  let title: string | undefined;
  let author: string | undefined;

  const frontPages = pages.filter((p) => p.pageNumber >= 1 && p.pageNumber <= 3);

  // 1) Look for Title on Page 1 (or Page 2 if Page 1 has no text, e.g. image-only cover)
  for (const page of frontPages.slice(0, 2)) {
    const validLines = page.lines
      .map((l) => ({ text: cleanTextWhitespace(l.text), fontSize: l.fontSize }))
      .filter((l) => l.text.length >= 2 && l.text.length <= 120 && !SKIP_TITLE_LINE_RE.test(l.text));

    if (validLines.length === 0) continue;

    const maxFont = Math.max(...validLines.map((l) => l.fontSize || 12));
    // Collect top prominent lines within 82% of max font size (handles wrapped 2-3 line titles)
    const titleLines: string[] = [];
    let titleLastIndex = -1;
    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i];
      if ((line.fontSize || 12) >= maxFont * 0.82 && !/^(by|author)\b/i.test(line.text)) {
        if (titleLines.length === 0 || i === titleLastIndex + 1) {
          titleLines.push(line.text);
          titleLastIndex = i;
          if (titleLines.length >= 3) break;
        }
      } else if (titleLines.length > 0) {
        break;
      }
    }

    if (titleLines.length > 0) {
      const candidate = cleanTextWhitespace(titleLines.join(" "));
      if (!isJunkMetadataValue(candidate) && candidate.length <= 140) {
        title = toTitleCaseIfFlat(candidate);
      }
    }

    // Check lines right after title for "by Author" or a smaller-font author name
    for (let i = Math.max(0, titleLastIndex + 1); i < Math.min(validLines.length, titleLastIndex + 6); i++) {
      const lineText = validLines[i].text;
      if (/^(?:by|written\s+by|author\s*:|लेखक\s*(?::|ः|-)?|مصنف\s*(?::|؛|-)?)\s+/i.test(lineText)) {
        const cand = cleanAuthorCandidate(lineText);
        if (looksLikePersonName(cand) && !isJunkMetadataValue(cand)) {
          author = toTitleCaseIfFlat(cand);
          break;
        }
      }
      // Handle standalone "by" on one line followed by author name on next line
      if (/^by$/i.test(lineText) && validLines[i + 1]) {
        const cand = cleanAuthorCandidate(validLines[i + 1].text);
        if (looksLikePersonName(cand) && !isJunkMetadataValue(cand)) {
          author = toTitleCaseIfFlat(cand);
          break;
        }
      }
    }

    if (title) break;
  }

  // 2) Scan explicit author patterns across Pages 1-3 (cover, title page, copyright page)
  if (!author) {
    for (const page of frontPages) {
      for (let i = 0; i < page.lines.length; i++) {
        const text = cleanTextWhitespace(page.lines[i].text);
        const copyrightBy = /copyright\s*(?:©|\(c\))?\s*(?:19|20)\d{2}\s*(?:by\s+)?([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,3})/.exec(text);
        if (copyrightBy) {
          const cand = cleanAuthorCandidate(copyrightBy[1]);
          if (looksLikePersonName(cand) && !isJunkMetadataValue(cand)) {
            author = cand;
            break;
          }
        }
        const explicitBy = /^(?:written\s+by|authored\s+by|author\s*:|by\s+|लेखक\s*(?::|ः|-)?|مصنف\s*(?::|؛|-)?)\s*(.{3,60})$/i.exec(text);
        if (explicitBy) {
          const cand = cleanAuthorCandidate(explicitBy[1]);
          if (looksLikePersonName(cand) && !isJunkMetadataValue(cand) && cand !== title) {
            author = toTitleCaseIfFlat(cand);
            break;
          }
        }
      }
      if (author) break;
    }
  }

  return { title, author };
}

function mapMetadataLanguage(rawLang?: string | null): string | null {
  if (!rawLang) return null;
  const cleaned = cleanTextWhitespace(rawLang);
  if (!cleaned) return null;

  // Direct match against WORLD_LANGUAGES (case-insensitive)
  const lower = cleaned.toLowerCase();
  for (const lang of WORLD_LANGUAGES) {
    if (lang.toLowerCase() === lower) return lang;
  }
  if (lower === "chinese" || lower === "zh-cn" || lower === "zh-hans" || lower === "zh-tw") {
    return "Mandarin Chinese";
  }

  // ISO code prefix (e.g., "en-US" -> "en")
  const iso = lower.split(/[-_]/)[0];
  if (ISO_TO_WORLD_LANGUAGE[iso]) {
    return ISO_TO_WORLD_LANGUAGE[iso];
  }
  return null;
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * Accurately detects document language from script Unicode ranges + stopword frequency,
 * verifying against metadata language (corrects wrong "en" metadata on Hindi/Urdu/Arabic PDFs).
 */
export function detectLanguage(text: string, metadataLang?: string | null): string {
  const sample = (text || "").slice(0, 8000);
  const metaMapped = mapMetadataLanguage(metadataLang);

  // Script character counts
  const devanagari = countMatches(sample, /[\u0900-\u097F]/g);
  const arabicScript = countMatches(sample, /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g);
  const bengali = countMatches(sample, /[\u0980-\u09FF]/g);
  const gurmukhi = countMatches(sample, /[\u0A00-\u0A7F]/g);
  const gujarati = countMatches(sample, /[\u0A80-\u0AFF]/g);
  const tamil = countMatches(sample, /[\u0B80-\u0BFF]/g);
  const telugu = countMatches(sample, /[\u0C00-\u0C7F]/g);
  const kannada = countMatches(sample, /[\u0C80-\u0CFF]/g);
  const hangul = countMatches(sample, /[\uAC00-\uD7AF]/g);
  const kana = countMatches(sample, /[\u3040-\u30FF]/g);
  const cjk = countMatches(sample, /[\u4E00-\u9FFF]/g);
  const cyrillic = countMatches(sample, /[\u0400-\u04FF]/g);
  const greek = countMatches(sample, /[\u0370-\u03FF]/g);
  const hebrew = countMatches(sample, /[\u0590-\u05FF]/g);
  const thai = countMatches(sample, /[\u0E00-\u0E7F]/g);
  const latin = countMatches(sample, /[A-Za-zÀ-ÖØ-öø-ÿ]/g);

  const nonLatinTotal =
    devanagari + arabicScript + bengali + gurmukhi + gujarati + tamil + telugu +
    kannada + hangul + kana + cjk + cyrillic + greek + hebrew + thai;

  // Dominant non-Latin script wins even if PDF software injected bogus "en" metadata
  if (nonLatinTotal >= 20 && nonLatinTotal >= latin * 0.25) {
    if (devanagari >= nonLatinTotal * 0.4) {
      if (metaMapped === "Marathi") return "Marathi";
      const marathiHits = countMatches(sample, /(?:आहे|आहेत|नाही|तुम्ही|माझ्या|मध्ये|करण्यात|त्यांनी|झाले)/g);
      return marathiHits >= 3 ? "Marathi" : "Hindi";
    }
    if (arabicScript >= nonLatinTotal * 0.4) {
      if (metaMapped === "Urdu" || metaMapped === "Farsi" || metaMapped === "Arabic") {
        return metaMapped;
      }
      // Distinguish Urdu vs Farsi vs Arabic
      const urduChars = countMatches(sample, /[ٹڈڑںہھیےگپچژ]/g);
      const urduWords = countMatches(sample, /(?:^|\s)(?:اور|ہے|ہیں|میں|سے|کو|کا|کی|کے|نہیں|تھا|تھی|کرتے|کرنا)(?=\s|$)/g);
      const farsiWords = countMatches(sample, /(?:^|\s)(?:است|این|برای|می|شود|های|یک|را|با|در)(?=\s|$)/g);
      if (urduWords >= 2 || (urduChars >= 4 && urduWords >= farsiWords)) return "Urdu";
      if (farsiWords >= 3) return "Farsi";
      return "Arabic";
    }
    if (bengali >= nonLatinTotal * 0.4) return "Bengali";
    if (gurmukhi >= nonLatinTotal * 0.4) return "Punjabi";
    if (gujarati >= nonLatinTotal * 0.4) return "Gujarati";
    if (tamil >= nonLatinTotal * 0.4) return "Tamil";
    if (telugu >= nonLatinTotal * 0.4) return "Telugu";
    if (kannada >= nonLatinTotal * 0.4) return "Kannada";
    if (hangul >= 15) return "Korean";
    if (kana >= 10) return "Japanese";
    if (cjk >= 15) return "Mandarin Chinese";
    if (cyrillic >= nonLatinTotal * 0.4) {
      if (metaMapped === "Ukrainian") return "Ukrainian";
      const ukrChars = countMatches(sample, /[єіїґЄІЇҐ]/g);
      return ukrChars >= 2 ? "Ukrainian" : "Russian";
    }
    if (greek >= nonLatinTotal * 0.4) return "Greek";
    if (hebrew >= nonLatinTotal * 0.4) return "Hebrew";
    if (thai >= nonLatinTotal * 0.4) return "Thai";
  }

  // If metadata explicitly specified a valid non-default language and text doesn't contradict it
  if (metaMapped && VALID_LANGUAGES_SET.has(metaMapped)) {
    return metaMapped;
  }

  // Latin-script stopword frequency detection
  if (latin >= 30) {
    const lowerText = ` ${sample.toLowerCase()} `;
    const langStopwords: Array<{ lang: string; words: string[] }> = [
      { lang: "English", words: [" the ", " and ", " of ", " that ", " with ", " this ", " from ", " have ", " which ", " you "] },
      { lang: "Spanish", words: [" el ", " la ", " los ", " las ", " que ", " una ", " por ", " para ", " con ", " del "] },
      { lang: "French", words: [" le ", " la ", " les ", " des ", " une ", " dans ", " pour ", " avec ", " sur ", " est "] },
      { lang: "German", words: [" der ", " die ", " das ", " und ", " ist ", " ein ", " eine ", " mit ", " nicht ", " auf "] },
      { lang: "Portuguese", words: [" que ", " não ", " uma ", " para ", " com ", " por ", " dos ", " das ", " mais ", " como "] },
      { lang: "Italian", words: [" che ", " della ", " delle ", " una ", " per ", " con ", " sono ", " nel ", " gli ", " questo "] },
      { lang: "Indonesian", words: [" yang ", " dan ", " untuk ", " dengan ", " dari ", " dalam ", " tidak ", " pada ", " adalah ", " ini "] },
      { lang: "Turkish", words: [" bir ", " ve ", " bu ", " için ", " ile ", " olan ", " olarak ", " daha ", " gibi ", " ama "] },
      { lang: "Dutch", words: [" het ", " een ", " van ", " voor ", " met ", " dat ", "zijn", " niet ", " maar ", " naar "] },
    ];

    let bestLang = "English";
    let bestScore = 0;
    for (const entry of langStopwords) {
      let score = 0;
      for (const w of entry.words) {
        if (lowerText.includes(w)) {
          score += Math.min(4, lowerText.split(w).length - 1);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestLang = entry.lang;
      }
    }
    if (bestScore >= 3) return bestLang;
  }

  return "English";
}

const CATEGORY_KEYWORDS: Record<BookCategory, string[]> = {
  Technology: [
    "programming", "software", "javascript", "typescript", "python", "java", "coding",
    "developer", "algorithm", "algorithms", "database", "sql", "react", "cloud computing",
    "cybersecurity", "machine learning", "artificial intelligence", "deep learning", "neural network",
    "computer science", "linux", "web development", "api", "microservices", "devops",
  ],
  Science: [
    "physics", "chemistry", "biology", "quantum", "relativity", "astronomy", "astrophysics",
    "genetics", "evolution", "molecule", "thermodynamics", "mathematics", "calculus", "algebra",
    "geometry", "neuroscience", "scientific", "experiment", "hypothesis", "cosmology", "ecology",
    "विज्ञान", "भौतिकी", "रसायन", "سائنس",
  ],
  Business: [
    "business", "startup", "entrepreneur", "entrepreneurship", "marketing", "finance", "investing",
    "investment", "stock market", "economics", "management", "leadership", "strategy", "valuation",
    "accounting", "revenue", "profit", "venture capital", "negotiation", "corporate", "ecommerce",
  ],
  "Self-Help": [
    "self-help", "self help", "habits", "atomic habits", "mindset", "productivity", "procrastination",
    "mindfulness", "meditation", "emotional intelligence", "discipline", "focus", "happiness",
    "personal growth", "personal development", "time management", "confidence", "overthinking",
  ],
  Motivational: [
    "motivational", "motivation", "inspiration", "inspirational", "succeed", "success principles",
    "dream big", "never give up", "resilience", "winning", "greatness", "unstoppable",
    "प्रेरणा", "सफलता", "کامیابی",
  ],
  Education: [
    "textbook", "syllabus", "curriculum", "workbook", "exam", "examination", "study guide",
    "ncert", "upsc", "jee", "neet", "grammar", "vocabulary", "dictionary", "encyclopedia",
    "tutorial", "lecture notes", "academic", "classroom", "exercises", "solutions", "coursebook",
    "पाठ्यक्रम", "परीक्षा", "تعلیم",
  ],
  Biography: [
    "biography", "autobiography", "memoir", "life story", "letters of", "diaries of",
    "my experiments with truth", "born in", "childhood", "early life", "legacy", "portrait of",
    "जीवनी", "आत्मकथा", "سوانح",
  ],
  History: [
    "history", "historical", "civilization", "empire", "dynasty", "revolution", "world war",
    "ancient", "medieval", "colonial", "independence", "archaeology", "monarchy", "century",
    "इतिहास", "تاریخ", "مغل",
  ],
  Religion: [
    "religion", "spiritual", "spirituality", "quran", "qur'an", "hadith", "tafsir", "fiqh",
    "islamic", "islam", "prophet", "bible", "gospel", "christianity", "theology", "bhagavad gita",
    "vedas", "upanishad", "ramayana", "mahabharata", "hinduism", "buddhism", "dharma", "prayer",
    "सत्संग", "गीता", "قرآن", "حدیث", "اسلام", "دین",
  ],
  Poetry: [
    "poetry", "poems", "poem", "anthology", "sonnet", "sonnets", "verse", "stanza", "haiku",
    "ghazal", "shayari", "nazm", "kavita", "कविता", "शायरी", "شاعری", "غزل", "نظم",
  ],
  Health: [
    "health", "fitness", "nutrition", "diet", "wellness", "exercise", "workout", "medical",
    "medicine", "anatomy", "physiology", "mental health", "sleep", "yoga", "ayurveda",
    "disease", "therapy", "cardiovascular", "healing", "स्वास्थ्य", "صحت",
  ],
  Cooking: [
    "cooking", "cookbook", "recipe", "recipes", "baking", "culinary", "kitchen", "ingredients",
    "tablespoon", "teaspoon", "cuisine", "dessert", "chef", "roast", "simmer", "preheat oven",
    "व्यंजन", "रसोई", "پکوان",
  ],
  Travel: [
    "travel", "travelogue", "itinerary", "backpacking", "expedition", "voyage", "tourism",
    "lonely planet", "destination", "passport", "sightseeing", "wandering", "road trip",
  ],
  Comic: [
    "comic", "comics", "manga", "graphic novel", "superhero", "cartoon", "strip", "anime",
  ],
  Art: [
    "painting", "drawing", "sketching", "sculpture", "architecture", "photography", "design",
    "typography", "illustration", "color theory", "art history", "renaissance", "calligraphy",
  ],
  Fiction: [
    "novel", "fiction", "story", "stories", "short stories", "fantasy", "mystery", "thriller",
    "romance", "detective", "sci-fi", "science fiction", "adventure", "kingdom", "wizard",
    "chapter one", "protagonist", "tale", "fable", "कहानी", "उपन्यास", "ناول", "افسانہ", "کہانی",
  ],
};

/**
 * Classifies a book into one of BOOK_CATEGORIES using weighted keyword evidence
 * across embedded subjects, title, description, and opening sample text.
 */
export function detectCategory(params: {
  title?: string;
  description?: string;
  subjects?: string[];
  sampleText?: string;
}): BookCategory {
  const subjectsText = (params.subjects || []).join(" ").toLowerCase();
  const titleText = (params.title || "").toLowerCase();
  const descText = (params.description || "").toLowerCase();
  const sampleText = (params.sampleText || "").slice(0, 6000).toLowerCase();

  const scores = new Map<BookCategory, number>();
  for (const cat of BOOK_CATEGORIES) scores.set(cat, 0);

  for (const cat of BOOK_CATEGORIES) {
    const keywords = CATEGORY_KEYWORDS[cat] || [];
    let score = 0;

    // Exact category name in subjects or title gets strong boost
    if (subjectsText.includes(cat.toLowerCase())) score += 12;
    if (titleText.includes(cat.toLowerCase())) score += 8;

    for (const kw of keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Use word boundary for ASCII terms, direct substring for non-ASCII scripts
      const isAscii = Array.from(kw).every((ch) => ch.charCodeAt(0) <= 127);
      const re = isAscii ? new RegExp(`\\b${escaped}\\b`, "gi") : new RegExp(escaped, "gi");

      if (subjectsText && re.test(subjectsText)) score += 6;
      re.lastIndex = 0;
      if (titleText && re.test(titleText)) score += 5;
      re.lastIndex = 0;
      if (descText && re.test(descText)) score += 3;
      re.lastIndex = 0;
      if (sampleText) {
        const matches = sampleText.match(re);
        if (matches && matches.length > 0) {
          score += Math.min(4, matches.length) * 1.5;
        }
      }
    }

    scores.set(cat, score);
  }

  let bestCat: BookCategory = "Fiction";
  let bestScore = 0;
  for (const cat of BOOK_CATEGORIES) {
    const s = scores.get(cat) ?? 0;
    if (s > bestScore) {
      bestScore = s;
      bestCat = cat;
    }
  }

  return bestScore > 0 ? bestCat : "Fiction";
}

const BOILERPLATE_PARA_RE =
  /^(copyright\s*©|all rights reserved|isbn\b|library of congress|printed in|first edition|table of contents|contents$|page\s+\d+$|\d+\s*$)/i;

/**
 * Builds a clean, accurate description from embedded synopsis/back-cover metadata
 * or actual opening paragraphs of the book (never inventing plot claims).
 */
export function buildAutoDescription(params: {
  embeddedDesc?: string;
  title: string;
  author: string;
  sampleText: string;
  pages?: number;
  language: string;
  category: string;
}): string {
  const cleanedEmbedded = params.embeddedDesc ? stripHtmlTags(params.embeddedDesc) : "";
  if (cleanedEmbedded.length >= 35 && !isJunkMetadataValue(cleanedEmbedded)) {
    return cleanedEmbedded.slice(0, 600);
  }

  const rawText = (params.sampleText || "").replace(/\r\n/g, "\n");
  // Try explicit "About the Book / Preface / Introduction / Synopsis" section first
  const introSection = /(?:about the book|synopsis|book description|preface|introduction|overview)\s*[:\n]+([\s\S]{60,900})/i.exec(rawText);
  const candidatePool = introSection ? introSection[1] : rawText;

  // Split into meaningful paragraphs, filtering out TOC dot-leaders & copyright boilerplate
  const paragraphs = candidatePool
    .split(/\n{2,}|(?<=[.!?।۔])\s{2,}/)
    .map((p) => cleanTextWhitespace(p))
    .filter((p) => {
      if (p.length < 45) return false;
      if (BOILERPLATE_PARA_RE.test(p)) return false;
      if (/\.{4,}\s*\d+/.test(p)) return false; // TOC dot leaders "Chapter 1 ..... 12"
      if (/https?:\/\/\S+/.test(p) && p.length < 90) return false;
      return true;
    });

  if (paragraphs.length > 0) {
    let combined = "";
    for (const para of paragraphs) {
      if (combined.length >= 360) break;
      combined = combined ? `${combined}\n\n${para}` : para;
    }
    if (combined.length > 550) {
      const cut = combined.slice(0, 540);
      const lastPunct = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("। "), cut.lastIndexOf("۔ "));
      combined = lastPunct > 180 ? cut.slice(0, lastPunct + 1) : `${cut.trim()}...`;
    }
    return combined;
  }

  // Honest factual fallback when document is scanned/image-only with zero extractable text
  const parts: string[] = [params.title];
  if (params.author) parts.push(`by ${params.author}`);
  const metaDetails: string[] = [params.category, params.language];
  if (params.pages && params.pages > 0) metaDetails.push(`${params.pages} pages`);
  return `${parts.join(" ")} (${metaDetails.join(" • ")}).`;
}

export interface BulkValidationResult {
  accepted: File[];
  rejectedReasons: string[];
  cappedCount: number;
}

/**
 * Enforces single (1) vs bulk (max 20) rules, extension checks, size limit, and intra-batch filename+size dedupe.
 */
export function validateBulkFileSelection(
  existingFiles: Array<{ name: string; size: number }>,
  incomingFiles: File[],
  maxBooks = MAX_BULK_BOOKS,
): BulkValidationResult {
  const accepted: File[] = [];
  const rejectedReasons: string[] = [];
  let cappedCount = 0;

  const seenKeys = new Set(existingFiles.map((f) => `${f.name.toLowerCase()}::${f.size}`));

  for (const file of incomingFiles) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!SUPPORTED_BOOK_EXTENSIONS.includes(ext as (typeof SUPPORTED_BOOK_EXTENSIONS)[number])) {
      rejectedReasons.push(`${file.name}: unsupported format (use PDF, EPUB, MOBI, or TXT)`);
      continue;
    }
    if (file.size === 0) {
      rejectedReasons.push(`${file.name}: file is empty`);
      continue;
    }
    if (file.size > MAX_BOOK_FILE_SIZE_BYTES) {
      rejectedReasons.push(`${file.name}: exceeds 100 MB limit`);
      continue;
    }

    const dedupeKey = `${file.name.toLowerCase()}::${file.size}`;
    if (seenKeys.has(dedupeKey)) {
      rejectedReasons.push(`${file.name}: already in upload queue`);
      continue;
    }

    if (existingFiles.length + accepted.length >= maxBooks) {
      cappedCount += 1;
      continue;
    }

    seenKeys.add(dedupeKey);
    accepted.push(file);
  }

  if (cappedCount > 0) {
    rejectedReasons.push(`Maximum ${maxBooks} books allowed per bulk upload (${cappedCount} extra file${cappedCount === 1 ? "" : "s"} skipped).`);
  }

  return { accepted, rejectedReasons, cappedCount };
}
