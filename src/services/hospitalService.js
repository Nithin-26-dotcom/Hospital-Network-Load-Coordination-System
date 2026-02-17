import db from "../db/dbClient.js";

/**
 * Calculates effective capacity for all hospitals.
 * Effective = Total - (Reserved + Occupied)
 * occupied = ARRIVED status in reservations
 * reserved = RESERVED status in reservations
 */
export const getEffectiveHospitalCapacities = async () => {
  // We need to aggregate reservations by hospital_id and bed_type
  const query = `
    SELECT 
      h.hospital_id,
      h.total_beds,
      h.icu_beds,
      COUNT(CASE WHEN hr.bed_type = 'NORMAL' AND hr.reservation_status IN ('RESERVED', 'ARRIVED') THEN 1 END) as used_normal,
      COUNT(CASE WHEN hr.bed_type = 'ICU' AND hr.reservation_status IN ('RESERVED', 'ARRIVED') THEN 1 END) as used_icu
    FROM hospitals h
    LEFT JOIN hospital_reservations hr ON h.hospital_id = hr.hospital_id 
      AND hr.reservation_status IN ('RESERVED', 'ARRIVED')
    GROUP BY h.hospital_id
  `;

  const [rows] = await db.execute(query);

  const capacityMap = {};

  for (const row of rows) {
    const total_normal = row.total_beds || 0;
    const total_icu = row.icu_beds || 0;
    const used_normal = parseInt(row.used_normal || 0);
    const used_icu = parseInt(row.used_icu || 0);

    capacityMap[row.hospital_id] = {
      // Raw data
      total_beds: total_normal,
      icu_beds: total_icu,
      used_beds: used_normal,
      used_icu_beds: used_icu,
      
      // Effective Available
      available_beds: Math.max(0, total_normal - used_normal),
      available_icu_beds: Math.max(0, total_icu - used_icu)
    };
  }

  return capacityMap;
};
