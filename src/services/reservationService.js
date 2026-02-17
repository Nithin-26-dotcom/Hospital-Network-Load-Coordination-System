import { randomUUID } from "crypto";

export const createReservation = async (connection, { hospital_id, ambulance_id, requires_icu, case_id = null }) => {
  // 1. Validate hospital exists
  const [hospitals] = await connection.execute(
    "SELECT hospital_id FROM hospitals WHERE hospital_id = ?",
    [hospital_id]
  );

  if (hospitals.length === 0) {
    throw new Error("Hospital not found");
  }

  // 2. Validate ambulance exists
  const [ambulances] = await connection.execute(
    "SELECT ambulance_id FROM ambulances WHERE ambulance_id = ?",
    [ambulance_id]
  );

  if (ambulances.length === 0) {
    throw new Error("Ambulance not found");
  }

  // 3. Determine bed type
  const bed_type = requires_icu ? "ICU" : "NORMAL";

  // 4. Create reservation
  const reservation_id = randomUUID();
  const reservation_status = "RESERVED";
  const expires_at = new Date(Date.now() + 15 * 60 * 1000);

  const query = `
    INSERT INTO hospital_reservations 
    (reservation_id, hospital_id, ambulance_id, case_id, bed_type, reservation_status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  await connection.execute(query, [
    reservation_id,
    hospital_id,
    ambulance_id,
    case_id,
    bed_type,
    reservation_status,
    expires_at,
  ]);

  return {
    reservation_id,
    hospital_id,
    ambulance_id,
    case_id,
    bed_type,
    reservation_status,
    expires_at,
  };
};
