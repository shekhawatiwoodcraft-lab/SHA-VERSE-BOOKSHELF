export type LanguageDirection = "ltr" | "rtl";

export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  dir: LanguageDirection;
  previewPhrase: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "af", name: "Afrikaans", nativeName: "Afrikaans", dir: "ltr", previewPhrase: "Welkom by jou meertalige oudioboek-biblioteek." },
  { code: "sq", name: "Albanian", nativeName: "Shqip", dir: "ltr", previewPhrase: "Mirë se vini në bibliotekën tuaj shumëgjuhëshe." },
  { code: "am", name: "Amharic", nativeName: "አማርኛ", dir: "ltr", previewPhrase: "እንኳን ወደ የእርስዎ የመጽሐፍት ቤተ-መጻሕፍት በደህና መጡ።" },
  { code: "ar", name: "Arabic", nativeName: "العربية", dir: "rtl", previewPhrase: "مرحباً بكم في مكتبتكم الصوتية الذكية ومتعددة اللغات." },
  { code: "hy", name: "Armenian", nativeName: "Հայերեն", dir: "ltr", previewPhrase: "Բարի գալուստ ձեր բազմալեզու գրադարան։" },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া", dir: "ltr", previewPhrase: "আপোনাৰ বহুভাষিক পুথিভঁৰাললৈ স্বাগতম।" },
  { code: "az", name: "Azerbaijani", nativeName: "Azərbaycan", dir: "ltr", previewPhrase: "Çoxdilli kitabxananıza xoş gəlmisiniz." },
  { code: "eu", name: "Basque", nativeName: "Euskara", dir: "ltr", previewPhrase: "Ongi etorri zure liburutegi eleaniztunera." },
  { code: "be", name: "Belarusian", nativeName: "Беларуская", dir: "ltr", previewPhrase: "Сардэчна запрашаем у вашу шматмоўную бібліятэку." },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", dir: "ltr", previewPhrase: "আপনার ব্যক্তিগত এআই অডিওবুক এবং বহুভাষিক গ্রন্থাগারে স্বাগতম।" },
  { code: "bs", name: "Bosnian", nativeName: "Bosanski", dir: "ltr", previewPhrase: "Dobrodošli u vašu višejezičnu biblioteku." },
  { code: "bg", name: "Bulgarian", nativeName: "Български", dir: "ltr", previewPhrase: "Добре дошли във вашата многоезична библиотека." },
  { code: "my", name: "Burmese", nativeName: "မြန်မာဘာသာ", dir: "ltr", previewPhrase: "သင့်ရဲ့ ဘာသာစကားစုံ စာကြည့်တိုက်မှ ကြိုဆိုပါတယ်။" },
  { code: "ca", name: "Catalan", nativeName: "Català", dir: "ltr", previewPhrase: "Benvingut a la teva biblioteca multilingüe." },
  { code: "zh", name: "Chinese (Simplified)", nativeName: "简体中文", dir: "ltr", previewPhrase: "欢迎来到您的智能多语言阅读与有声书图书馆。" },
  { code: "zh-tw", name: "Chinese (Traditional)", nativeName: "繁體中文", dir: "ltr", previewPhrase: "歡迎來到您的智慧多語言閱讀與有聲書圖書館。" },
  { code: "hr", name: "Croatian", nativeName: "Hrvatski", dir: "ltr", previewPhrase: "Dobrodošli u vašu višejezičnu knjižnicu." },
  { code: "cs", name: "Czech", nativeName: "Čeština", dir: "ltr", previewPhrase: "Vítejte ve své vícejazyčné knihovně." },
  { code: "da", name: "Danish", nativeName: "Dansk", dir: "ltr", previewPhrase: "Velkommen til dit flersprogede lydbogsbibliotek." },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", dir: "ltr", previewPhrase: "Welkom in uw meertalige lees- en luisterbibliotheek." },
  { code: "en", name: "English", nativeName: "English", dir: "ltr", previewPhrase: "Welcome to your personal AI audiobook and multilingual library." },
  { code: "et", name: "Estonian", nativeName: "Eesti", dir: "ltr", previewPhrase: "Tere tulemast oma mitmekeelsesse raamatukokku." },
  { code: "fil", name: "Filipino", nativeName: "Filipino", dir: "ltr", previewPhrase: "Maligayang pagdating sa iyong aklatang multilingguwal." },
  { code: "fi", name: "Finnish", nativeName: "Suomi", dir: "ltr", previewPhrase: "Tervetuloa monikieliseen äänikirjakirjastoosi." },
  { code: "fr", name: "French", nativeName: "Français", dir: "ltr", previewPhrase: "Bienvenue dans votre bibliothèque multilingue et livre audio." },
  { code: "gl", name: "Galician", nativeName: "Galego", dir: "ltr", previewPhrase: "Benvido á túa biblioteca multilingüe." },
  { code: "ka", name: "Georgian", nativeName: "ქართული", dir: "ltr", previewPhrase: "კეთილი იყოს თქვენი მობრძანება მრავალენოვან ბიბლიოთეკაში." },
  { code: "de", name: "German", nativeName: "Deutsch", dir: "ltr", previewPhrase: "Willkommen in Ihrer mehrsprachigen Hörbuch- und Lesebibliothek." },
  { code: "el", name: "Greek", nativeName: "Ελληνικά", dir: "ltr", previewPhrase: "Καλώς ήρθατε στην πολυγλωσσική βιβλιοθήκη σας." },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", dir: "ltr", previewPhrase: "તમારી બહુભાષી ઑડિયોબુક લાઇબ્રેરીમાં સ્વાગત છે." },
  { code: "ht", name: "Haitian Creole", nativeName: "Kreyòl Ayisyen", dir: "ltr", previewPhrase: "Byenveni nan bibliyotèk miltileng ou a." },
  { code: "ha", name: "Hausa", nativeName: "Hausa", dir: "ltr", previewPhrase: "Barka da zuwa dakin karatu mai harsuna da yawa." },
  { code: "he", name: "Hebrew", nativeName: "עברית", dir: "rtl", previewPhrase: "ברוכים הבאים לספריית הספרים והשמע הרב-לשונית שלכם." },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", dir: "ltr", previewPhrase: "आपकी व्यक्तिगत एआई ऑडियोबुक और बहुभाषी लाइब्रेरी में आपका स्वागत है।" },
  { code: "hu", name: "Hungarian", nativeName: "Magyar", dir: "ltr", previewPhrase: "Üdvözöljük a többnyelvű hangoskönyvtárában." },
  { code: "is", name: "Icelandic", nativeName: "Íslenska", dir: "ltr", previewPhrase: "Velkomin í fjöltyngda bókasafnið þitt." },
  { code: "ig", name: "Igbo", nativeName: "Igbo", dir: "ltr", previewPhrase: "Nnọọ n'ọbá akwụkwọ gị nwere ọtụtụ asụsụ." },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", dir: "ltr", previewPhrase: "Selamat datang di perpustakaan multibahasa dan buku audio Anda." },
  { code: "ga", name: "Irish", nativeName: "Gaeilge", dir: "ltr", previewPhrase: "Fáilte chuig do leabharlann ilteangach." },
  { code: "it", name: "Italian", nativeName: "Italiano", dir: "ltr", previewPhrase: "Benvenuto nella tua biblioteca multilingue e audiolibro." },
  { code: "ja", name: "Japanese", nativeName: "日本語", dir: "ltr", previewPhrase: "多言語読書と自然なAIオーディオブックの図書館へようこそ。" },
  { code: "jv", name: "Javanese", nativeName: "Basa Jawa", dir: "ltr", previewPhrase: "Sugeng rawuh ing perpustakaan multibasa panjenengan." },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", dir: "ltr", previewPhrase: "ನಿಮ್ಮ ಬಹುಭಾಷಾ ಆಡಿಯೋಬುಕ್ ಗ್ರಂಥಾಲಯಕ್ಕೆ ಸ್ವಾಗತ." },
  { code: "kk", name: "Kazakh", nativeName: "Қазақша", dir: "ltr", previewPhrase: "Көптілді кітапханаңызға қош келдіңіз." },
  { code: "km", name: "Khmer", nativeName: "ខ្មែរ", dir: "ltr", previewPhrase: "សូមស្វាគមន៍មកកាន់បណ្ណាល័យពហុភាសារបស់អ្នក។" },
  { code: "ko", name: "Korean", nativeName: "한국어", dir: "ltr", previewPhrase: "자연스러운 AI 오디오북과 다국어 독서 서재에 오신 것을 환영합니다." },
  { code: "ku", name: "Kurdish", nativeName: "کوردی", dir: "rtl", previewPhrase: "بەخێربێن بۆ کتێبخانەی فرەزمانیتان." },
  { code: "ky", name: "Kyrgyz", nativeName: "Кыргызча", dir: "ltr", previewPhrase: "Көп тилдүү китепканаңызга кош келиңиз." },
  { code: "lo", name: "Lao", nativeName: "ລາວ", dir: "ltr", previewPhrase: "ຍິນດີຕ້ອນຮັບສູ່ຫ້ອງສະໝຸດຫຼາຍພາສາຂອງທ່ານ." },
  { code: "la", name: "Latin", nativeName: "Latina", dir: "ltr", previewPhrase: "Salve in bibliothecam tuam multilinguem." },
  { code: "lv", name: "Latvian", nativeName: "Latviešu", dir: "ltr", previewPhrase: "Laipni lūdzam jūsu daudzvalodu bibliotēkā." },
  { code: "lt", name: "Lithuanian", nativeName: "Lietuvių", dir: "ltr", previewPhrase: "Sveiki atvykę į savo daugiakalbę biblioteką." },
  { code: "mk", name: "Macedonian", nativeName: "Македонски", dir: "ltr", previewPhrase: "Добредојдовте во вашата повеќејазична библиотека." },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu", dir: "ltr", previewPhrase: "Selamat datang ke perpustakaan berbilang bahasa anda." },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം", dir: "ltr", previewPhrase: "നിങ്ങളുടെ ബഹുഭാഷാ ഓഡിയോബുക്ക് ലൈബ്രറിയിലേക്ക് സ്വാഗതം." },
  { code: "mt", name: "Maltese", nativeName: "Malti", dir: "ltr", previewPhrase: "Merħba fil-librerija multilingwi tiegħek." },
  { code: "mi", name: "Maori", nativeName: "Te Reo Māori", dir: "ltr", previewPhrase: "Nau mai ki tō whare pukapuka reo maha." },
  { code: "mr", name: "Marathi", nativeName: "मराठी", dir: "ltr", previewPhrase: "तुमच्या बहुभाषिक ऑडिओबुक ग्रंथालयात स्वागत आहे." },
  { code: "mn", name: "Mongolian", nativeName: "Монгол", dir: "ltr", previewPhrase: "Олон хэлний номын санд тавтай морил." },
  { code: "ne", name: "Nepali", nativeName: "नेपाली", dir: "ltr", previewPhrase: "तपाईंको बहुभाषी अडियोबुक पुस्तकालयमा स्वागत छ।" },
  { code: "no", name: "Norwegian", nativeName: "Norsk", dir: "ltr", previewPhrase: "Velkommen til ditt flerspråklige lydbokbibliotek." },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", dir: "ltr", previewPhrase: "ଆପଣଙ୍କ ବହୁଭାଷୀ ଅଡିଓବୁକ୍ ଲାଇବ୍ରେରୀକୁ ସ୍ୱାଗତ।" },
  { code: "ps", name: "Pashto", nativeName: "پښتو", dir: "rtl", previewPhrase: "ستاسو څو ژبني کتابتون ته ښه راغلاست." },
  { code: "fa", name: "Persian", nativeName: "فارسی", dir: "rtl", previewPhrase: "به کتابخانه چندزبانه و کتاب صوتی هوشمند خود خوش آمدید." },
  { code: "pl", name: "Polish", nativeName: "Polski", dir: "ltr", previewPhrase: "Witamy w Twojej wielojęzycznej bibliotece audiobooków." },
  { code: "pt", name: "Portuguese", nativeName: "Português", dir: "ltr", previewPhrase: "Bem-vindo à sua biblioteca multilíngue e audiolivro com voz natural." },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", dir: "ltr", previewPhrase: "ਤੁਹਾਡੀ ਬਹੁ-ਭਾਸ਼ਾਈ ਆਡੀਓਬੁੱਕ ਲਾਇਬ੍ਰੇਰੀ ਵਿੱਚ ਜੀ ਆਇਆਂ ਨੂੰ।" },
  { code: "ro", name: "Romanian", nativeName: "Română", dir: "ltr", previewPhrase: "Bun venit în biblioteca ta multilingvă de cărți audio." },
  { code: "ru", name: "Russian", nativeName: "Русский", dir: "ltr", previewPhrase: "Добро пожаловать в вашу многоязычную библиотеку и аудиокнигу." },
  { code: "sa", name: "Sanskrit", nativeName: "संस्कृतम्", dir: "ltr", previewPhrase: "भवतः बहुभाषिकपुस्तकालये स्वागतम् अस्ति।" },
  { code: "sr", name: "Serbian", nativeName: "Српски", dir: "ltr", previewPhrase: "Добродошли у вашу вишејезичну библиотеку." },
  { code: "sd", name: "Sindhi", nativeName: "سنڌي", dir: "rtl", previewPhrase: "توهان جي گهڻ-لساني آڊيو بڪ لائبريري ۾ ڀليڪار." },
  { code: "si", name: "Sinhala", nativeName: "සිංහල", dir: "ltr", previewPhrase: "ඔබේ බහුභාෂා ශ්‍රව්‍ය පුස්තකාලයට සාදරයෙන් පිළිගනිමු." },
  { code: "sk", name: "Slovak", nativeName: "Slovenčina", dir: "ltr", previewPhrase: "Vitajte vo svojej viacjazyčnej audioknižnici." },
  { code: "sl", name: "Slovenian", nativeName: "Slovenščina", dir: "ltr", previewPhrase: "Dobrodošli v vaši večjezični knjižnici." },
  { code: "so", name: "Somali", nativeName: "Soomaali", dir: "ltr", previewPhrase: "Ku soo dhowow maktabaddaada luuqadaha badan." },
  { code: "es", name: "Spanish", nativeName: "Español", dir: "ltr", previewPhrase: "Bienvenido a tu biblioteca multilingüe y audiolibro con voz natural." },
  { code: "su", name: "Sundanese", nativeName: "Basa Sunda", dir: "ltr", previewPhrase: "Wilujeng sumping di perpustakaan multibasa anjeun." },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili", dir: "ltr", previewPhrase: "Karibu kwenye maktaba yako ya lugha nyingi." },
  { code: "sv", name: "Swedish", nativeName: "Svenska", dir: "ltr", previewPhrase: "Välkommen till ditt flerspråkiga ljudboksbibliotek." },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்", dir: "ltr", previewPhrase: "உங்கள் பன்மொழி ஒலிப்புத்தக நூலகத்திற்கு நல்வரவு." },
  { code: "te", name: "Telugu", nativeName: "తెలుగు", dir: "ltr", previewPhrase: "మీ బహుభాషా ఆడియోబుక్ లైబ్రరీకి స్వాగతం." },
  { code: "th", name: "Thai", nativeName: "ไทย", dir: "ltr", previewPhrase: "ยินดีต้อนรับสู่ห้องสมุดหนังสือเสียงหลายภาษาของคุณ" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", dir: "ltr", previewPhrase: "Çok dilli okuma ve yapay zeka sesli kitap kütüphanenize hoş geldiniz." },
  { code: "uk", name: "Ukrainian", nativeName: "Українська", dir: "ltr", previewPhrase: "Ласкаво просимо до вашої багатомовної бібліотеки." },
  { code: "ur", name: "Urdu", nativeName: "اردو", dir: "rtl", previewPhrase: "آپ کی ذاتی اے آئی آڈیو بک اور کثیر لسانی لائبریری میں خوش آمدید۔" },
  { code: "uz", name: "Uzbek", nativeName: "Oʻzbekcha", dir: "ltr", previewPhrase: "Koʻp tilli kutubxonangizga xush kelibsiz." },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", dir: "ltr", previewPhrase: "Chào mừng đến với thư viện sách nói đa ngôn ngữ của bạn." },
  { code: "cy", name: "Welsh", nativeName: "Cymraeg", dir: "ltr", previewPhrase: "Croeso i'ch llyfrgell amlieithog." },
  { code: "xh", name: "Xhosa", nativeName: "isiXhosa", dir: "ltr", previewPhrase: "Wamkelekile kwithala leencwadi leelwimi ezininzi." },
  { code: "yi", name: "Yiddish", nativeName: "ייִדיש", dir: "rtl", previewPhrase: "ברוכים הבאים צו אײַער פֿילשפּראַכיקער ביבליאָטעק." },
  { code: "yo", name: "Yoruba", nativeName: "Yorùbá", dir: "ltr", previewPhrase: "Káàbọ̀ sí ilé-ìwé olóhùn ọ̀pọ̀ èdè rẹ." },
  { code: "zu", name: "Zulu", nativeName: "isiZulu", dir: "ltr", previewPhrase: "Siyakwamukela emtapweni wakho wezincwadi eziningi." },
];

