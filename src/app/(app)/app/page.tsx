"use client";

import { FormEvent, useEffect, useState, useSyncExternalStore, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Case, Workflow } from "../../../domain/types";
import { SpeechInput } from "../../speech/SpeechInput";
import { insertTranscript, SpeechLanguage } from "../../speech/transcription";

/* ── i18n copy ───────────────────────────────── */
const copy = {
  en: {
    languageLabel: "Website language",
    headline1: "Life gets complicated.",
    headline2: "Let's sort it out.",
    intro: "Tell me what's going on. TRESTLE will figure out the right steps, find official information, and help you get things done.",
    inputLabel: "What do you need help with?",
    placeholder: "Try typing or use your voice…",
    submit: "Get started",
    preparing: "Preparing your plan…",
    planNote: "Your plan is reviewed before it becomes a case.",
    situations: "Or start with a common situation",
    situationItems: [
      { id: "lost-phone",      label: "Lost or stolen phone",       desc: "Secure your accounts and report it" },
      { id: "suspicious-call", label: "Report a suspicious call",   desc: "Find the right reporting channel" },
      { id: "replace-doc",     label: "Replace a document",         desc: "Passport, Aadhaar, driving licence…" },
      { id: "travel",          label: "Prepare for travel",         desc: "Visas, documents and checklists" },
      { id: "online-order",    label: "Resolve an online order",    desc: "Refunds, returns and complaints" },
      { id: "other",           label: "Something else",             desc: "Describe your situation" },
    ],
    resume: "Pick up where you left off",
    viewAll: "View all",
    casesEmpty: "Cases you create will appear here.",
    proposalReady: "Your plan is ready to review",
    proposalEdit: "Edit description",
    proposalCreate: "Create my case",
    proposalSaving: "Saving…",
    proposalWhat: "What TRESTLE will work through",
    proposalLocal: "Prepared with TRESTLE's local workflow rules because Groq planning was unavailable.",
    proposalGroq: "Groq drafted these steps from a privacy-screened description. Contact, account, and identity numbers are not sent to Groq.",
  },
  hi: {
    languageLabel: "वेबसाइट की भाषा",
    headline1: "ज़िंदगी पेचीदा हो जाती है।",
    headline2: "मिलकर सुलझाते हैं।",
    intro: "बताइए क्या हो रहा है। TRESTLE सही कदम ढूँढेगा, आधिकारिक जानकारी लाएगा, और काम पूरा करने में मदद करेगा।",
    inputLabel: "किस बात में मदद चाहिए?",
    placeholder: "टाइप करें या आवाज़ से बोलें…",
    submit: "शुरू करें",
    preparing: "योजना तैयार हो रही है…",
    planNote: "मामला बनाने से पहले आप योजना की समीक्षा करेंगे।",
    situations: "या कोई सामान्य स्थिति चुनें",
    situationItems: [
      { id: "lost-phone",      label: "खोया या चोरी हुआ फ़ोन",      desc: "खाते सुरक्षित करें और शिकायत करें" },
      { id: "suspicious-call", label: "संदिग्ध कॉल की शिकायत",       desc: "सही रिपोर्टिंग चैनल खोजें" },
      { id: "replace-doc",     label: "दस्तावेज़ बदलें",              desc: "पासपोर्ट, आधार, ड्राइविंग लाइसेंस…" },
      { id: "travel",          label: "यात्रा की तैयारी",             desc: "वीज़ा, दस्तावेज़ और चेकलिस्ट" },
      { id: "online-order",    label: "ऑनलाइन ऑर्डर सुलझाएँ",       desc: "रिफंड, रिटर्न और शिकायतें" },
      { id: "other",           label: "कुछ और",                       desc: "अपनी स्थिति बताएँ" },
    ],
    resume: "जहाँ छोड़ा था वहाँ से शुरू करें",
    viewAll: "सब देखें",
    casesEmpty: "आपके बनाए मामले यहाँ दिखेंगे।",
    proposalReady: "आपकी योजना समीक्षा के लिए तैयार है",
    proposalEdit: "विवरण संपादित करें",
    proposalCreate: "मेरा मामला बनाएँ",
    proposalSaving: "सहेजा जा रहा है…",
    proposalWhat: "TRESTLE के सुझाए कदम",
    proposalLocal: "Groq उपलब्ध न होने से TRESTLE के स्थानीय नियमों से यह योजना बनाई गई है।",
    proposalGroq: "Groq ने गोपनीयता-सुरक्षित विवरण से ये कदम सुझाए हैं। संपर्क और खाता नंबर Groq को नहीं भेजे जाते।",
  },
  bn: {
    languageLabel: "ওয়েবসাইটের ভাষা",
    headline1: "জীবন জটিল হয়ে পড়ে।",
    headline2: "মিলে সমাধান করি।",
    intro: "কী হচ্ছে বলুন। TRESTLE সঠিক পদক্ষেপ খুঁজে দেবে, সরকারি তথ্য আনবে এবং কাজ সম্পন্ন করতে সাহায্য করবে।",
    inputLabel: "কোন বিষয়ে সাহায্য দরকার?",
    placeholder: "টাইপ করুন বা কথা বলুন…",
    submit: "শুরু করুন",
    preparing: "পরিকল্পনা তৈরি হচ্ছে…",
    planNote: "কেস তৈরির আগে আপনি পরিকল্পনাটি পর্যালোচনা করবেন।",
    situations: "অথবা একটি সাধারণ পরিস্থিতি বেছে নিন",
    situationItems: [
      { id: "lost-phone",      label: "হারানো বা চুরি যাওয়া ফোন",   desc: "অ্যাকাউন্ট সুরক্ষিত করুন ও অভিযোগ করুন" },
      { id: "suspicious-call", label: "সন্দেহজনক কলের অভিযোগ",       desc: "সঠিক অভিযোগ চ্যানেল খুঁজুন" },
      { id: "replace-doc",     label: "নথি পরিবর্তন করুন",            desc: "পাসপোর্ট, আধার, ড্রাইভিং লাইসেন্স…" },
      { id: "travel",          label: "ভ্রমণের প্রস্তুতি",            desc: "ভিসা, নথি ও চেকলিস্ট" },
      { id: "online-order",    label: "অনলাইন অর্ডার সমাধান",         desc: "রিফান্ড, ফেরত ও অভিযোগ" },
      { id: "other",           label: "অন্য কিছু",                    desc: "আপনার পরিস্থিতি বর্ণনা করুন" },
    ],
    resume: "যেখান থেকে থেমেছিলেন সেখান থেকে শুরু করুন",
    viewAll: "সব দেখুন",
    casesEmpty: "আপনার তৈরি কেসগুলো এখানে দেখা যাবে।",
    proposalReady: "আপনার পরিকল্পনা পর্যালোচনার জন্য প্রস্তুত",
    proposalEdit: "বিবরণ সম্পাদনা",
    proposalCreate: "আমার কেস তৈরি করুন",
    proposalSaving: "সংরক্ষণ হচ্ছে…",
    proposalWhat: "TRESTLE যে ধাপগুলো সম্পন্ন করবে",
    proposalLocal: "Groq পরিকল্পনা পাওয়া যায়নি, তাই TRESTLE-এর স্থানীয় নিয়মে তৈরি হয়েছে।",
    proposalGroq: "গোপনীয়তা-সুরক্ষিত বিবরণ থেকে Groq ধাপগুলো সাজিয়েছে। যোগাযোগ ও অ্যাকাউন্ট নম্বর Groq-এ পাঠানো হয় না।",
  },
  gu: {
    languageLabel: "વેબસાઇટની ભાષા",
    headline1: "જીવન જટિલ બને છે.",
    headline2: "સાથે ઉકેલ શોધીએ.",
    intro: "શું ચાલી રહ્યું છે તે કહો. TRESTLE સાચાં પગલાં શોધશે, સત્તાવાર માહિતી લાવશે અને કામ પૂર્ણ કરવામાં સહાય કરશે.",
    inputLabel: "કઈ બાબતમાં સહાય જોઈએ?",
    placeholder: "ટાઈપ કરો અથવા બોલો…",
    submit: "શરૂ કરો",
    preparing: "આયોજન તૈયાર થઈ રહ્યું છે…",
    planNote: "કેસ બનાવતાં પહેલાં તમે આ આયોજનની સમીક્ષા કરશો.",
    situations: "અથવા સામાન્ય સ્થિતિ પસંદ કરો",
    situationItems: [
      { id: "lost-phone",      label: "ખોવાઈ ગયેલ કે ચોરાઈ ગયેલ ફ઼ોન", desc: "ખાતા સુરક્ષિત કરો અને ફ઼રિયાદ કરો" },
      { id: "suspicious-call", label: "શંકાસ્પદ કૉલ",                    desc: "સાચી ફ઼રિયાદ ચૅનલ શોધો" },
      { id: "replace-doc",     label: "દસ્તાવેજ બદલો",                   desc: "પાસપૉર્ટ, આધાર, ડ્રાઇવિંગ લાઇસૅન્સ…" },
      { id: "travel",          label: "પ્રવાસની તૈયારી",                 desc: "વિઝા, દસ્તાવેજ અને ચૅક‌-લિસ્ટ" },
      { id: "online-order",    label: "ઑનલાઇન ઑર્ડર ઉકેલો",            desc: "પૈસા પાછા, ઑર્ડર પાછો ને ફ઼રિયાદ" },
      { id: "other",           label: "બીજું કઈ",                        desc: "તમારી સ્થિતિ જણાવો" },
    ],
    resume: "જ્યાંથી અટક્યા હતા ત્યાંથી ચાલુ કરો",
    viewAll: "બધા જુઓ",
    casesEmpty: "તમે બનાવેલ કેસ અહીં દેખાશે.",
    proposalReady: "તમારી યોજના સમીક્ષા માટે તૈયાર છે",
    proposalEdit: "વર્ણન સંપાદિત કરો",
    proposalCreate: "મારો કેસ બનાવો",
    proposalSaving: "સાચવી રહ્યા છીએ…",
    proposalWhat: "TRESTLE કયા પગલાં ભરશે",
    proposalLocal: "Groq ઉપલબ્ધ ન હોવાથી TRESTLEના સ્થાનિક નિયમો ઉપર યોજના તૈયાર થઈ.",
    proposalGroq: "Groqએ ગોપનીયતા-સુરક્ષિત વર્ણન પરથી ધાપ ઘડ્યાં. ઑળખ નંબર Groqને મોકલાતા નથી.",
  },
  pa: {
    languageLabel: "ਵੈੱਬਸਾਈਟ ਦੀ ਭਾਸ਼ਾ",
    headline1: "ਜ਼ਿੰਦਗੀ ਉਲਝ ਜਾਂਦੀ ਹੈ।",
    headline2: "ਮਿਲ ਕੇ ਸੁਲਝਾਈਏ।",
    intro: "ਦੱਸੋ ਕੀ ਚੱਲ ਰਿਹਾ ਹੈ। TRESTLE ਸਹੀ ਕਦਮ ਲੱਭੇਗਾ, ਸਰਕਾਰੀ ਜਾਣਕਾਰੀ ਦੇਵੇਗਾ ਅਤੇ ਕੰਮ ਕਰਵਾਉਣ ਵਿੱਚ ਮਦਦ ਕਰੇਗਾ।",
    inputLabel: "ਕਿਸ ਗੱਲ ਵਿੱਚ ਮਦਦ ਚਾਹੀਦੀ ਹੈ?",
    placeholder: "ਟਾਈਪ ਕਰੋ ਜਾਂ ਬੋਲੋ…",
    submit: "ਸ਼ੁਰੂ ਕਰੋ",
    preparing: "ਯੋਜਨਾ ਤਿਆਰ ਹੋ ਰਹੀ ਹੈ…",
    planNote: "ਕੇਸ ਬਣਨ ਤੋਂ ਪਹਿਲਾਂ ਤੁਸੀਂ ਯੋਜਨਾ ਦੀ ਸਮੀਖਿਆ ਕਰੋਗੇ।",
    situations: "ਜਾਂ ਕੋਈ ਆਮ ਸਥਿਤੀ ਚੁਣੋ",
    situationItems: [
      { id: "lost-phone",      label: "ਗੁੰਮ ਜਾਂ ਚੋਰੀ ਹੋਇਆ ਫ਼ੋਨ",      desc: "ਖਾਤੇ ਸੁਰੱਖਿਅਤ ਕਰੋ ਅਤੇ ਸ਼ਿਕਾਇਤ ਕਰੋ" },
      { id: "suspicious-call", label: "ਸ਼ੱਕੀ ਕਾਲ ਦੀ ਸ਼ਿਕਾਇਤ",          desc: "ਸਹੀ ਰਿਪੋਰਟਿੰਗ ਚੈਨਲ ਲੱਭੋ" },
      { id: "replace-doc",     label: "ਦਸਤਾਵੇਜ਼ ਬਦਲੋ",                desc: "ਪਾਸਪੋਰਟ, ਆਧਾਰ, ਡਰਾਈਵਿੰਗ ਲਾਇਸੈਂਸ…" },
      { id: "travel",          label: "ਸਫ਼ਰ ਦੀ ਤਿਆਰੀ",               desc: "ਵੀਜ਼ਾ, ਦਸਤਾਵੇਜ਼ ਅਤੇ ਚੈੱਕਲਿਸਟ" },
      { id: "online-order",    label: "ਔਨਲਾਈਨ ਆਰਡਰ ਸੁਲਝਾਓ",          desc: "ਵਾਪਸੀ, ਰਿਫੰਡ ਅਤੇ ਸ਼ਿਕਾਇਤਾਂ" },
      { id: "other",           label: "ਕੁਝ ਹੋਰ",                      desc: "ਆਪਣੀ ਸਥਿਤੀ ਦੱਸੋ" },
    ],
    resume: "ਜਿੱਥੇ ਛੱਡਿਆ ਸੀ ਉੱਥੋਂ ਜਾਰੀ ਰੱਖੋ",
    viewAll: "ਸਭ ਦੇਖੋ",
    casesEmpty: "ਤੁਹਾਡੇ ਬਣਾਏ ਕੇਸ ਇੱਥੇ ਦਿਖਣਗੇ।",
    proposalReady: "ਤੁਹਾਡੀ ਯੋਜਨਾ ਸਮੀਖਿਆ ਲਈ ਤਿਆਰ ਹੈ",
    proposalEdit: "ਵੇਰਵਾ ਸੋਧੋ",
    proposalCreate: "ਮੇਰਾ ਕੇਸ ਬਣਾਓ",
    proposalSaving: "ਸੰਭਾਲਿਆ ਜਾ ਰਿਹਾ ਹੈ…",
    proposalWhat: "TRESTLE ਕਿਹੜੇ ਕਦਮ ਚੁੱਕੇਗਾ",
    proposalLocal: "Groq ਉਪਲਬਧ ਨਾ ਹੋਣ ਕਰਕੇ TRESTLE ਦੇ ਸਥਾਨਕ ਨਿਯਮਾਂ ਨਾਲ ਯੋਜਨਾ ਬਣਾਈ ਗਈ।",
    proposalGroq: "ਗੋਪਨੀਯਤਾ-ਸੁਰੱਖਿਅਤ ਵੇਰਵੇ ਤੋਂ Groq ਨੇ ਕਦਮ ਤਿਆਰ ਕੀਤੇ। ਖਾਤਾ ਨੰਬਰ Groq ਨੂੰ ਨਹੀਂ ਭੇਜੇ ਜਾਂਦੇ।",
  },
} as const;

