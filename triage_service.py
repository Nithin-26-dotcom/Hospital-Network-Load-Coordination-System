from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
from google.genai import types
import PIL.Image
import json
import tempfile
import os
from dotenv import load_dotenv
load_dotenv()
client = genai.Client(api_key= os.getenv("GENAI_API_KEY"))

app = Flask(__name__)
CORS(app)

# ─────────────────────────────────────────────────────────────
#  RANKING STRATEGY TABLE
#  bleeding=True  → specialty/ICU-driven ranking
#  bleeding=False → distance-driven ranking
# ─────────────────────────────────────────────────────────────
RANKING_STRATEGIES = {
    "bleeding":          {"priority": "specialty",  "weight_distance": 0.25, "weight_specialty": 0.45, "weight_capacity": 0.30},
    "fracture":          {"priority": "specialty",  "weight_distance": 0.30, "weight_specialty": 0.40, "weight_capacity": 0.30},
    "cardiac":           {"priority": "specialty",  "weight_distance": 0.20, "weight_specialty": 0.50, "weight_capacity": 0.30},
    "burns":             {"priority": "specialty",  "weight_distance": 0.25, "weight_specialty": 0.45, "weight_capacity": 0.30},
    "unconscious":       {"priority": "icu",        "weight_distance": 0.25, "weight_specialty": 0.35, "weight_capacity": 0.40},
    "respiratory":       {"priority": "icu",        "weight_distance": 0.20, "weight_specialty": 0.40, "weight_capacity": 0.40},
    "unknown":           {"priority": "distance",   "weight_distance": 0.60, "weight_specialty": 0.10, "weight_capacity": 0.30},
    "minor":             {"priority": "distance",   "weight_distance": 0.70, "weight_specialty": 0.10, "weight_capacity": 0.20},
}

SPECIALTY_MAP = {
    "head_fracture":         "Neurosurgery",
    "leg_fracture":          "Orthopedics",
    "arm_fracture":          "Orthopedics",
    "spine_fracture":        "Neurosurgery",
    "chest_bleeding":        "Cardiothoracic Surgery",
    "abdominal_bleeding":    "General Surgery",
    "external_bleeding":     "Trauma",
    "burns":                 "Burns Unit",
    "cardiac":               "Cardiology",
    "respiratory":           "Pulmonology",
    "unconscious":           "Emergency Medicine",
    "unknown":               "General Medicine",
    "minor":                 "General Medicine",
}


@app.route("/triage", methods=["POST"])
def triage():
    try:
        if 'image' not in request.files:
            return jsonify({"error": "No image provided"}), 400

        image_file = request.files['image']

        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
            image_file.save(tmp.name)
            img = PIL.Image.open(tmp.name)

        prompt = """
        You are an emergency medical AI helping paramedics classify injuries from images.

        Your ONLY job is to classify what TYPE of emergency is visible in the image.
        Do NOT try to identify the person. Do NOT extract form fields or personal details.

        STEP 1 — Is there ACTIVE BLEEDING visible?
          Look for: blood, open wounds, lacerations, punctures, pooling blood, blood-soaked clothing.

        STEP 2 — Classify into EXACTLY ONE category:

          BLEEDING CATEGORIES (set bleeding=true):
          • "head_fracture"        — head wound, skull injury, blood from head/face
          • "leg_fracture"         — broken/deformed leg, bone visible, leg trauma with blood
          • "arm_fracture"         — broken/deformed arm, bone visible, arm trauma with blood
          • "spine_fracture"       — back/neck injury with blood, patient immobile
          • "chest_bleeding"       — chest wound, stabbing, thoracic trauma with blood
          • "abdominal_bleeding"   — abdominal wound, penetrating trauma with blood
          • "external_bleeding"    — visible bleeding but exact fracture location unclear
          • "burns"                — burn injuries (treat as bleeding=true, high severity)

          NON-BLEEDING CATEGORIES (set bleeding=false):
          • "cardiac"              — patient clutching chest, ECG shown, cardiac arrest signs
          • "respiratory"          — patient struggling to breathe, asthma, choking
          • "unconscious"          — person down, unresponsive, no obvious external injury
          • "minor"                — ambulatory patient, no visible serious injury
          • "unknown"              — cannot determine from image

        STEP 3 — Severity:
          5 = Life-threatening (massive bleed, unconscious, no pulse signs)
          4 = Serious (active bleed, major fracture, unresponsive but breathing)
          3 = Moderate (injury visible, patient conscious and stable)
          2 = Mild (walking wounded, minor injury)
          1 = Minor (no visible injury, precautionary transport)
          DEFAULT = 3 if completely unclear.

        STEP 4 — ICU needed?
          true  → severity >= 4, OR head/spine/chest injury, OR unconscious patient
          false → all other cases

        STEP 5 — Confidence in your classification:
          "high"   → injury clearly visible
          "medium" → some visible cues but not definitive
          "low"    → image unclear, guessing from context

        Return ONLY this exact JSON (no explanation, no markdown, no extra text):
        {
            "bleeding": <true | false>,
            "injury_type": "<exact category string>",
            "injury_location": "<head | neck | chest | abdomen | arm | leg | back | multiple | unknown>",
            "severity_level": <1-5>,
            "requires_icu": <true | false>,
            "confidence": "<high | medium | low>"
        }
        """

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[img, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )

        result = json.loads(response.text)

        # ── Safety net: fill any missing fields with safe defaults ──
        result.setdefault("bleeding",        False)
        result.setdefault("injury_type",     "unknown")
        result.setdefault("injury_location", "unknown")
        result.setdefault("severity_level",  3)
        result.setdefault("requires_icu",    False)
        result.setdefault("confidence",      "low")

        # ── Triage colour category ──
        sev = result["severity_level"]
        result["triage_category"] = (
            "Red"    if sev >= 4 else
            "Yellow" if sev >= 2 else
            "Green"
        )

        # ── Required hospital specialty from injury type ──
        injury_type = result["injury_type"]
        result["requires_specialty"] = SPECIALTY_MAP.get(injury_type, "General Medicine")

        # ── Ranking strategy for frontend ──
        # bleeding → weight toward specialty + ICU
        # no bleeding → weight toward distance (nearest capable hospital)
        strategy_key = (
            injury_type if injury_type in RANKING_STRATEGIES
            else "bleeding" if result["bleeding"]
            else "unknown"
        )
        strategy = RANKING_STRATEGIES[strategy_key]
        result["ranking_strategy"] = strategy
        result["ranking_priority"]  = strategy["priority"]

        # ── Human-readable UI summary ──
        location = result["injury_location"]
        if result["bleeding"]:
            result["summary"] = (
                f"⚠️ Bleeding detected — "
                f"{injury_type.replace('_', ' ').title()} ({location}). "
                f"Routing to nearest {result['requires_specialty']} unit."
            )
        else:
            result["summary"] = (
                f"🔵 No active bleeding — "
                f"{injury_type.replace('_', ' ').title()} ({location}). "
                f"Routing to nearest capable hospital by distance."
            )

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/triage/strategy", methods=["GET"])
def get_strategies():
    """Debug endpoint — shows all ranking strategies and specialty mappings."""
    return jsonify({
        "strategies": RANKING_STRATEGIES,
        "specialty_map": SPECIALTY_MAP,
        "logic": {
            "bleeding=true":  "Prioritize specialty match + ICU availability over distance",
            "bleeding=false": "Prioritize nearest hospital — distance is primary factor"
        }
    })


if __name__ == "__main__":
    app.run(port=5001, debug=False)