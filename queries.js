/**
 * queries.js
 * Firestore analytical queries for the ClickLogs study.
 *
 * Run in the browser console on a page that already has Firebase initialised,
 * OR paste each function into the Firebase Firestore console query builder.
 *
 * Answers:
 *   Q4a — Mean tap duration: Android vs PC
 *   Q4b — Mean tap duration: feedbackshown vs nofeedback
 *   Q4c — Users who completed both interface variations vs dropped off
 */

// ── Firestore reference (reuses the db already set up in index.html) ─────────
// If running standalone, initialise Firebase first and set:
//   const db = firebase.firestore();

// ============================================================================
// Q4a — Mean tap duration for Android vs PC users
// ============================================================================
async function queryMeanDurationByPlatform() {
    console.log("=== Q4a: Mean Tap Duration — Android vs PC ===");

    const snap = await db.collection("tap_logs").get();

    // Group durationMs values by platform
    const groups = {};   // { "android": [150, 200, ...], "pc": [100, 130, ...] }

    snap.forEach(doc => {
        const d = doc.data();
        const platform = d.platform || "unknown";
        const dur      = d.durationMs;

        // Skip any corrupted or missing values
        if (typeof dur !== "number" || dur < 0 || dur > 5000) return;

        if (!groups[platform]) groups[platform] = [];
        groups[platform].push(dur);
    });

    // Calculate and display mean per platform
    const results = {};
    for (const platform in groups) {
        const durations = groups[platform];
        const mean      = durations.reduce((a, b) => a + b, 0) / durations.length;
        const count     = durations.length;
        results[platform] = { mean: Math.round(mean), count };
        console.log(
            `  Platform: ${platform.padEnd(10)} | ` +
            `Mean duration: ${Math.round(mean)} ms | ` +
            `Tap count: ${count}`
        );
    }

    return results;
}

// ============================================================================
// Q4b — Average tap duration: feedbackshown vs nofeedback interfaces
// ============================================================================
async function queryMeanDurationByInterface() {
    console.log("=== Q4b: Mean Tap Duration — feedbackshown vs nofeedback ===");

    const snap = await db.collection("tap_logs").get();

    const groups = {};   // { "feedbackshown": [...], "nofeedback": [...] }

    snap.forEach(doc => {
        const d    = doc.data();
        const iface = d.interfaceType || "unknown";
        const dur   = d.durationMs;

        if (typeof dur !== "number" || dur < 0 || dur > 5000) return;

        if (!groups[iface]) groups[iface] = [];
        groups[iface].push(dur);
    });

    const results = {};
    for (const iface in groups) {
        const durations = groups[iface];
        const mean      = durations.reduce((a, b) => a + b, 0) / durations.length;
        const count     = durations.length;
        results[iface] = { mean: Math.round(mean), count };
        console.log(
            `  Interface: ${iface.padEnd(15)} | ` +
            `Mean duration: ${Math.round(mean)} ms | ` +
            `Tap count: ${count}`
        );
    }

    // Compute the difference so it is easy to interpret
    const fb   = results["feedbackshown"]  ? results["feedbackshown"].mean  : null;
    const nofb = results["nofeedback"]     ? results["nofeedback"].mean     : null;
    if (fb !== null && nofb !== null) {
        const diff = fb - nofb;
        console.log(
            `\n  Difference (feedbackshown − nofeedback): ${diff > 0 ? "+" : ""}${diff} ms`
        );
        console.log(
            `  Interpretation: users tapped ${Math.abs(diff)} ms ` +
            `${diff > 0 ? "slower" : "faster"} when feedback was shown.`
        );
    }

    return results;
}

// ============================================================================
// Q4c — How many users completed BOTH interface variations vs dropped off
// ============================================================================
async function queryCompletionVsDropoff() {
    console.log("=== Q4c: Session Completion — Both Variations vs Dropout ===");

    const snap = await db.collection("tap_logs").get();

    // Build a map: sessionId → Set of interfaceSequence values seen
    // interfaceSequence=1 means round 1, interfaceSequence=2 means round 2
    const sessionSequences = {};   // { sessionId: Set{1, 2} }
    const sessionPlatform  = {};   // { sessionId: "android"|"pc" }

    snap.forEach(doc => {
        const d   = doc.data();
        const sid = d.sessionId;
        const seq = d.interfaceSequence;

        if (!sid) return;

        if (!sessionSequences[sid]) {
            sessionSequences[sid] = new Set();
            sessionPlatform[sid]  = d.platform || "unknown";
        }
        sessionSequences[sid].add(seq);
    });

    // Classify each session
    let completed = 0;   // saw both sequence 1 and sequence 2
    let droppedOff = 0;  // only saw sequence 1

    const completedSessions = [];
    const droppedSessions   = [];

    for (const sid in sessionSequences) {
        const seqs = sessionSequences[sid];
        if (seqs.has(1) && seqs.has(2)) {
            completed++;
            completedSessions.push({ sid, platform: sessionPlatform[sid] });
        } else {
            droppedOff++;
            droppedSessions.push({ sid, platform: sessionPlatform[sid] });
        }
    }

    const total           = completed + droppedOff;
    const completionRate  = total > 0 ? ((completed  / total) * 100).toFixed(1) : 0;
    const dropoffRate     = total > 0 ? ((droppedOff / total) * 100).toFixed(1) : 0;

    console.log(`\n  Total sessions    : ${total}`);
    console.log(`  Completed both    : ${completed}  (${completionRate}%)`);
    console.log(`  Dropped after R1  : ${droppedOff} (${dropoffRate}%)`);

    // Breakdown by platform
    const platformBreakdown = {};
    for (const s of [...completedSessions, ...droppedSessions]) {
        const p = s.platform;
        if (!platformBreakdown[p]) platformBreakdown[p] = { completed: 0, dropped: 0 };
    }
    for (const s of completedSessions) platformBreakdown[s.platform].completed++;
    for (const s of droppedSessions)   platformBreakdown[s.platform].dropped++;

    console.log("\n  Breakdown by platform:");
    for (const p in platformBreakdown) {
        const b = platformBreakdown[p];
        console.log(`    ${p}: completed=${b.completed}, dropped=${b.dropped}`);
    }

    return { total, completed, droppedOff, completionRate, dropoffRate, platformBreakdown };
}

// ============================================================================
// Run all three queries in sequence
// ============================================================================
async function runAllQueries() {
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║         ClickLogs — Firestore Analysis Queries       ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");

    const q4a = await queryMeanDurationByPlatform();
    console.log("");
    const q4b = await queryMeanDurationByInterface();
    console.log("");
    const q4c = await queryCompletionVsDropoff();
    console.log("\n✅ All queries complete.");
    return { q4a, q4b, q4c };
}

// Auto-run when script loads
runAllQueries();