const situationExamples: Record<string, string> = {
  "lost-phone": "My phone was stolen. I need to secure my accounts, block the SIM, and report to police.",
  "suspicious-call": "I keep getting repeated unwanted calls from a number and want to know the right way to report them.",
  "replace-doc": "I lost my wallet and need to secure my cards and replace my driving licence.",
  "travel": "I need help understanding the official steps to prepare for an international trip.",
  "online-order": "An online order I placed never arrived and the seller is not responding to my refund request.",
  "other": "",
};

const situationIcons: Record<string, string> = {
  "lost-phone": "📱",
  "suspicious-call": "📞",
  "replace-doc": "📄",
  "travel": "✈️",
  "online-order": "📦",
  "other": "✦",
};

function subscribeLanguage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("trestle-language-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("trestle-language-change", onChange);
  };
}

function getLanguageSnapshot(): SpeechLanguage {
  const saved = window.localStorage.getItem("trestle-language");
  return saved === "hi" || saved === "bn" || saved === "gu" || saved === "pa" ? saved : "en";
}

function progressLabel(item: Case): string {
  const done = item.actions.filter((a) => a.status === "completed").length;
  return `${done} of ${item.actions.length} steps`;
}

function nextStep(item: Case): string {
  const pending = item.actions.find((a) => a.status !== "completed" && a.status !== "failed");
  return pending?.title ?? "Review outcome";
}

