"use client";

import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Case, Workflow } from "../domain/types";
import { SpeechInput } from "./speech/SpeechInput";
import { insertTranscript, SpeechLanguage } from "./speech/transcription";

const copy = {
  en: {
    yourCases: "Your cases", languageLabel: "Website language", eyebrow: "A steady hand for life’s paperwork", title: "What do you need help getting done?",
    intro: "Tell TRESTLE what happened. It organizes the next steps, checks official guidance, and brings you in whenever a decision or personal action is needed.",
    describe: "Describe your situation", placeholder: "For example: I keep getting unwanted calls from a number and want to know the right way to report them.",
    submit: "Get started", preparing: "Preparing your next steps…", reviewed: "Your plan is reviewed before it becomes a case.",
    examples: "Or start with an example", example1: "I received repeated unwanted calls or messages and want to understand where to report them.",
    example2: "I lost my wallet and need to secure my cards and replace my driving licence.", example3: "I need help understanding the official steps after moving to a new city.",
    report: "Report unwanted calls", replace: "Replace lost documents", move: "Prepare for a move",
    sideTitle: "A clearer way through", step1: "Tell us what happened", detail1: "Start in your own words. No workflow knowledge needed.",
    step2: "See the next useful step", detail2: "TRESTLE checks dependencies and finds relevant public guidance.",
    step3: "Stay in control", detail3: "Review information and handle sensitive or consequential steps yourself.",
    note: "Research and preparation are shown separately from external actions. TRESTLE never treats a page visit as proof that something was submitted.",
    proposalEyebrow: "Your plan is ready to review", edit: "Edit description", create: "Create my case", saving: "Saving…",
    what: "What TRESTLE will work through", localFallback: "Prepared with TRESTLE’s local workflow rules because Groq planning was unavailable or did not meet the workflow safety checks.",
    drafted: "Groq drafted these steps from a privacy-screened event description. TRESTLE checks the plan before you save; contact, account, and identity numbers are not sent to Groq.",
    resume: "Pick up where you left off", cases: "Your cases", saved: "saved", empty: "Cases you create will appear here.",
  },
  hi: {
    yourCases: "आपके मामले", languageLabel: "वेबसाइट की भाषा", eyebrow: "ज़रूरी कामों के लिए एक मददगार साथी", title: "आपको किस काम में मदद चाहिए?",
    intro: "TRESTLE को बताइए कि क्या हुआ। यह अगले कदम व्यवस्थित करता है, आधिकारिक जानकारी ढूँढ़ता है और ज़रूरत पड़ने पर आपको निर्णय लेने में शामिल करता है।",
    describe: "अपनी स्थिति बताएँ", placeholder: "उदाहरण: मुझे बार-बार अनचाहे कॉल आ रहे हैं। मैं जानना चाहता हूँ कि इसकी शिकायत कहाँ करें।",
    submit: "शुरू करें", preparing: "अगले कदम तैयार हो रहे हैं…", reviewed: "मामला बनाने से पहले आप योजना की समीक्षा करेंगे।",
    examples: "या कोई उदाहरण चुनें", example1: "मुझे बार-बार अनचाहे कॉल या संदेश मिल रहे हैं और मैं शिकायत की जगह जानना चाहता हूँ।",
    example2: "मेरा बटुआ खो गया है। मुझे कार्ड सुरक्षित करने और ड्राइविंग लाइसेंस बदलने में मदद चाहिए।", example3: "नए शहर में जाने के बाद ज़रूरी आधिकारिक कदम समझने में मदद चाहिए।",
    report: "अनचाहे कॉल की शिकायत", replace: "खोए दस्तावेज़ बदलें", move: "शहर बदलने की तैयारी",
    sideTitle: "आगे बढ़ने का आसान तरीका", step1: "बताएँ कि क्या हुआ", detail1: "अपने शब्दों में बताएँ। किसी प्रक्रिया को जानना ज़रूरी नहीं।",
    step2: "अगला उपयोगी कदम देखें", detail2: "TRESTLE ज़रूरी निर्भरताएँ जाँचता है और आधिकारिक जानकारी ढूँढ़ता है।",
    step3: "नियंत्रण आपके हाथ में", detail3: "जानकारी की समीक्षा करें और संवेदनशील या महत्वपूर्ण कदम खुद उठाएँ।",
    note: "जानकारी और तैयारी को बाहरी कार्रवाइयों से अलग दिखाया जाता है। TRESTLE किसी पेज पर जाना, फ़ॉर्म जमा होने का प्रमाण नहीं मानता।",
    proposalEyebrow: "आपकी योजना समीक्षा के लिए तैयार है", edit: "विवरण संपादित करें", create: "मेरा मामला बनाएँ", saving: "सहेजा जा रहा है…",
    what: "TRESTLE के सुझाए कदम", localFallback: "Groq उपलब्ध न होने या सुरक्षा जाँच में योजना सफल न होने पर TRESTLE के स्थानीय नियमों से यह योजना बनाई गई है।",
    drafted: "Groq ने गोपनीयता-सुरक्षित विवरण से ये कदम सुझाए हैं। सहेजने से पहले TRESTLE योजना जाँचता है; संपर्क, खाते और पहचान संख्या Groq को नहीं भेजी जातीं।",
    resume: "जहाँ छोड़ा था वहाँ से शुरू करें", cases: "आपके मामले", saved: "सहेजे गए", empty: "आपके बनाए मामले यहाँ दिखेंगे।",
  },
  bn: {
    yourCases: "আপনার কেস", languageLabel: "ওয়েবসাইটের ভাষা", eyebrow: "জীবনের জরুরি কাজ সামলাতে পাশে আছে", title: "কোন কাজটি করতে আপনার সাহায্য দরকার?",
    intro: "কী ঘটেছে TRESTLE-কে বলুন। এটি পরের ধাপগুলো সাজায়, সরকারি নির্দেশনা খুঁজে দেয় এবং সিদ্ধান্ত বা ব্যক্তিগত কাজের সময় আপনাকে যুক্ত রাখে।",
    describe: "আপনার পরিস্থিতি বর্ণনা করুন", placeholder: "যেমন: একটি নম্বর থেকে বারবার বিরক্তিকর ফোন পাচ্ছি। কোথায় অভিযোগ করব জানতে চাই।",
    submit: "শুরু করুন", preparing: "পরের ধাপ তৈরি হচ্ছে…", reviewed: "কেস তৈরির আগে আপনি পরিকল্পনাটি পর্যালোচনা করবেন।",
    examples: "অথবা একটি উদাহরণ বেছে নিন", example1: "বারবার অবাঞ্ছিত ফোন বা বার্তা পাচ্ছি। কোথায় অভিযোগ করব জানতে চাই।",
    example2: "আমার মানিব্যাগ হারিয়েছে। কার্ড সুরক্ষিত করতে ও ড্রাইভিং লাইসেন্স বদলাতে হবে।", example3: "নতুন শহরে যাওয়ার পর সরকারি কাজগুলো বুঝতে সাহায্য চাই।",
    report: "অবাঞ্ছিত ফোনের অভিযোগ", replace: "হারানো নথি বদলান", move: "শহর বদলের প্রস্তুতি",
    sideTitle: "সহজভাবে এগিয়ে চলুন", step1: "কী ঘটেছে বলুন", detail1: "নিজের ভাষায় বলুন। কোনো প্রক্রিয়া জানা দরকার নেই।",
    step2: "পরের দরকারি ধাপ দেখুন", detail2: "TRESTLE নির্ভরতা যাচাই করে প্রাসঙ্গিক সরকারি তথ্য খুঁজে দেয়।",
    step3: "নিয়ন্ত্রণ আপনার হাতে", detail3: "তথ্য পর্যালোচনা করুন এবং সংবেদনশীল বা গুরুত্বপূর্ণ কাজ নিজে করুন।",
    note: "তথ্য ও প্রস্তুতিকে বাইরের কাজ থেকে আলাদা দেখানো হয়। কোনো পেজ দেখা হয়েছে মানেই কিছু জমা হয়েছে—TRESTLE তা ধরে নেয় না।",
    proposalEyebrow: "আপনার পরিকল্পনা পর্যালোচনার জন্য প্রস্তুত", edit: "বিবরণ সম্পাদনা", create: "আমার কেস তৈরি করুন", saving: "সংরক্ষণ হচ্ছে…",
    what: "TRESTLE যে ধাপগুলো সম্পন্ন করবে", localFallback: "Groq পরিকল্পনা অনুপলব্ধ ছিল বা নিরাপত্তা যাচাইয়ে উত্তীর্ণ হয়নি, তাই TRESTLE-এর স্থানীয় নিয়মে পরিকল্পনাটি তৈরি হয়েছে।",
    drafted: "গোপনীয়তা-সুরক্ষিত বিবরণ থেকে Groq ধাপগুলো সাজিয়েছে। সংরক্ষণের আগে TRESTLE পরিকল্পনাটি যাচাই করে; যোগাযোগ, অ্যাকাউন্ট ও পরিচয় নম্বর Groq-এ পাঠানো হয় না।",
    resume: "যেখান থেকে থেমেছিলেন সেখান থেকে শুরু করুন", cases: "আপনার কেস", saved: "টি সংরক্ষিত", empty: "আপনার তৈরি কেসগুলো এখানে দেখা যাবে।",
  },
  gu: {
    yourCases: "તમારા કેસ", languageLabel: "વેબસાઇટની ભાષા", eyebrow: "જરૂરી કામોમાં તમારી સાથે", title: "તમારે કયું કામ પૂરું કરવામાં મદદ જોઈએ છે?",
    intro: "શું થયું તે TRESTLEને કહો. તે આગળનાં પગલાં ગોઠવે છે, સત્તાવાર માર્ગદર્શન શોધે છે અને નિર્ણય કે વ્યક્તિગત પગલાં વખતે તમને સામેલ રાખે છે.",
    describe: "તમારી પરિસ્થિતિ જણાવો", placeholder: "ઉદાહરણ: એક નંબર પરથી વારંવાર અનિચ્છનીય ફોન આવે છે. ફરિયાદ ક્યાં કરવી તે જાણવા માગું છું.",
    submit: "શરૂ કરો", preparing: "આગળનાં પગલાં તૈયાર થઈ રહ્યાં છે…", reviewed: "કેસ બનાવતાં પહેલાં તમે યોજનાની સમીક્ષા કરશો.",
    examples: "અથવા ઉદાહરણ પસંદ કરો", example1: "વારંવાર અનિચ્છનીય ફોન કે સંદેશા આવે છે. ફરિયાદ ક્યાં કરવી તે જાણવા માગું છું.",
    example2: "મારું પાકીટ ખોવાઈ ગયું છે. કાર્ડ સુરક્ષિત કરવા અને ડ્રાઇવિંગ લાઇસન્સ બદલવા મદદ જોઈએ.", example3: "નવા શહેરમાં ગયા પછીનાં સત્તાવાર પગલાં સમજવામાં મદદ જોઈએ.",
    report: "અનિચ્છનીય ફોનની ફરિયાદ", replace: "ખોવાયેલા દસ્તાવેજ બદલો", move: "શહેર બદલવાની તૈયારી",
    sideTitle: "આગળ વધવાનો સરળ રસ્તો", step1: "શું થયું તે કહો", detail1: "તમારા શબ્દોમાં કહો. કોઈ પ્રક્રિયા જાણવાની જરૂર નથી.",
    step2: "આગળનું ઉપયોગી પગલું જુઓ", detail2: "TRESTLE જરૂરી નિર્ભરતાઓ તપાસે છે અને સંબંધિત સત્તાવાર માહિતી શોધે છે.",
    step3: "નિયંત્રણ તમારા હાથમાં", detail3: "માહિતી તપાસો અને સંવેદનશીલ કે મહત્ત્વનાં પગલાં જાતે લો.",
    note: "માહિતી અને તૈયારીને બાહ્ય કાર્યવાહીથી અલગ દર્શાવવામાં આવે છે. પેજની મુલાકાતને TRESTLE ક્યારેય ફોર્મ સબમિટ થયાનો પુરાવો માનતું નથી.",
    proposalEyebrow: "તમારી યોજના સમીક્ષા માટે તૈયાર છે", edit: "વર્ણન સંપાદિત કરો", create: "મારો કેસ બનાવો", saving: "સાચવી રહ્યા છીએ…",
    what: "TRESTLE કયા પગલાં લેશે", localFallback: "Groq ઉપલબ્ધ ન હોવાથી અથવા સુરક્ષા તપાસમાં યોજના યોગ્ય ન હોવાથી TRESTLEના સ્થાનિક નિયમોથી આ યોજના તૈયાર થઈ છે.",
    drafted: "ગોપનીયતા-સુરક્ષિત વર્ણન પરથી Groqએ આ પગલાં બનાવ્યાં છે. સાચવતાં પહેલાં TRESTLE યોજના તપાસે છે; સંપર્ક, એકાઉન્ટ અને ઓળખ નંબર Groqને મોકલાતા નથી.",
    resume: "જ્યાંથી અટક્યા હતા ત્યાંથી આગળ વધો", cases: "તમારા કેસ", saved: "સાચવેલા", empty: "તમે બનાવેલા કેસ અહીં દેખાશે.",
  },
  pa: {
    yourCases: "ਤੁਹਾਡੇ ਕੇਸ", languageLabel: "ਵੈੱਬਸਾਈਟ ਦੀ ਭਾਸ਼ਾ", eyebrow: "ਜ਼ਰੂਰੀ ਕੰਮਾਂ ਵਿੱਚ ਤੁਹਾਡੇ ਨਾਲ", title: "ਤੁਹਾਨੂੰ ਕਿਹੜਾ ਕੰਮ ਪੂਰਾ ਕਰਨ ਵਿੱਚ ਮਦਦ ਚਾਹੀਦੀ ਹੈ?",
    intro: "ਕੀ ਹੋਇਆ, TRESTLE ਨੂੰ ਦੱਸੋ। ਇਹ ਅਗਲੇ ਕਦਮ ਸਜਾਉਂਦਾ ਹੈ, ਸਰਕਾਰੀ ਜਾਣਕਾਰੀ ਲੱਭਦਾ ਹੈ ਅਤੇ ਫ਼ੈਸਲੇ ਜਾਂ ਨਿੱਜੀ ਕੰਮ ਵੇਲੇ ਤੁਹਾਨੂੰ ਸ਼ਾਮਲ ਰੱਖਦਾ ਹੈ।",
    describe: "ਆਪਣੀ ਸਥਿਤੀ ਦੱਸੋ", placeholder: "ਉਦਾਹਰਨ: ਇੱਕ ਨੰਬਰ ਤੋਂ ਵਾਰ-ਵਾਰ ਅਣਚਾਹੀਆਂ ਕਾਲਾਂ ਆ ਰਹੀਆਂ ਹਨ। ਮੈਂ ਜਾਣਨਾ ਚਾਹੁੰਦਾ ਹਾਂ ਕਿ ਸ਼ਿਕਾਇਤ ਕਿੱਥੇ ਕਰਾਂ।",
    submit: "ਸ਼ੁਰੂ ਕਰੋ", preparing: "ਅਗਲੇ ਕਦਮ ਤਿਆਰ ਹੋ ਰਹੇ ਹਨ…", reviewed: "ਕੇਸ ਬਣਨ ਤੋਂ ਪਹਿਲਾਂ ਤੁਸੀਂ ਯੋਜਨਾ ਦੀ ਸਮੀਖਿਆ ਕਰੋਗੇ।",
    examples: "ਜਾਂ ਕੋਈ ਉਦਾਹਰਨ ਚੁਣੋ", example1: "ਵਾਰ-ਵਾਰ ਅਣਚਾਹੀਆਂ ਕਾਲਾਂ ਜਾਂ ਸੁਨੇਹੇ ਆਉਂਦੇ ਹਨ। ਸ਼ਿਕਾਇਤ ਕਿੱਥੇ ਕਰਾਂ, ਇਹ ਜਾਣਨਾ ਚਾਹੁੰਦਾ ਹਾਂ।",
    example2: "ਮੇਰਾ ਬਟੂਆ ਗੁੰਮ ਗਿਆ ਹੈ। ਕਾਰਡ ਸੁਰੱਖਿਅਤ ਕਰਨ ਅਤੇ ਡਰਾਈਵਿੰਗ ਲਾਇਸੈਂਸ ਬਦਲਣ ਵਿੱਚ ਮਦਦ ਚਾਹੀਦੀ ਹੈ।", example3: "ਨਵੇਂ ਸ਼ਹਿਰ ਜਾਣ ਤੋਂ ਬਾਅਦ ਸਰਕਾਰੀ ਕਦਮ ਸਮਝਣ ਵਿੱਚ ਮਦਦ ਚਾਹੀਦੀ ਹੈ।",
    report: "ਅਣਚਾਹੀਆਂ ਕਾਲਾਂ ਦੀ ਸ਼ਿਕਾਇਤ", replace: "ਗੁੰਮ ਦਸਤਾਵੇਜ਼ ਬਦਲੋ", move: "ਸ਼ਹਿਰ ਬਦਲਣ ਦੀ ਤਿਆਰੀ",
    sideTitle: "ਅੱਗੇ ਵਧਣ ਦਾ ਸੌਖਾ ਰਾਹ", step1: "ਦੱਸੋ ਕੀ ਹੋਇਆ", detail1: "ਆਪਣੇ ਸ਼ਬਦਾਂ ਵਿੱਚ ਦੱਸੋ। ਕਿਸੇ ਪ੍ਰਕਿਰਿਆ ਦੀ ਜਾਣਕਾਰੀ ਲੋੜੀਂਦੀ ਨਹੀਂ।",
    step2: "ਅਗਲਾ ਲਾਭਦਾਇਕ ਕਦਮ ਵੇਖੋ", detail2: "TRESTLE ਨਿਰਭਰਤਾਵਾਂ ਜਾਂਚਦਾ ਹੈ ਅਤੇ ਸੰਬੰਧਿਤ ਸਰਕਾਰੀ ਜਾਣਕਾਰੀ ਲੱਭਦਾ ਹੈ।",
    step3: "ਕਾਬੂ ਤੁਹਾਡੇ ਹੱਥ ਵਿੱਚ", detail3: "ਜਾਣਕਾਰੀ ਦੀ ਸਮੀਖਿਆ ਕਰੋ ਅਤੇ ਸੰਵੇਦਨਸ਼ੀਲ ਜਾਂ ਅਹਿਮ ਕਦਮ ਖੁਦ ਚੁੱਕੋ।",
    note: "ਜਾਣਕਾਰੀ ਅਤੇ ਤਿਆਰੀ ਨੂੰ ਬਾਹਰੀ ਕਾਰਵਾਈਆਂ ਤੋਂ ਵੱਖ ਦਿਖਾਇਆ ਜਾਂਦਾ ਹੈ। TRESTLE ਪੇਜ ਦੇਖਣ ਨੂੰ ਫ਼ਾਰਮ ਜਮ੍ਹਾਂ ਹੋਣ ਦਾ ਸਬੂਤ ਨਹੀਂ ਮੰਨਦਾ।",
    proposalEyebrow: "ਤੁਹਾਡੀ ਯੋਜਨਾ ਸਮੀਖਿਆ ਲਈ ਤਿਆਰ ਹੈ", edit: "ਵੇਰਵਾ ਸੋਧੋ", create: "ਮੇਰਾ ਕੇਸ ਬਣਾਓ", saving: "ਸੰਭਾਲਿਆ ਜਾ ਰਿਹਾ ਹੈ…",
    what: "TRESTLE ਕਿਹੜੇ ਕਦਮਾਂ ਵਿੱਚ ਮਦਦ ਕਰੇਗਾ", localFallback: "Groq ਉਪਲਬਧ ਨਾ ਹੋਣ ਜਾਂ ਸੁਰੱਖਿਆ ਜਾਂਚ ਪੂਰੀ ਨਾ ਹੋਣ ਕਰਕੇ TRESTLE ਦੇ ਸਥਾਨਕ ਨਿਯਮਾਂ ਨਾਲ ਇਹ ਯੋਜਨਾ ਬਣਾਈ ਗਈ ਹੈ।",
    drafted: "ਗੋਪਨੀਯਤਾ-ਸੁਰੱਖਿਅਤ ਵੇਰਵੇ ਤੋਂ Groq ਨੇ ਇਹ ਕਦਮ ਤਿਆਰ ਕੀਤੇ ਹਨ। ਸੰਭਾਲਣ ਤੋਂ ਪਹਿਲਾਂ TRESTLE ਯੋਜਨਾ ਜਾਂਚਦਾ ਹੈ; ਸੰਪਰਕ, ਖਾਤਾ ਅਤੇ ਪਛਾਣ ਨੰਬਰ Groq ਨੂੰ ਨਹੀਂ ਭੇਜੇ ਜਾਂਦੇ।",
    resume: "ਜਿੱਥੇ ਛੱਡਿਆ ਸੀ ਉੱਥੋਂ ਜਾਰੀ ਰੱਖੋ", cases: "ਤੁਹਾਡੇ ਕੇਸ", saved: "ਸੰਭਾਲੇ", empty: "ਤੁਹਾਡੇ ਬਣਾਏ ਕੇਸ ਇੱਥੇ ਦਿਖਣਗੇ।",
  },
} as const;

