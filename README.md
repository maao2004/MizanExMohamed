# ميزان (Mizan) — منصة التحليل المالي وتقييم أسهم البورصة المصرية

منصة تحليل مالي وتقييم مؤسسي لأسهم البورصة المصرية (EGX) مبنية بـ React 19 وTypeScript وVite مع تكامل Firebase Authentication وCloud Firestore وFirebase Cloud Functions (Node.js 24).

## المتطلبات وبيئة التشغيل

- **بيئة التطوير والاختبار المحلية (الجذر):** **Node.js `>=24.12.0`** و**npm** (`10+` / `11+`) — مطلوبة لتوافق `@firebase/rules-unit-testing@6.0.0` وحزم `@firebase/*` دون تعارضات `EBADENGINE`.
- **بيئة تشغيل Cloud Functions (`functions/`):** **Node.js `24`** (محددة صراحةً في `functions/package.json` عبر `"engines": { "node": "24" }` ودون `runtime` متعارض في `firebase.json`).
- **اختبارات محاكي Firestore المحلي (`npm run test:emulator`):** تتطلب **Java Runtime (JRE/JDK 17+)** وأداة **Firebase CLI**.
- **مسار التثبيت وملفات القفل:** مسار التثبيت الرسمي المعتمد هو **`npm`** عبر `package-lock.json` (للجذر) و`functions/package-lock.json` (للدوال) باستخدام `npm ci`. يظل ملف `bun.lock` محفوظاً في المستودع كمرجع قديم/بديل دون حذفه اعتباطياً، ولا يُعد مسار التثبيت المعتمد (تجنب خلط `bun install` مع `npm ci`).

## التثبيت والاختبار محلياً

```bash
npm ci
npm --prefix functions ci
npm run check
npm run test:emulator   # يتطلب توفر Java 17+ وFirebase CLI محلياً
npm run dev
```

يتضمن الأمر `npm run check`:
1. مزامنة العقود المشتركة مع الدوال (`npm run sync:shared`)
2. فحص الأنواع عبر TypeScript (`npm run lint`)
3. اختبارات الحسابات والتحقق والوحدات (`npm test`)
4. بناء الواجهة الأمامية (`npm run build`)
5. بناء الوظائف الخلفية (`npm --prefix functions run build`)

## إعداد Firebase

1. انسخ `.env.example` إلى `.env.local` واملأ متغيرات Firebase العامة لمشروعك.
2. يدعم التكوين الحالي قاعدة `(default)` في Firestore، وتعمل دالة `updateFinancialData` على الإقليم `us-central1` ببيئة تشغيل Node.js 22.
3. للتحكم في الصلاحيات:
   - يتم إنشاء مستخدمي التطبيق افتراضياً بدور `subscriber` فقط، ويُمنع رفع الصلاحيات ذاتياً من الواجهة أو التخزين المحلي.
   - يتطلب مدير التهيئة الأولي بريداً موثقاً (`email_verified === true`) أو وجود مستند موثوق في `admins/{uid}` أو Custom Claims من جهة الخادم.
   - إدارة أدوار المستخدمين من اللوحة الأمامية معطلة محلياً حتى ربطها بدالة إدارية موثقة على الخادم.

## النشر

تحقق أولاً من المشروع النشط عبر `firebase use`:

```bash
npm run check
firebase deploy --only firestore,functions,hosting
```

## ضوابط ومنهجية الحسابات

- **TTM & BLANK:** يُحسب TTM من سجل `FY` أو وفق معادلة `YTD الحالي + FY السابق − YTD المقارن` دون تعميم الأرباع الناقصة. كما تُميَّز القيم المفقودة (`null` / `BLANK`) عن الصفر المحاسبي.
- **FCFF & EBITDA:** يُحسب `FCFF` من تسوية موثقة: `NOPAT = EBIT × (1 − ضريبة التقييم)` + الإهلاك والاستنفاد − النفقات الرأسمالية − التغيّر في رأس المال العامل التشغيلي. ويبقى `ROIC` غير متاح (`null`) دون تسوية رأس المال المستثمر.
- **DCF:** يعتمد على `FCFF` وصافي الدين الفعليين (`Total Debt − Cash`) وأوزان القيمة السوقية في `WACC`. ويُستبعد تلقائياً للقطاع المالي والبنوك والتأمين أو عند نقص المدخلات أو عدم اتساق العملة (`WACC_Mode === 3`).
- **RIM & السيناريوهات:** لا يعتمد نموذج RIM أي نسبة احتجاز افتراضية صامتة (لا يوجد افتراض تلقائي `50%`) ولا طريقة قيمة نهائية افتراضية. تُحدد نسبة احتجاز فترة التوقع وفق سياسة الشركة (`rimRetentionPolicy`):
  - `rim_parameter` (السياسة الافتراضية): تعتمد القيمة الفعالة لـ `RIM_Retention` المحلولة مركزياً من المصادر المعتمدة — تخصيص الشركة (`company_assumptions/{ticker}/parameters/RIM_Retention`) والمرجع العام (`macro_params/RIM_Retention`) — حسب أولوية المصادر النشطة (`company_first` أو `global_first`)، ويُستبعد RIM عند غياب القيمة الفعالة مع توضيح المصادر وخطوة الاستكمال.
  - `historical_retention`: تعتمد نسبة الاحتجاز التاريخية الموثقة (`1 − Payout`) المشتقة من `dividend_records` وصافي ربح المساهمين العاديين (ضمن `[0%..100%]`).
  - `minimum`: تعتمد قاعدة الاختيار `min(RIM_Retention, Historical_Retention)` بشرط توفر القيمتين وصلاحية الاحتجاز التاريخي، دون تعديل المعامل المحفوظ.
  كما يشترط النموذج تحديد طريقة القيمة النهائية صراحةً عبر `RIM_Terminal_Method` (`1` بقاء الدخل المتبقي، `2` تلاشي ROE عبر `RIM_Fade_Years`، أو `3` استمرار ROE ونمو القيمة الدفترية `g_B < Ke`). وتعيد السيناريوهات ومصفوفة الحساسية حساب النماذج بالمعاملات الجديدة بدلاً من الضرب النسبي.
