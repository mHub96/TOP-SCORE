# 🧠 TOP SCORE — Neurosurgery Board Trainer (PWA)

An offline-first Progressive Web App for memorizing every chapter of
*Top Score for the Neurosurgery Board Examination: Questions and Answers* (Tarar et al., Thieme 2025).

- **2,187 MCQs · 116 chapters · 22 parts**, extracted verbatim from the book.
- Every answer key verified: the printed answer letter is matched against the printed answer text,
  and the letters were cross-checked with two independent PDF extraction engines.
  Where the book is internally inconsistent (3 questions), an ℹ️ note explains which option is used.

## Study modes
| Mode | What it does |
|---|---|
| 🧠 Smart Review | FSRS-5 spaced repetition — due questions first, then new ones |
| 🎯 MCQ Challenge | Exam on all questions, score, then retry missed or all again |
| 📖 Learn | Read questions with the key highlighted; “cover answers” self-test |
| 🃏 Flashcards | Flip & rate Again/Hard/Good/Easy (swipe gestures) |
| 🔀 Shuffle Mix | Interleaved random questions with shuffled options |
| 🎚️ Confidence Mode | Certainty-based marking + calibration chart |
| ⏱️ Exam Simulator | Timed block, flag & navigate, full review |
| ❌ Mistakes Vault / ⭐ Starred | Targeted practice |

## Games
⚡ Speed Blitz · ❤️ Survival · 🐉 Boss Battle · ✅ True or False (swipe) · 🧩 Match Pairs · 🥊 Knockout

## Progress & stats
XP, levels, ranks, streaks, 26 achievements, knowledge-growth chart, mastery donut, review forecast,
daily accuracy, activity heatmap, mastery radar by part, confidence calibration, chapter table.

Progress is stored **locally** in the browser. Use **Settings → Export backup** regularly
(the app reminds you) and **Restore from file** to resume on any device.

## 📖 Optional Greenberg explanation pack
The app can show **verbatim passages, tables and figures from Greenberg's Handbook of Neurosurgery (10th ed.)**
behind every answer, with a ✅ Verified / 🔶 Related / ⚠️ Differs-from-key label and a page reader.
This content is **not** in this repository: it comes from a private `.tspack` file the owner loads once in
**Settings → Greenberg explanation pack** (stored only in that browser's IndexedDB).

## Run locally
```
cd docs
python -m http.server 8000
```
Open http://localhost:8000. The app lives in `docs/` (ready for GitHub Pages → branch `main`, folder `/docs`).

> Question content © Thieme. For personal study use only.
