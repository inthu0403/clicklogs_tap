# ClickLogs — User Interface Tap Timing Study

A web-based click/tap logging system that measures tap duration across device types
(Android vs PC) and interface conditions (feedback shown vs no feedback).

---

## Project Structure

```
clicklogs/
├── index.html       # Frontend — tap interface, data collection
├── index.css        # Styles
├── saveTaps.php     # Backend — receives POST data, writes to Firestore
├── queries.js       # Analytical queries (Q4a, Q4b, Q4c)
├── 2x/
│   └── round_touch_app_white_36dp.png
└── README.md
```

---

## How It Works

1. User opens the page and selects their device type (Android / PC). The platform
   button is also auto-detected and pre-hidden so mobile users only see "Android"
   and desktop users only see "PC".
2. The system randomly assigns a feedback mode (millisecond parity at page load).
3. The user taps the large button **50 times** (Round 1).
   - **Feedback mode**: shows live mean tap duration in milliseconds after each tap.
   - **No-feedback mode**: shows only a tap counter (X / 50).
4. After Round 1, the user clicks **Continue** to start Round 2 with the **opposite**
   feedback mode (counterbalanced within-subjects design).
5. After Round 2, all 100 tap records are **POST**ed to `saveTaps.php`, which writes
   them to Firebase Firestore. If the PHP backend is unavailable (e.g., GitHub Pages),
   the frontend falls back to a direct Firestore write.

---

## Hosting on GitHub Pages

GitHub Pages serves **static files only** — it cannot run PHP. Two options:

### Option A — GitHub Pages (static, Firestore fallback active)
1. Push all files to a GitHub repository.
2. Go to **Settings → Pages → Source → main branch / root**.
3. GitHub Pages will serve `index.html` directly.
4. Because `saveTaps.php` is unreachable, the frontend automatically falls back
   to writing directly to Firestore from the browser.

### Option B — PHP server (full backend path)
Host on any PHP-capable server (shared hosting, cPanel, DigitalOcean, etc.).
Upload all files. The `fetch("saveTaps.php", ...)` call will succeed and
data flows through the PHP backend before reaching Firestore.

---

## Firebase Firestore — Document Structure

### Collection: `tap_logs`

Each document represents **one tap** from one session. Auto-generated document IDs.

```
tap_logs/
└── {auto-id}
    ├── sessionId          : string   — unique per browser session (timestamp + random)
    ├── platform           : string   — "android" | "pc"
    ├── tapSequenceNumber  : integer  — 1 to 50 within a round
    ├── startTimestamp     : integer  — ms epoch (Date.now() at touchstart/mousedown)
    ├── endTimestamp       : integer  — ms epoch (Date.now() at touchend/mouseup)
    ├── durationMs         : integer  — endTimestamp − startTimestamp (pre-computed)
    ├── interfaceType      : string   — "feedbackshown" | "nofeedback"
    ├── interfaceSequence  : integer  — 1 (Round 1) or 2 (Round 2)
    └── serverTimestamp    : integer  — ms epoch when the batch was committed
```

### Design Decisions

**Q2a — What fields should be indexed for efficient querying?**

The following fields are used as query filters and should be indexed in Firestore:

| Field              | Why indexed                                                        |
|--------------------|--------------------------------------------------------------------|
| `platform`         | Q4a filters all documents by platform to compute mean duration     |
| `interfaceType`    | Q4b filters by interface condition                                 |
| `sessionId`        | Q4c groups by session to count completion vs dropout               |
| `interfaceSequence`| Q4c checks whether a session has records for sequence 1 AND 2     |
| `durationMs`       | Allows range queries and ORDER BY for percentile analysis          |

Composite index recommended:
- `platform` + `durationMs` (for Q4a with range filtering)
- `interfaceType` + `durationMs` (for Q4b)
- `sessionId` + `interfaceSequence` (for Q4c)

Add these in Firebase Console → Firestore → Indexes → Composite.

**Q2b — Session data vs individual tap relationship**

Individual taps are stored as **flat documents** in a single `tap_logs` collection.
The `sessionId` field links all taps from one session — acting as a foreign key.

A separate `sessions` collection was considered but rejected because:
- All analytical queries (Q4a–Q4c) operate on tap-level data.
- Firestore does not support JOIN-style queries, so a separate sessions collection
  would require two round-trips for every query.
- The flat model allows a single `collectionGroup` query to answer all questions.
- Session-level aggregates (total taps, completion status) can be derived from
  the tap records themselves using `interfaceSequence` as the indicator.

**Q2c — Store `durationMs` or compute during queries?**

`durationMs` is **stored pre-computed** as an integer field. Reasons:

- Firestore does not support computed/derived fields in queries. You cannot write
  `WHERE (endTimestamp - startTimestamp) < 500` — the arithmetic must happen
  client-side after fetching, which is expensive at scale.
- Storing `durationMs` allows `WHERE durationMs BETWEEN x AND y` and
  `ORDER BY durationMs` directly in the query, reducing data transferred.
- The cost (one extra integer field per document) is negligible.
- `startTimestamp` and `endTimestamp` are retained for audit purposes.

---

## Running the Queries (Q4a, Q4b, Q4c)

### Method 1 — Browser console (easiest)
1. Open your hosted `index.html` in a browser.
2. Open DevTools → Console.
3. Paste the contents of `queries.js` and press Enter.
4. Results print to the console.

### Method 2 — Add a query button to the page
Add this to `index.html` temporarily:
```html
<script src="queries.js"></script>
<button onclick="runAllQueries()">Run Analysis</button>
```

### Sample Output

```
╔══════════════════════════════════════════════════════╗
║         ClickLogs — Firestore Analysis Queries       ║
╚══════════════════════════════════════════════════════╝

=== Q4a: Mean Tap Duration — Android vs PC ===
  Platform: android    | Mean duration: 187 ms | Tap count: 1450
  Platform: pc         | Mean duration: 134 ms | Tap count: 980

=== Q4b: Mean Tap Duration — feedbackshown vs nofeedback ===
  Interface: feedbackshown    | Mean duration: 201 ms | Tap count: 1200
  Interface: nofeedback       | Mean duration: 156 ms | Tap count: 1230

  Difference (feedbackshown − nofeedback): +45 ms
  Interpretation: users tapped 45 ms slower when feedback was shown.

=== Q4c: Session Completion — Both Variations vs Dropout ===

  Total sessions    : 48
  Completed both    : 39  (81.3%)
  Dropped after R1  : 9   (18.7%)

  Breakdown by platform:
    android: completed=22, dropped=5
    pc:      completed=17, dropped=4

✅ All queries complete.
```

---

## Security Note

The Firebase API key in `index.html` is a **client-side key** — this is normal for
Firebase web apps. Restrict it in the Firebase Console under
**Project Settings → API restrictions** to only allow your GitHub Pages domain.
Set Firestore Security Rules to allow writes but not reads from anonymous users:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tap_logs/{doc} {
      allow write: if true;      // anyone can submit taps
      allow read:  if false;     // only admin (Firebase Console) can read
    }
  }
}
```
