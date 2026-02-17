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
  
  /**
   * Deterministic decision engine.
   * @param {import('./types').DecisionRequest} request 
   * @param {Object.<string, Object>} hospitalCache - Map of hospital_id -> state object
   * @returns {import('./types').DecisionResponse}
   */
  export function decide(request, hospitalCache) {
    const { ambulance, patient, constraints } = request;
    const candidates = [];
  
    // 1. Iterate all known hospitals
    for (const [id, state] of Object.entries(hospitalCache)) {
      // Basic data validation
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
  
      // Calculate Score
      let score = 0;
      const reasons = [];
      const reasonsSet = new Set();
  
      // a. Availability Score (0-50)
      const beds = parseInt(state.available_beds || 0);
      const icu = parseInt(state.available_icu_beds || 0);
      
      if (patient.requires_icu) {
        if (icu > 0) {
            score += 40;
            reasonsSet.add("ICU Available");
        } else {
            score -= 50; // Penalty for no ICU if required
            reasonsSet.add("No ICU");
        }
      } else {
        if (beds > 0) {
            score += 20;
            reasonsSet.add("Beds Available");
        }
      }
  
      // b. Load Score (0-30) -> Inverse of load
      const load = parseFloat(state.current_load_score || 0);
      if (load < 30) {
        score += 30;
        reasonsSet.add("Low Load");
      } else if (load < 70) {
        score += 15;
        reasonsSet.add("Moderate Load");
      } else {
        reasonsSet.add("High Load");
      }
  
      // c. Distance Score (0-20) -> closer is better
      if (dist < 5) {
        score += 20;
        reasonsSet.add("Very Close (<5km)");
      } else if (dist < 10) {
        score += 10;
        reasonsSet.add("Close (<10km)");
      }
  
      // d. Specialty Match (Mock logic for now)
      if (patient.requires_specialty && state.type && state.type.toLowerCase().includes(patient.requires_specialty.toLowerCase())) {
          score += 10;
          reasonsSet.add(`Specialty Match: ${patient.requires_specialty}`);
      }
  
      // Push Candidate
      candidates.push({
        hospital_id: id,
        score: parseFloat(score.toFixed(1)),
        distance_km: parseFloat(dist.toFixed(2)),
        eta_minutes: Math.ceil(dist * 2), // Rough estimate: 2 mins per km in city traffic
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
  
    // 2. Sort by Score Descending
    candidates.sort((a, b) => b.score - a.score);
  
    // 3. Slice top N results
    const topN = candidates.slice(0, constraints.max_results || 5);
  
    // 4. Assign Rank
    const ranked = topN.map((c, idx) => ({ ...c, rank: idx + 1 }));
  
    return {
      request_id: request.request_id,
      generated_at: Date.now(),
      recommendations: ranked,
      decision_explanation: {
        strategy: "weighted-availability-distance",
        weights: {
          availability: 0.5,
          load: 0.3,
          distance: 0.2
        }
      }
    };
  }
