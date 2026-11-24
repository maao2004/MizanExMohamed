# عقود البيانات والمصادر المعتمدة (MizanEX Data Contracts)

## 1. المصادر الأربعة للاستيراد عبر Excel

### أ. القوائم المالية الربع سنوية (`QuarterlyFinancialsData.xlsx`)
- **الورقة المعتمدة:** `QuarterlyFinancials`
- **مجموعات Firestore:** `quarterly_financial_records/{TICKER}_{YEAR}_{QUARTER}` + الإسقاط `financials/{ticker}_{year}_{quarter}`
- **المعرف الموحّد:** `TICKER` عبر `normalizedTicker` (حروف كبيرة بدون `.CA`).
- **الأعمدة:** 26 عموداً قياسياً + 5 أعمدة لربط `FCFF` (`DA_YTD`, `DeltaOperatingNWC_YTD`, `ValuationTaxRate`, `ValuationSource`, `FinancialUnit`) + أي أعمدة ممتدة مستقبلية في `extendedFields`.
- **القاعدة الصارمة:** `BLANK` = `null` ومفصول عن `0` الفعلي؛ `Shares > 0`؛ `ValuationTaxRate` كسر عشري `[0..1]`.

### ب. التداول اليومي (`YYYY-M-D.xlsx`)
- **اسم الملف:** يجب أن يحتوي تاريخ تقويم صالح مثل `2026-11-8.xlsx` (تُشتق `tradeDate` بصيغة `YYYY-MM-DD`).
- **مجموعة Firestore:** `daily_trading_records/{TICKER}_{YYYY-MM-DD}`
- **القاعدة:** لا يُخترع أي سجل لأيام العطلات؛ آخر سعر سوقي يُشتق من أحدث سجل تاريخي موجود (`lastPrice` ثم `closePrice` كسعر إقفال يومي موثق).

### ج. افتراضات بيتا (`Beta_Assumptions.xlsx`)
- **الورقة المعتمدة:** `Beta_Assumptions`
- **الأعمدة:** `Ticker`, `Beta`, `AsOfDate`, `Source`
- **مجموعة Firestore:** `beta_assumptions/{TICKER}`
- **السياسة:**
  - تقبل القيمة `0` والقيم السالبة كبيانات صالحة.
  - ترفض القيم غير الرقمية أو `NaN`/`Infinity` أو التواريخ غير الصالحة أو السطور ذات `Source` الفارغ أو التكرار المتعارض داخل الملف.
  - وجود سهم في `beta_assumptions` **لا يضيفه** لقائمة اختيار الأسهم إذا غاب عن `quarterly_financial_records`.
  - تُفصل `betaRaw` عن `betaAdjusted` ومصادرها، وإذا أُكد غياب السجل من الخادم فقط تُستخدم `1` كبيتا مفترضة (`بيتا مفترضة (1)`)، أما عند الخطأ أو عدم الاتصال فتُعرض حالة تعذر تأكيد السجل دون افتراض صامت.

### د. المعاملات والافتراضات (`All_Parameters.xlsx`)
- **الورقة المعتمدة:** `All_Parameters`
- **الأعمدة:** `Key`, `Value`, `Description`, `Scope`, `Ticker`, `Unit`, `AsOfDate`, `Source`
- **النطاق (`Scope`):**
  - `global` (يجب أن يكون `Ticker` فارغاً): يُكتب في `macro_params/{Key}` (يتطلب دور `admin`).
  - `company` (يجب توفر `Ticker` صالح): يُكتب في `company_assumptions/{TICKER}/parameters/{Key}`.
- **قواعد النسب المئوية (%):**
  - `0.225` تعني `22.5%` ولا تُقسم مرة أخرى.
  - `"22.5%"` تُحوّل تلقائياً إلى `0.225`.
  - إدخال رقم صريح مثل `22.5` بدون `%` لحقل نسبته مئوية يُرفض/يُعلَّم بوضوح لتجنب خطأ ×100.

## 2. توثيق الاختلاف الحتمي بين `WACC_Mode` و `r_Mode`
| الكود | `WACC_Mode` | `r_Mode` |
|---|---|---|
| `1` | محلي بالجنيه المصري + علاوة الدولة (`Rf_EG + β·ERP + λ·CRP`) | محلي بالجنيه المصري + علاوة الدولة (`Rf_EG + β·ERP + λ·CRP`) |
| `2` | **محلي بالجنيه المصري بدون CRP** (`Rf_EG + β·ERP`) | **بالدولار الأمريكي + CRP** (`Rf_USD + β·ERP + λ·CRP`) |
| `3` | **بالدولار الأمريكي** (مستبعد في DCF بالجنيه) | **محلي بالجنيه المصري بدون CRP** (`Rf_EG + β·ERP`) |

## 3. المعاملات غير المفعّلة حسابياً في المحرك
- `US_Default_Spread`
- `Inflation_Egypt_LT`
- `Inflation_US_LT`

تُحفظ وتُعرض كمعاملات موثقة مع وسم صريح **«غير مفعّل حسابياً»** دون تغيير المنهجية الاقتصادية أو دمج التضخم صامتاً.

## 4. `Forecast_Years` و `Exit_Multiple`
- **أفق التوقع `Forecast_Years`:** عدد صحيح ديناميكي `1..N` (القيمة القياسية 5 تطابق السلوك السابق تماماً). إذا طُلب `N` سنوات ولم يتوفر أي من `Growth_Y1..Growth_YN` لا يُكرر آخر معدل صامتاً بل يُستبعد `DCF` مع ذكر المتغيرات الناقصة. معدلات `Growth_Y1..YN` تنطبق على **تدفقات FCFF**.
- **القيمة النهائية (`terminalValueMethod`):**
  - `'perpetuity_growth'` (الافتراضي المعتمد): يستخدم `Terminal_Growth` مع شرط `WACC > Terminal_Growth`.
  - `'exit_multiple'`: تفعيل صريح فقط، يعتمد `Exit_Multiple > 0` × **EBITDA النهائية المتوقعة** (`(EBIT_TTM + DA_TTM) × معامل النمو المركب حتى السنة N`)؛ لا يُضرب في `FCFF` أبداً، ولا يُستعمل `Exit_Multiple` كبديل صامت عند غياب `Terminal_Growth`.

## 5. تتبع المصدر والتجزئة الحتمية (`Provenance & ContentHash`)
- كل كتابة معتمدة تُرفق بالحقول:
  `importId`, `sourceFile`, `sourceSheet`, `sourceRow`, `schemaVersion`, `updatedBy`, `serverUpdatedAt`, `contentHash`, `isDeleted`.
- يُحسب `contentHash` حصرياً من الحقول المحاسبية والتقييمية المعيارية (بعد استبعاد حقول التوقيت والمصدر) لضمان عدم إجراء أي كتابة جديدة عند إعادة استيراد ملف مطابق (`0 writes`).
- الاحتفاظ بسجلات الحذف في `tombstones` لمدة 30 يوماً؛ عند تجاوز نافذة الاحتفاظ أو غياب المؤشر تُفرض إعادة مزامنة كاملة نظيفة.