function progress(item: Case, language: SpeechLanguage) {
  const complete = item.actions.filter((action) => action.status === "completed").length;
  const counts: Record<SpeechLanguage, string> = {
    en: `${complete} of ${item.actions.length} steps`, hi: `${item.actions.length} में से ${complete} कदम`,
    bn: `${item.actions.length}টির মধ্যে ${complete}টি ধাপ`, gu: `${item.actions.length}માંથી ${complete} પગલાં`,
    pa: `${item.actions.length} ਵਿੱਚੋਂ ${complete} ਕਦਮ`,
  };
  return counts[language];
}

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

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [cases, setCases] = useState<Case[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<Workflow | null>(null);
  const [proposalSource, setProposalSource] = useState("");
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
    fetch("/api/cases", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : [])
      .then(setCases)
      .catch(() => setMessage("Saved cases could not be loaded. You can still start a new case."));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setMessage("");
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

  return (
    <main className="trestle-home min-h-screen" lang={language}>
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-7 sm:px-8 sm:pt-10">
        <nav className="flex items-center justify-between" aria-label="Main navigation">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-[#1e3737]">
            <span className="grid size-9 place-items-center rounded-xl bg-[#176b66] text-sm font-bold text-white">T</span>
            TRESTLE
          </Link>
          <div className="flex items-center gap-4">
            <label htmlFor="site-language" className="sr-only">{t.languageLabel}</label>
            <select id="site-language" value={language} onChange={(event) => changeLanguage(event.target.value as SpeechLanguage)} className="rounded-lg border border-[#d8dfd9] bg-white px-2.5 py-2 text-sm font-medium text-[#344548] outline-none focus:border-[#398b82] focus:ring-4 focus:ring-[#398b82]/10">
              <option value="en">English</option><option value="hi">हिन्दी</option><option value="bn">বাংলা</option><option value="gu">ગુજરાતી</option><option value="pa">ਪੰਜਾਬੀ</option>
            </select>
            <a href="#saved-cases" className="text-sm font-medium text-[#536361] hover:text-[#176b66]">{t.yourCases}</a>
          </div>
        </nav>

        <section className="mt-16 grid items-start gap-12 lg:mt-24 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.65fr)] lg:gap-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.16em] text-[#287d76]">{t.eyebrow}</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-[-.035em] text-[#1d2c32] sm:text-5xl">
              {t.title}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#5d6a6a]">
              {t.intro}
            </p>

            <form onSubmit={submit} className="mt-8">
              <label htmlFor="event" className="mb-2 block text-sm font-semibold text-[#344548]">{t.describe}</label>
              <textarea
                id="event"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={t.placeholder}
                maxLength={4000}
                className="min-h-36 w-full resize-y rounded-2xl border border-[#d8dfd9] bg-white p-4 text-[15px] leading-6 text-[#263638] shadow-[0_8px_30px_-24px_rgba(24,56,51,.35)] outline-none transition focus:border-[#398b82] focus:ring-4 focus:ring-[#398b82]/10 placeholder:text-[#9aa4a0]"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <SpeechInput language={language} onTranscript={(transcript) => setInput((current) => insertTranscript(current, transcript))} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button disabled={loading || !input.trim()} className="rounded-xl bg-[#176b66] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#105a56] disabled:cursor-not-allowed disabled:opacity-50">
                  {loading ? t.preparing : t.submit}
                </button>
                <span className="text-xs text-[#7a8581]">{t.reviewed}</span>
              </div>
            </form>

            <div className="mt-7">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[.12em] text-[#77827d]">{t.examples}</p>
              <div className="flex flex-wrap gap-2">
                {[t.example1, t.example2, t.example3].map((suggestion, index) => (
                  <button key={suggestion} type="button" onClick={() => setInput(suggestion)} className="rounded-full border border-[#dce2dc] bg-white/70 px-3.5 py-2 text-left text-xs leading-5 text-[#51615e] transition hover:border-[#87b6ae] hover:text-[#176b66]">
                    {[t.report, t.replace, t.move][index]}
                  </button>
                ))}
              </div>
            </div>

            {message && <p role="alert" className="mt-5 rounded-xl border border-[#e5c9c0] bg-[#fff5f1] p-3 text-sm text-[#8e4032]">{message}</p>}
          </div>

          <aside className="border-t border-[#dfe4de] pt-6 lg:mt-1 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <p className="text-sm font-semibold text-[#334645]">{t.sideTitle}</p>
            <ol className="mt-5 space-y-5">
              {[
                ["01", t.step1, t.detail1],
                ["02", t.step2, t.detail2],
                ["03", t.step3, t.detail3],
              ].map(([number, title, detail]) => (
                <li key={number} className="flex gap-3">
                  <span className="mt-0.5 text-xs font-semibold tabular-nums text-[#6c8c82]">{number}</span>
                  <div><h2 className="text-sm font-semibold text-[#344548]">{title}</h2><p className="mt-1 text-sm leading-6 text-[#74807d]">{detail}</p></div>
                </li>
              ))}
            </ol>
            <p className="mt-6 border-t border-[#e1e5df] pt-4 text-xs leading-5 text-[#87918c]">{t.note}</p>
          </aside>
        </section>

        {proposal && (
          <section className="mt-12 rounded-2xl border border-[#cbdcd4] bg-white p-5 shadow-[0_20px_50px_-40px_rgba(24,56,51,.5)] sm:p-7" aria-labelledby="proposal-title">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#287d76]">{t.proposalEyebrow}</p>
                <h2 id="proposal-title" className="mt-2 text-2xl font-semibold tracking-tight text-[#203333]">{proposal.title}</h2>
                <p className="mt-2 text-sm leading-6 text-[#66736f]">{proposal.description}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setProposal(null)} className="rounded-xl border border-[#d9e0da] px-4 py-2.5 text-sm font-medium text-[#53615e] hover:bg-[#f6f7f3]">{t.edit}</button>
                <button type="button" onClick={saveProposal} disabled={loading} className="rounded-xl bg-[#176b66] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#105a56] disabled:opacity-50">{loading ? t.saving : t.create}</button>
              </div>
            </div>
            <div className="mt-6 border-t border-[#edf0eb] pt-4">
              <p className="text-sm font-semibold text-[#40504d]">{t.what}</p>
              <ol className="mt-3 divide-y divide-[#edf0eb]">
                {proposal.actions.map((action) => <li key={action.id} className="flex gap-3 py-3 text-sm">
                  <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-[#e8f2ed] text-[11px] font-semibold text-[#287d76]">✓</span>
                  <div><p className="font-medium text-[#344548]">{action.title}</p><p className="mt-1 leading-5 text-[#75817d]">{action.description}</p></div>
                </li>)}
              </ol>
              <p className="mt-3 text-xs text-[#89938e]">{proposalSource === "deterministic-fallback" ? t.localFallback : t.drafted}</p>
            </div>
          </section>
        )}

        <section id="saved-cases" className="mt-20 scroll-mt-8 border-t border-[#dfe4de] pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#75817d]">{t.resume}</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-[#233332]">{t.cases}</h2></div>
            <span className="text-sm text-[#7f8985]">{cases.length} {t.saved}</span>
          </div>
          {cases.length === 0 ? <p className="mt-5 text-sm text-[#77827d]">{t.empty}</p> : (
            <ul className="mt-5 divide-y divide-[#e4e8e2]">
              {cases.map((item) => (
                <li key={item.id}>
                  <Link href={`/cases/${item.id}`} className="group flex flex-col gap-2 py-4 transition sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0"><h3 className="font-semibold text-[#344548] group-hover:text-[#176b66]">{item.title}</h3><p className="mt-1 line-clamp-1 text-sm text-[#77827d]">{item.originalInput}</p></div>
                    <span className="shrink-0 text-xs font-medium text-[#64736e]">{progress(item, language)} <span aria-hidden="true">→</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