export type TranslationQuality = "standard" | "high" | "literary";
export type TranslationReadingMode =
  | "original"
  | "translated"
  | "side_by_side"
  | "paragraph_by_paragraph";

export const TRANSLATION_QUALITY_OPTIONS: Array<{
  id: TranslationQuality;
  label: string;
  description: string;
}> = [
  {
    id: "standard",
    label: "Standard",
    description: "Fast, clear translation preserving paragraph structure.",
  },
  {
    id: "high",
    label: "High-Quality",
    description: "Context-aware grammar, idioms, and glossary consistency.",
  },
  {
    id: "literary",
    label: "Literary",
    description: "Natural storytelling cadence, tone, and dialogue fidelity.",
  },
];

export type GeminiPrebuiltVoiceId =
  | "Kore"
  | "Charon"
  | "Zephyr"
  | "Puck"
  | "Fenrir"
  | "Aoede"
  | "Leda"
  | "Orus"
  | "Callirrhoe"
  | "Autonoe"
  | "Enceladus"
  | "Iapetus"
  | "Umbriel"
  | "Algieba"
  | "Despina"
  | "Erinome"
  | "Algenib"
  | "Sulafat";

export type NarrationStyleId =
  | "natural"
  | "conversational"
  | "narrator"
  | "calm"
  | "educational"
  | "storytelling"
  | "expressive";

