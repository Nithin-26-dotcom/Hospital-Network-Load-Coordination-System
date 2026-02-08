/**
 * @typedef {Object} Location
 * @property {number} latitude
 * @property {number} longitude
 */

/**
 * @typedef {Object} DecisionRequest
 * @property {string} request_id
 * @property {Object} ambulance
 * @property {string} ambulance.ambulance_id
 * @property {Location} ambulance.location
 * @property {Object} patient
 * @property {number} patient.severity_level
 * @property {boolean} patient.requires_icu
 * @property {string} patient.requires_specialty
 * @property {Object} constraints
 * @property {number} constraints.max_distance_km
 * @property {number} constraints.max_results
 * @property {number} timestamp
 */

/**
 * @typedef {Object} RankedHospital
 * @property {string} hospital_id
 * @property {number} rank
 * @property {number} score
 * @property {number} distance_km
 * @property {number} eta_minutes
 * @property {string[]} reasons
 * @property {Object} snapshot
 */

/**
 * @typedef {Object} DecisionResponse
 * @property {string} request_id
 * @property {number} generated_at
 * @property {RankedHospital[]} recommendations
 * @property {Object} decision_explanation
 */

 export const Types = {};