function caseStatusClass(status: string): string {
  const map: Record<string, string> = {
    active: "t-status t-status-active",
    completed: "t-status t-status-completed",
    archived: "t-status t-status-pending",
  };
  return map[status] ?? "t-status t-status-pending";
}

function progressPct(item: Case): number {
  if (!item.actions.length) return 0;
  return Math.round(item.actions.filter((a) => a.status === "completed").length / item.actions.length * 100);
}

// ── Subcomponents ─────────────────────────────────

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" style={{ width: 14, height: 14 }} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 10 8 14 16 6" />
    </svg>
  );
}

function ArrowRightIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: size, height: size }} stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function SpinnerInline() {
  return <div className="t-spinner" style={{ width: 16, height: 16 }} />;
}

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [cases, setCases] = useState<Case[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<Workflow | null>(null);
  const [proposalSource, setProposalSource] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const language = useSyncExternalStore(subscribeLanguage, getLanguageSnapshot, (): SpeechLanguage => "en");
  const t = copy[language];

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  function changeLanguage(value: SpeechLanguage) {
    window.localStorage.setItem("trestle-language", value);
    window.dispatchEvent(new Event("trestle-language-change"));
  }

  useEffect(() => {
    setCasesLoading(true);
    fetch("/api/cases", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { setCases(data); setCasesLoading(false); })
      .catch(() => { setCasesLoading(false); setMessage("Saved cases could not be loaded. You can still start a new case."); });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setMessage("");
    setProposal(null);
    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ originalInput: input.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "TRESTLE could not prepare a plan.");
      setProposal(data.workflow);
      setProposalSource(data.source ?? "");
      // Scroll to proposal
      setTimeout(() => {
        document.getElementById("proposal-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "TRESTLE could not prepare a plan.");
    } finally {
      setLoading(false);
    }
  }

  async function saveProposal() {
    if (!proposal) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ originalInput: input.trim(), workflow: proposal }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save this case.");
      router.push(`/cases/${data.id}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not save this case.");
      setLoading(false);
    }
  }

  function pickSituation(id: string) {
    const text = situationExamples[id] ?? "";
    if (text) {
      setInput(text);
      textareaRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }

  const activeCases = cases.filter((c) => c.status === "active");

  return (
    <div
      lang={language}
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Page content ──────────────────────── */}
      <div
        style={{
          flex: 1,
          maxWidth: 800,
          margin: "0 auto",
          width: "100%",
          padding: "40px 24px 64px",
        }}
      >
        {/* ── Language + intro ───────────────── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.035em", color: "var(--color-ink)" }}>
              {t.headline1}
              <br />
              {t.headline2}
            </h1>
            <p style={{ marginTop: 12, fontSize: 16, lineHeight: 1.65, color: "var(--color-ink-secondary)", maxWidth: 520 }}>
              {t.intro}
            </p>
          </div>

          {/* Language selector */}
          <div>
            <label htmlFor="site-language" className="t-label" style={{ fontSize: 11 }}>
              {t.languageLabel}
            </label>
            <select
              id="site-language"
              value={language}
              onChange={(e) => changeLanguage(e.target.value as SpeechLanguage)}
              className="t-input t-select"
              style={{ width: "auto", minWidth: 120, padding: "6px 32px 6px 10px", fontSize: 13 }}
            >
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="bn">বাংলা</option>
              <option value="gu">ગુજરાતી</option>
              <option value="pa">ਪੰਜਾਬੀ</option>
            </select>
          </div>
        </div>

        {/* ── Main input card ────────────────── */}
        <div
          className="t-card"
          style={{ marginTop: 32, padding: 24 }}
        >
          <form onSubmit={submit}>
            <label htmlFor="situation-input" className="t-label" style={{ fontSize: 14 }}>
              {t.inputLabel}
            </label>
            <div style={{ position: "relative", marginTop: 8 }}>
              <textarea
                id="situation-input"
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t.placeholder}
                maxLength={4000}
                rows={3}
                className="t-input t-textarea"
                style={{ paddingRight: 52, resize: "vertical", minHeight: 88 }}
              />
            </div>

            {/* Voice + submit row */}
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <SpeechInput
                language={language}
                onTranscript={(t) => setInput((cur) => insertTranscript(cur, t))}
              />
              <div style={{ flex: 1 }} />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="t-btn t-btn-primary t-btn-lg"
                style={{ minWidth: 140, justifyContent: "center" }}
              >
                {loading ? (
                  <>
                    <SpinnerInline />
                    {t.preparing}
                  </>
                ) : (
                  <>
                    {t.submit}
                    <ArrowRightIcon />
                  </>
                )}
              </button>
            </div>

            {/* Plan note */}
            <p style={{ marginTop: 10, fontSize: 12, color: "var(--color-ink-muted)" }}>
              {t.planNote}
            </p>
          </form>
        </div>

        {/* ── Error message ──────────────────── */}
        {message && (
          <div className="t-alert t-alert-error" style={{ marginTop: 12 }} role="alert">
            {message}
          </div>
        )}

        {/* ── Proposal card ──────────────────── */}
        {proposal && (
          <div
            id="proposal-section"
            className="t-card"
            style={{ marginTop: 20, padding: 24 }}
            aria-labelledby="proposal-title"
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="t-eyebrow">{t.proposalReady}</p>
                <h2 id="proposal-title" style={{ marginTop: 6, fontSize: 20, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--color-ink)" }}>
                  {proposal.title}
                </h2>
                <p style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6, color: "var(--color-ink-secondary)" }}>
                  {proposal.description}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => setProposal(null)}
                  className="t-btn t-btn-secondary t-btn-sm"
                >
                  {t.proposalEdit}
                </button>
                <button
                  type="button"
                  onClick={saveProposal}
                  disabled={loading}
                  className="t-btn t-btn-primary t-btn-sm"
                >
                  {loading ? t.proposalSaving : t.proposalCreate}
                </button>
              </div>
            </div>

            <div style={{ marginTop: 20, borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-ink)" }}>{t.proposalWhat}</p>
              <ol style={{ marginTop: 12, listStyle: "none", display: "flex", flexDirection: "column", gap: 0 }}>
                {proposal.actions.map((action, i) => (
                  <li key={action.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < proposal.actions.length - 1 ? "1px solid var(--color-border)" : "none" }}>
                    <span
                      style={{
                        width: 22, height: 22, borderRadius: "50%",
                        background: "var(--color-sage)", color: "var(--color-primary)",
                        display: "grid", placeItems: "center", flexShrink: 0, marginTop: 1,
                        fontSize: 11, fontWeight: 700,
                      }}
                    >
                      {i + 1}
                    </span>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-ink)" }}>{action.title}</p>
                      <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-ink-secondary)", marginTop: 2 }}>{action.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p style={{ marginTop: 12, fontSize: 12, color: "var(--color-ink-muted)" }}>
                {proposalSource === "deterministic-fallback" ? t.proposalLocal : t.proposalGroq}
              </p>
            </div>
          </div>
        )}

        {/* ── Suggested situations ───────────── */}
        <div style={{ marginTop: 36 }}>
          <p style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-ink-muted)", marginBottom: 14 }}>
            {t.situations}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 230px), 1fr))",
              gap: 10,
            }}
          >
            {t.situationItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => pickSituation(item.id)}
                className="t-card t-card-interactive"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "12px 14px",
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",
                  border: "none",
                  background: "var(--color-card)",
                }}
              >
                <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0, marginTop: 1 }} aria-hidden="true">
                  {situationIcons[item.id]}
                </span>
                <span>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "var(--color-ink)" }}>{item.label}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--color-ink-secondary)", marginTop: 2 }}>{item.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Active cases ───────────────────── */}
        <div style={{ marginTop: 48 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-ink)" }}>
              {t.resume}
            </h2>
            {cases.length > 3 && (
              <Link href="/cases" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary)", textDecoration: "none" }}>
                {t.viewAll} →
              </Link>
            )}
          </div>

          {casesLoading ? (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {[1, 2].map((n) => (
                <div key={n} className="t-skeleton" style={{ height: 72, borderRadius: 12 }} />
              ))}
            </div>
          ) : activeCases.length === 0 ? (
            <p style={{ marginTop: 16, fontSize: 14, color: "var(--color-ink-muted)" }}>{t.casesEmpty}</p>
          ) : (
            <ul style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, listStyle: "none" }}>
              {activeCases.slice(0, 3).map((item) => {
                const pct = progressPct(item);
                return (
                  <li key={item.id}>
                    <Link
                      href={`/cases/${item.id}`}
                      className="t-card t-card-interactive"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        padding: "14px 18px",
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--color-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {item.title}
                          </h3>
                          <span className={caseStatusClass(item.status)} style={{ fontSize: 11, padding: "2px 8px" }}>
                            {item.status}
                          </span>
                        </div>
                        <p style={{ marginTop: 4, fontSize: 12.5, color: "var(--color-ink-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          Next: {nextStep(item)}
                        </p>
                        {/* Progress */}
                        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                          <div className="t-progress-track" style={{ flex: 1, height: 4 }}>
                            <div className="t-progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span style={{ fontSize: 11, color: "var(--color-ink-muted)", flexShrink: 0 }}>
                            {progressLabel(item)}
                          </span>
                        </div>
                      </div>
                      <span style={{ color: "var(--color-primary)", flexShrink: 0 }} aria-hidden="true">
                        <ArrowRightIcon size={18} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