export interface VoiceProfile {
  id: GeminiPrebuiltVoiceId;
  name: string;
  genderPresentation: "Feminine" | "Masculine" | "Neutral";
  timbre: string;
  accentNote: string;
  recommendedFor: string;
  exampleText: string;
  provider: "gemini-3.8-tts";
}

export const VOICE_LIBRARY: VoiceProfile[] = [
  {
    id: "Kore",
    name: "Kore",
    genderPresentation: "Feminine",
    timbre: "Warm, balanced, crystal-clear",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Fiction, biographies, everyday reading",
    exampleText: "Morning light spilled across the quiet valley as the first pages turned.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Charon",
    name: "Charon",
    genderPresentation: "Masculine",
    timbre: "Deep, steady, authoritative",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "History, philosophy, non-fiction",
    exampleText: "Across centuries of exploration, every landmark began with a single voyage.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Zephyr",
    name: "Zephyr",
    genderPresentation: "Feminine",
    timbre: "Bright, gentle, soothing",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Evening reading, poetry, calm prose",
    exampleText: "Soft wind moved through the cedar branches while the harbor fell asleep.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Puck",
    name: "Puck",
    genderPresentation: "Masculine",
    timbre: "Crisp, upbeat, conversational",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Dialogue, modern essays, fast pacing",
    exampleText: "If you listen closely, every street corner in this city hides an untold story.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Fenrir",
    name: "Fenrir",
    genderPresentation: "Masculine",
    timbre: "Rich, dramatic, resonant",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Epic storytelling, thrillers, classics",
    exampleText: "The iron gate echoed once, and silence claimed the mountain pass.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Aoede",
    name: "Aoede",
    genderPresentation: "Feminine",
    timbre: "Breezy, lyrical, expressive",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Literary novels, memoirs, essays",
    exampleText: "She remembered the scent of rain on warm stone before the letter arrived.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Leda",
    name: "Leda",
    genderPresentation: "Feminine",
    timbre: "Youthful, vivid, energetic",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Young adult, adventure, lively narration",
    exampleText: "Step onto the deck now—the tide is rising faster than the charts predicted.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Orus",
    name: "Orus",
    genderPresentation: "Masculine",
    timbre: "Calm, firm, grounded",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Science, leadership, analytical books",
    exampleText: "Clear principles outlast trends because they rest on careful observation.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Callirrhoe",
    name: "Callirrhoe",
    genderPresentation: "Feminine",
    timbre: "Easy-going, melodic, warm",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Travelogues, cozy mysteries, cultural stories",
    exampleText: "Lanterns reflected on the canal as music drifted from the open courtyard.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Autonoe",
    name: "Autonoe",
    genderPresentation: "Feminine",
    timbre: "Poised, bright, articulate",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Biographies, journalism, academic prose",
    exampleText: "Every discovery begins when someone questions what everyone else assumes.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Enceladus",
    name: "Enceladus",
    genderPresentation: "Masculine",
    timbre: "Soft-spoken, intimate, reflective",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Late-night fiction, letters, journals",
    exampleText: "By midnight, the cabin lamp was the only star visible from the ridge.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Iapetus",
    name: "Iapetus",
    genderPresentation: "Masculine",
    timbre: "Clean, crisp, documentary clarity",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Textbooks, technical guides, economics",
    exampleText: "Notice how three small variables reshape the outcome of the entire system.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Umbriel",
    name: "Umbriel",
    genderPresentation: "Masculine",
    timbre: "Relaxed, thoughtful, unhurried",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Philosophy, slow classics, reflections",
    exampleText: "Patience turns ordinary afternoons into memories worth keeping.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Algieba",
    name: "Algieba",
    genderPresentation: "Masculine",
    timbre: "Smooth, velvet studio cadence",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Drama, historical fiction, audiobooks",
    exampleText: "No one spoke a word until the clock struck seven across the square.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Despina",
    name: "Despina",
    genderPresentation: "Feminine",
    timbre: "Graceful, gentle, comforting",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Wellness, folklore, bedtime reading",
    exampleText: "Breathe slowly and picture a quiet garden overlooking the sea.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Erinome",
    name: "Erinome",
    genderPresentation: "Feminine",
    timbre: "Clear, focused, measured diction",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Education, study notes, essays",
    exampleText: "Before solving the puzzle, examine each clue in the order it appeared.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Algenib",
    name: "Algenib",
    genderPresentation: "Masculine",
    timbre: "Seasoned, textured, characterful",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "Mystery, adventure, sea tales",
    exampleText: "Old maps never lied—they simply left room for courage.",
    provider: "gemini-3.8-tts",
  },
  {
    id: "Sulafat",
    name: "Sulafat",
    genderPresentation: "Feminine",
    timbre: "Radiant, inviting, storytelling warmth",
    accentNote: "Adapts naturally across supported languages",
    recommendedFor: "World literature, family sagas, short stories",
    exampleText: "Gather close, because this chapter begins where every road meets the river.",
    provider: "gemini-3.8-tts",
  },
];

