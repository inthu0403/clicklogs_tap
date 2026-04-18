<?php
/**
 * saveTaps.php
 * Receives POST data from the click-logging frontend and
 * writes each tap record into Firebase Firestore via the
 * Firebase REST API.
 *
 * Expected JSON body:
 * {
 *   "sessionId":  "...",
 *   "platform":   "android" | "pc",
 *   "taps": [
 *     {
 *       "tapSequenceNumber": 1,
 *       "startTimestamp":    1710000000000,
 *       "endTimestamp":      1710000000150,
 *       "interfaceSequence": 1,
 *       "interface":         "feedbackshown" | "nofeedback"
 *     },
 *     ...
 *   ]
 * }
 */

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");          // allow GitHub Pages → PHP
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

// Respond to preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Only allow POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["error" => "Method not allowed"]);
    exit;
}

// ── Firebase project config ──────────────────────────────────────────────────
// Replace with your own project ID if you re-deploy
define('FIREBASE_PROJECT_ID', 'clicklogs-study');

// Firebase REST base URL for Firestore
// Format: POST to this URL creates a new auto-ID document in tap_logs
define('FIRESTORE_URL',
    'https://firestore.googleapis.com/v1/projects/' .
    FIREBASE_PROJECT_ID .
    '/databases/(default)/documents/tap_logs');

// ── Parse incoming JSON ──────────────────────────────────────────────────────
$raw = file_get_contents('php://input');
if (!$raw) {
    http_response_code(400);
    echo json_encode(["error" => "Empty request body"]);
    exit;
}

$data = json_decode($raw, true);
if (!$data || !isset($data['taps']) || !is_array($data['taps'])) {
    http_response_code(400);
    echo json_encode(["error" => "Invalid JSON or missing 'taps' array"]);
    exit;
}

$sessionId   = isset($data['sessionId']) ? strval($data['sessionId']) : 'unknown';
$platform    = isset($data['platform'])  ? strtolower(strval($data['platform'])) : 'unknown';
$serverTs    = round(microtime(true) * 1000); // ms epoch

// ── Helper: convert a PHP value to a Firestore REST field value ──────────────
function firestoreValue($value) {
    if (is_int($value) || is_float($value)) {
        return ["integerValue" => strval(intval($value))];
    }
    if (is_bool($value)) {
        return ["booleanValue" => $value];
    }
    return ["stringValue" => strval($value)];
}

// ── Write each tap as a separate Firestore document ──────────────────────────
$saved  = 0;
$errors = [];

foreach ($data['taps'] as $tap) {
    // Validate required tap fields
    if (!isset($tap['startTimestamp'], $tap['endTimestamp'],
                $tap['tapSequenceNumber'], $tap['interface'])) {
        $errors[] = "Skipped malformed tap: " . json_encode($tap);
        continue;
    }

    $start    = intval($tap['startTimestamp']);
    $end      = intval($tap['endTimestamp']);
    $duration = $end - $start;

    // Reject obviously bad durations
    if ($duration < 0 || $duration > 5000) {
        $errors[] = "Skipped tap with invalid duration ({$duration} ms)";
        continue;
    }

    // Build Firestore document fields
    // Each field must be wrapped in its type descriptor for the REST API
    $fields = [
        // ── Session-level fields ─────────────────────────────────────────
        "sessionId"          => firestoreValue($sessionId),
        "platform"           => firestoreValue($platform),

        // ── Tap-level fields ─────────────────────────────────────────────
        "tapSequenceNumber"  => firestoreValue(intval($tap['tapSequenceNumber'])),
        "startTimestamp"     => firestoreValue($start),
        "endTimestamp"       => firestoreValue($end),

        // durationMs stored pre-computed so queries can filter/sort cheaply
        // without computing (endTimestamp - startTimestamp) at query time
        "durationMs"         => firestoreValue($duration),

        "interfaceType"      => firestoreValue(strval($tap['interface'])),
        "interfaceSequence"  => firestoreValue(
            isset($tap['interfaceSequence']) ? intval($tap['interfaceSequence']) : 1
        ),

        // Server-side timestamp for ordering across sessions
        "serverTimestamp"    => firestoreValue($serverTs),
    ];

    // POST to Firestore REST API (auto-generates document ID)
    $payload = json_encode(["fields" => $fields]);

    $ch = curl_init(FIRESTORE_URL);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            "Content-Type: application/json",
            "Content-Length: " . strlen($payload),
        ],
        CURLOPT_TIMEOUT        => 10,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
        $saved++;
    } else {
        $errors[] = "Firestore rejected tap #{$tap['tapSequenceNumber']}: HTTP {$httpCode}";
    }
}

// ── Return result ─────────────────────────────────────────────────────────────
$status = (count($errors) === 0) ? 200 : 207; // 207 = partial success
http_response_code($status);
echo json_encode([
    "saved"  => $saved,
    "errors" => $errors,
    "total"  => count($data['taps']),
]);
?>
