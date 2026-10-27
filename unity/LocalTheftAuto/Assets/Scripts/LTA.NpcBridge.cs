/* ==========================================================================
   Local Theft Auto — optional local HTTP bridge for AI NPC dialogue (F19).

   A pure class (no MonoBehaviour): GameLoop owns one instance and calls
   Step(unscaledDt) once per frame. It talks to the local Ollama proxy's
   POST /api/game-npc (server.js) using the LTA_GAME_TOKEN bearer credential
   (PlayerPrefs "lta_npc_token"). If that token is empty the bridge is
   DISABLED and every TryRequest falls back silently (onLine(null)).

   The whole thing is deliberately non-throwing and never blocks a frame:
   the request fires and Step polls isDone against a client-side timeout;
   on success the response {"line":"..."} is delivered, on any failure
   (network, parse, timeout, disabled) onLine(null) is delivered so the
   caller falls back to its canned line. Canned() is that fallback — a
   deterministic, in-character-ish line derived from the inputs.

   NOTE: UnityWebRequest is available on every platform this project targets
   (standalone/desktop, which is the only one the game runs), so no extra
   package is needed. If a build ever runs in an environment without
   networking, UnityWebRequest.Send() simply never completes and the timeout
   path fires — the game still works, it just always falls back.
   ========================================================================== */
using System;
using UnityEngine;
using UnityEngine.Networking;

namespace LocalTheftAuto
{
    public class NpcBridge
    {
        const string TokenKey = "lta_npc_token";
        const string ModelKey = "lta_npc_model";
        const string FallbackModel = "llama3:8b";

        // Target — host/port/timeout are Cfg fields (Step B) so they can be
        // tuned without touching this file.
        const string NpcPath = "/api/game-npc";

        // Cfg.NpcBridgeHost/Port/TimeoutSec are declared on the Cfg static
        // class (see LTA.Core.cs). The fields below exist on Cfg; read
        // through Cfg so changing the constants in one place flows through.
        static string Host => Cfg.NpcBridgeHost;
        static int Port => Cfg.NpcBridgePort;
        static float TimeoutSec => Cfg.NpcBridgeTimeoutSec;

        // Neutral fallback lines for Canned() — class-level so they can be
        // static readonly (a local array can't take those modifiers).
        static readonly string[] CannedLines =
        {
            "Watch your step around here — locals only.",
            "I've seen a lot of things on this block.",
            "Not my business, but I've noticed you.",
            "The paint on that car's fresh. Keep it that way.",
            "Mind your money and your manners out here.",
            "I don't ask questions. Not today.",
            "You look like you've been driving all night.",
            "The night shift's quiet tonight. Suspiciously so.",
            "We keep to ourselves around here.",
            "Heads up — the traffic up ahead's a mess.",
            "You're a long way from home, friend.",
            "I've got places to be. You should too.",
            "This city doesn't sleep. Neither do some of us.",
            "Keep it under your hat, alright?",
            "You strike me as someone with a plan.",
            "The old folks on this corner talk too much.",
            "No hurry. The city's not going anywhere.",
            "I'd ask where you're headed, but I won't.",
            "Stay off the main road if you know what's good for you.",
            "Locals don't talk. I'm barely a local."
        };

        // Only ONE request in flight at a time (a game NPC, not a chat UI):
        // a second TryRequest while one is pending gets false immediately.
        bool inFlight;
        float elapsed;
        Action<string> pending;
        UnityWebRequest request;

        // True once a failure/timeout has been logged this run, so a flapping
        // bridge doesn't spam the console (brief: "log at most once").
        bool warned;

        // Fire a request for a single NPC line. Returns true when the request
        // was actually launched (caller should treat the NPC as "thinking");
        // returns false — and calls onLine(null) — when the bridge is
        // disabled, no token, or a request is already in flight. Never blocks.
        public bool TryRequest(string npc, string playerLine, string scene, Action<string> onLine)
        {
            try
            {
                if (onLine == null) return false;
                if (inFlight) { onLine(null); return false; }
                string token = PlayerPrefs.GetString(TokenKey, "");
                if (string.IsNullOrEmpty(token)) { onLine(null); return false; }

                inFlight = true;
                elapsed = 0f;
                pending = onLine;

                string model = PlayerPrefs.GetString(ModelKey, "") ?? "";
                if (string.IsNullOrEmpty(model)) model = FallbackModel;

                // Build the JSON by hand — no dependency on JsonUtility for a
                // request, and the shape matches server.js's contract exactly.
                string body = Json(
                    model: model,
                    npc: npc ?? "",
                    playerLine: playerLine ?? "",
                    scene: scene ?? "");

                var req = UnityWebRequest.Post($"http://{Host}:{Port}{NpcPath}", body);
                req.SetRequestHeader("Authorization", "Bearer " + token);
                req.SetRequestHeader("Content-Type", "application/json");
                req.disposeDownloadHandlerOnDispose = true;
                request = req;
                return req.SendWebRequest() != null;
            }
            catch (Exception)
            {
                // A Send() that throws (very unusual) must not take the frame
                // down — treat it as a miss and let Step deliver the fallback.
                inFlight = false;
                pending = null;
                return false;
            }
        }

