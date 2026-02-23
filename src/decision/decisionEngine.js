/**
 * Pure function: Calculates distance between two coordinates in KM.
 * Haversine formula.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Keywords that indicate trauma/surgery capability in a hospital type string
  const TRAUMA_KEYWORDS = ['trauma', 'surgery', 'surgical', 'emergency', 'multi', 'tertiary'];

  function hasTraumaCapability(hospitalType = '') {
    const t = hospitalType.toLowerCase();
    return TRAUMA_KEYWORDS.some(kw => t.includes(kw));
  }

  /**
   * Deterministic decision engine.
   * @param {import('./types').DecisionRequest} request
   *   request.patient now supports:
   *     consciousness_level  - 'ALERT' | 'VERBAL' | 'PAIN' | 'UNRESPONSIVE'
   *     bleeding             - boolean
   *     injury_location      - string
   *     mechanism_of_injury  - string
   *     severity_level       - 1-5
   *     requires_icu         - boolean
   *     requires_specialty   - string
   * @param {Object.<string, Object>} hospitalCache - Map of hospital_id -> state object
   * @returns {import('./types').DecisionResponse}
   */
  export function decide(request, hospitalCache) {
    const { ambulance, patient, constraints } = request;
    const candidates = [];

    // ── Extract new EMT fields ─────────────────────────────────────────────
    const bleeding           = !!patient.bleeding;
    const consciousnessLevel = (patient.consciousness_level || 'ALERT').toUpperCase();
    const severityLevel      = Number(patient.severity_level) || 3;

    // ── 1. Dynamic weight selection (bleeding-driven strategy) ─────────────
    // bleeding=true  → specialty/capacity drives ranking (nearest capable facility)
    // bleeding=false → distance is primary (stable patient, any capable hospital)
    const weights = bleeding
      ? { distance: 0.25, specialty: 0.45, capacity: 0.30 }
      : { distance: 0.60, specialty: 0.10, capacity: 0.30 };

    // ── 2. Consciousness adjustments ───────────────────────────────────────
    // UNRESPONSIVE → raise effective ICU need; PAIN → add to severity calc
    const icuExtraWeight     = consciousnessLevel === 'UNRESPONSIVE' ? 20 : 0;
    const consciousnessSevBonus = consciousnessLevel === 'PAIN' ? 10 : 0;

    // ── 3. Severity bonus: 0–12 (ranges across 1-5 scale) ─────────────────
    const severityBonus = (severityLevel - 1) * 3 + consciousnessSevBonus;

    // Treat patient as requiring ICU if consciousness is UNRESPONSIVE OR explicit flag set
    const effectiveRequiresIcu = patient.requires_icu || consciousnessLevel === 'UNRESPONSIVE';

    // ── Score each hospital ────────────────────────────────────────────────
    for (const [id, state] of Object.entries(hospitalCache)) {
      if (!state.latitude || !state.longitude) continue;

      const dist = calculateDistance(
        ambulance.latitude,
        ambulance.longitude,
        parseFloat(state.latitude),
        parseFloat(state.longitude)
      );

      // filter by max distance
      if (constraints && constraints.max_distance_km && dist > constraints.max_distance_km) {
        continue;
      }

      let score = 0;
      const reasonsSet = new Set();

      const beds = parseInt(state.available_beds || 0);
      const icu  = parseInt(state.available_icu_beds || 0);
      const load = parseFloat(state.current_load_score || 0);

      // ── a. Availability / Capacity score (weighted by capacity weight) ──
      let availScore = 0;
      if (effectiveRequiresIcu) {
        if (icu > 0) {
          availScore = 40 + icuExtraWeight; // bonus when UNRESPONSIVE
          reasonsSet.add('ICU Available');
        } else {
          availScore = -50;
          reasonsSet.add('No ICU');
        }
      } else {
        if (beds > 0) {
          availScore = 20;
          reasonsSet.add('Beds Available');
        }
      }
      score += availScore * weights.capacity;

      // ── b. Load score (0-30 → inverse of load) ─────────────────────────
      let loadScore = 0;
      if (load < 30)       { loadScore = 30; reasonsSet.add('Low Load'); }
      else if (load < 70)  { loadScore = 15; reasonsSet.add('Moderate Load'); }
      else                 { reasonsSet.add('High Load'); }
      score += loadScore;  // load always counts as-is

      // ── c. Distance score (weighted by distance weight) ────────────────
      let distScore = 0;
      if (dist < 5)        { distScore = 20; reasonsSet.add('Very Close (<5km)'); }
      else if (dist < 10)  { distScore = 10; reasonsSet.add('Close (<10km)'); }
      score += distScore * (weights.distance / 0.20); // normalise relative to baseline 0.20

      // ── d. Specialty match (weighted by specialty weight) ───────────────
      // Check both hospital type and dedicated specialties array
      let specialtyMatched = false;
      if (patient.requires_specialty) {
        const reqSpec = patient.requires_specialty.toLowerCase();
        // Check the type field
        if (state.type && state.type.toLowerCase().includes(reqSpec)) {
          specialtyMatched = true;
        }
        // Check the specialties JSON array
        if (!specialtyMatched && state.specialties) {
          try {
            const specList = typeof state.specialties === 'string'
              ? JSON.parse(state.specialties)
              : (Array.isArray(state.specialties) ? state.specialties : []);
            specialtyMatched = specList.some(s => s.toLowerCase().includes(reqSpec));
          } catch(e) { /* ignore parse errors */ }
        }
        if (specialtyMatched) {
          const specialtyScore = 10 * (weights.specialty / 0.10);
          score += specialtyScore;
          reasonsSet.add(`Specialty Match: ${patient.requires_specialty}`);
        }
      }

      // ── e. Trauma centre bonus for bleeding cases ───────────────────────
      if (bleeding && hasTraumaCapability(state.type)) {
        score += 15;
        reasonsSet.add('Trauma/Surgery Capable');
      }

      // ── f. Doctor availability bonus ────────────────────────────────────
      const docsAvail = parseInt(state.doctors_available || 0);
      if (docsAvail > 0) {
        const docBonus = Math.min(docsAvail, 10); // cap at 10
        score += docBonus;
        reasonsSet.add(`Doctors On-Duty: ${docsAvail}`);
      }

      // ── f. Global severity bonus ────────────────────────────────────────
      score += severityBonus;

      candidates.push({
        hospital_id: id,
        score: parseFloat(score.toFixed(1)),
        distance_km: parseFloat(dist.toFixed(2)),
        eta_minutes: Math.ceil(dist * 2), // 2 mins/km in city traffic
        reasons: Array.from(reasonsSet),
        snapshot: {
            available_beds: beds,
            available_icu_beds: icu,
            status: state.status,
            current_load_score: load
        },
        name: state.name || ''
      });
    }

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);

    const topN  = candidates.slice(0, constraints.max_results || 5);
    const ranked = topN.map((c, idx) => ({ ...c, rank: idx + 1 }));

    return {
      request_id: request.request_id,
      generated_at: Date.now(),
      recommendations: ranked,
      decision_explanation: {
        strategy: bleeding ? 'specialty-weighted' : 'distance-weighted',
        bleeding_mode: bleeding,
        consciousness: consciousnessLevel,
        severity_level: severityLevel,
        severity_bonus_applied: severityBonus,
        ranking_weights_used: weights,
        icu_extra_weight: icuExtraWeight > 0 ? `+${icuExtraWeight} (UNRESPONSIVE patient)` : null
      }
    };
  }