export const NARRATION_STYLES: Array<{
  id: NarrationStyleId;
  label: string;
  promptHint: string;
}> = [
  {
    id: "natural",
    label: "Natural",
    promptHint: "Natural, warm, unhurried human audiobook reading with smooth pauses",
  },
  {
    id: "narrator",
    label: "Professional Narrator",
    promptHint: "Polished, articulate studio audiobook narrator with clear diction",
  },
  {
    id: "calm",
    label: "Calm",
    promptHint: "Gentle, calm, soothing bedtime-friendly reading pace",
  },
  {
    id: "conversational",
    label: "Conversational",
    promptHint: "Friendly, relatable, conversational reading tone",
  },
  {
    id: "educational",
    label: "Educational",
    promptHint: "Measured, clear instructional tone for study and comprehension",
  },
  {
    id: "storytelling",
    label: "Storytelling",
    promptHint: "Engaging literary storyteller with natural emotional phrasing",
  },
  {
    id: "expressive",
    label: "Expressive",
    promptHint: "Dynamic, expressive narration respecting punctuation and dialogue",
  },
];

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const RTL_CODES = new Set(["ar", "fa", "he", "ku", "ps", "sd", "ug", "ur", "yi"]);

export function getLanguageMeta(code?: string | null): SupportedLanguage {
  const raw = (code || "en").trim().toLowerCase();
  const exact = SUPPORTED_LANGUAGES.find((l) => l.code === raw);
  if (exact) return exact;
  const normalized = raw.split(/[-_]/)[0];
  return (
    SUPPORTED_LANGUAGES.find((l) => l.code === normalized) ?? {
      code: normalized || "en",
      name: normalized ? normalized.toUpperCase() : "English",
      nativeName: normalized ? normalized.toUpperCase() : "English",
      dir: RTL_CODES.has(normalized) ? "rtl" : "ltr",
      previewPhrase: SUPPORTED_LANGUAGES.find((l) => l.code === "en")!.previewPhrase,
    }
  );
}

export function isRtlLanguage(code?: string | null): boolean {
  return getLanguageMeta(code).dir === "rtl";
}

export function filterSupportedLanguages(query: string): SupportedLanguage[] {
  const q = query.trim().toLowerCase();
  if (!q) return SUPPORTED_LANGUAGES;
  return SUPPORTED_LANGUAGES.filter(
    (l) =>
      l.name.toLowerCase().includes(q) ||
      l.nativeName.toLowerCase().includes(q) ||
      l.code.toLowerCase().includes(q),
  );
}
