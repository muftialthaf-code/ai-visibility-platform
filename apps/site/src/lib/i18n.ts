/** Interface strings. Business copy comes from the tenant config; only chrome lives here. */
const en = {
  skip: 'Skip to content',
  services: 'Services',
  pricing: 'Pricing',
  about: 'About',
  faq: 'FAQ',
  blog: 'Blog',
  contact: 'Contact',
  privacy: 'Privacy',
  terms: 'Terms',
  whoFor: 'Who it is for',
  learnMore: 'Learn more',
  contactCta: 'Get in touch',
  howPricing: 'How pricing works',
  noPricing: 'Pricing details are available on request.',
  written: 'Written by',
  updated: 'Last updated',
  published: 'Published',
  noArticles: 'No articles yet.',
  readMore: 'Read article',
  home: 'Home',
  language: 'Language',
  leadNotConfigured: 'Contact details have not been set up yet.',
  send: 'Send message',
  yourName: 'Your name',
  yourEmail: 'Your email',
  yourMessage: 'How can we help?',
  poweredBy: 'Built with',
};

type Strings = typeof en;

const ar: Strings = {
  skip: 'انتقل إلى المحتوى',
  services: 'الخدمات',
  pricing: 'الأسعار',
  about: 'من نحن',
  faq: 'الأسئلة الشائعة',
  blog: 'المدونة',
  contact: 'تواصل معنا',
  privacy: 'الخصوصية',
  terms: 'الشروط',
  whoFor: 'لمن هذه الخدمة',
  learnMore: 'اعرف المزيد',
  contactCta: 'تواصل معنا',
  howPricing: 'كيف تعمل الأسعار',
  noPricing: 'تفاصيل الأسعار متاحة عند الطلب.',
  written: 'بقلم',
  updated: 'آخر تحديث',
  published: 'نُشر في',
  noArticles: 'لا توجد مقالات بعد.',
  readMore: 'قراءة المقال',
  home: 'الرئيسية',
  language: 'اللغة',
  leadNotConfigured: 'لم يتم إعداد بيانات التواصل بعد.',
  send: 'إرسال الرسالة',
  yourName: 'اسمك',
  yourEmail: 'بريدك الإلكتروني',
  yourMessage: 'كيف يمكننا مساعدتك؟',
  poweredBy: 'تم الإنشاء بواسطة',
};

const dictionaries: Record<string, Strings> = { en, ar };

/** UI strings for a language, falling back to English for languages without a dictionary. */
export function ui(lang: string): Strings {
  return dictionaries[lang.split('-')[0]!] ?? en;
}

export const LANGUAGE_NAMES: Record<string, string> = { en: 'English', ar: 'العربية' };