        // Called once per frame from GameLoop.Update. Polls the in-flight
        // request against the client-side timeout and delivers the result
        // exactly once. Never throws.
        public void Step(float dt)
        {
            try
            {
                if (!inFlight || request == null) return;
                elapsed += dt;
                if (!request.isDone && elapsed >= TimeoutSec)
                {
                    request.Abort();
                    Finish(null);
                    return;
                }
                if (!request.isDone) return;

                // UnityWebRequest reports errors via result == Incomplete;
                // a successful 200 still needs the {"line":"..."} parsed.
                string line = null;
                if (request.result == UnityWebRequest.Result.Success)
                    line = ParseLine(request.downloadHandler.text);
                Finish(line);
            }
            catch (Exception)
            {
                Finish(null);
            }
        }

        void Finish(string line)
        {
            var cb = pending;
            pending = null;
            inFlight = false;
            var r = request;
            request = null;
            if (r != null) { if (!r.isDone) r.Abort(); r.Dispose(); }
            if (cb != null)
            {
                try { cb(line); }
                catch (Exception) { }   // a caller exception must not escape Step
            }
        }

        static string ParseLine(string json)
        {
            // Hand-parse {"line":"..."} — small, dependency-free, and tolerant
            // of a missing/blank "line" (returns null → caller uses Canned()).
            if (string.IsNullOrEmpty(json)) return null;
            string key = "\"line\"";
            int k = json.IndexOf(key, StringComparison.Ordinal);
            if (k < 0) return null;
            int colon = json.IndexOf(':', k + key.Length);
            if (colon < 0) return null;
            int start = json.IndexOf('"', colon);
            if (start < 0) return null;
            int end = json.IndexOf('"', start + 1);
            if (end <= start) return null;
            string s = json.Substring(start + 1, end - start - 1);
            // unescape the two JSON escapes that matter for a short line
            s = s.Replace("\\\"", "\"").Replace("\\n", " ").Replace("\\\\", "\\");
            return string.IsNullOrWhiteSpace(s) ? null : s.Trim();
        }

        // Manual 4-field JSON builder with proper escaping (Step B). Order
        // matches server.js's destructuring so it's obvious what goes where.
        static string Json(string model, string npc, string playerLine, string scene)
        {
            var sb = new System.Text.StringBuilder();
            sb.Append('{');
            sb.Append("\"model\":").Append(Quote(model));
            sb.Append(",\"npc\":").Append(Quote(npc));
            sb.Append(",\"playerLine\":").Append(Quote(playerLine));
            sb.Append(",\"scene\":").Append(Quote(scene));
            sb.Append('}');
            return sb.ToString();
        }

        static string Quote(string s)
        {
            if (s == null) return "\"\"";
            var sb = new System.Text.StringBuilder("\"");
            foreach (char c in s)
            {
                switch (c)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        /* ------------------------------------------------------------ Canned
           Deterministic fallback line used by every rule-based caller when the
           bridge is off or a request fails. Same seed in → same line out, so a
           given (npc, scene, timeSeed) never flaps between different replies
           within a frame batch. The table is deliberately neutral GTA-flavored
           small talk — generic enough that any NPC, in any scene, can say it
           without it sounding like a canned error message. */
        public static string Canned(string npc, string scene, float timeSeed)
        {
            int h = StableHash(npc ?? "", scene ?? "", timeSeed);
            // Index by the low bits of the hash so (npc, scene) stay stable
            // while timeSeed slowly varies them.
            return CannedLines[Mathf.Abs(h) % CannedLines.Length];
        }

        // FNV-1a over the three fields, deterministic across runs/frames.
        // (Distinct from JSRng's hash, which is city-layout-specific; this is
        // a plain string hash for picking a line.)
        static int StableHash(string a, string b, float seed)
        {
            unchecked
            {
                uint h = 2166136261;
                void Mix(string s)
                {
                    for (int i = 0; i < s.Length; i++) { h ^= s[i]; h *= 16777619; }
                }
                Mix(a); Mix(b); Mix(((int)(seed * 1000f)).ToString());
                return (int)h;
            }
        }
    }
}