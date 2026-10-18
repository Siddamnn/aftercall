# aftercall — 3-minute demo video script

Team Koffee after KitKat. Theme: Retail & Commerce, consumer intelligence. Motto: *You keep your conversations, we handle the rest.* Slide numbers refer to `aftercall-koffee-after-kitkat.pptx` (15 slides); the speaker notes carry the same lines. Record at 1080p. Final product: https://gen-lang-client-0902222994.web.app

Slide order: 1 Team details · 2 Brief · 3 Opportunities · 4 Features · 5 Process flow · 6 Wireframes · 7 Architecture · 8 Technologies · 9 Cost · 10 Snapshots · 11 Benchmarks · 12 Future · 13 Links · 14 Recap · 15 Thank you.

| Time | On screen | Say |
|---|---|---|
| 0:00-0:15 | Slide 1 | "Hi, I'm Siddharth from Koffee after KitKat. This is aftercall: you keep your conversations, we handle the rest. We built it on Google Cloud for Retail and Commerce, with a consumer-intelligence angle." |
| 0:15-0:40 | Slide 2 | "Retail and e-commerce brands talk to customers all day, in support calls, sales calls, WhatsApp and chat, but listen to almost none of it. Why customers buy, return, complain or churn stays buried. aftercall asks every conversation the same questions: trackers of signals, each a choice, a yes or no, or a score." |
| 0:40-1:00 | Slide 3 (then 5 briefly) | "It works with any tool, you write the questions, and TypeSafe Jev answers each signal with a confidence score, at a fraction of an LLM's cost. Only the calls it's unsure about go to a person. Cost is shown before anything runs." |
| 1:00-2:30 | LIVE app (slides 10/6 as fallback) | Sign in with Google (Firebase Auth) -> Trackers (conditional tracker) -> upload a recording or transcript -> cost preview -> run -> Results with confidence and review flag -> call detail -> Insights -> Ask alteria. "Gemini on Vertex AI transcribes the recording with speakers. Here is each answer with its confidence; this one is flagged for review. Insights show trends and breakdowns across uploads, and Ask alteria answers plain-English questions with cited calls." The sample data is a clinic-booking dataset; say so. Ask alteria returned an error on the last local test run (Gemini call failing), so verify it on the deployed build before recording; fall back to the wireframe on slide 6 if it still fails. |
| 2:30-2:50 | Slide 7 | "Firebase Hosting serves the React app and rewrites API calls to Cloud Run. Cloud Storage holds recordings, Cloud Tasks runs one task per call, Gemini on Vertex AI transcribes and powers Ask alteria, Jev answers the signals, and Firestore stores everything." |
| 2:50-3:00 | Slide 11, then 14 | "On our sample set, 25 of 25 answers matched hand labels, six calls in about six seconds, at a typical cost of about five thousandths of a cent per call on Jev. You keep your conversations, we handle the rest. Thanks." |

Tips: keep the live demo on one pre-uploaded sample and one fresh upload; rehearse to 2:55; put the repository and product links in the video description. Slides 4, 8, 9, 12 and 13 are for the written submission; use slide 9 only if you have spare seconds.
