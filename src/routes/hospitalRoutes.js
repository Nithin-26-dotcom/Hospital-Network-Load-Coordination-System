import express from 'express';
import { randomUUID } from 'crypto';
import db from '../db/dbClient.js';

const router = express.Router();

// Register a new hospital
router.post('/register', async (req, res) => {
  const { name, type, latitude, longitude, address, city, total_beds, icu_beds, emergency_level_supported, contact_number, username, password, specialties, doctors_available } = req.body;

  if (!username || !password || !name || !latitude || !longitude) {
    return res.status(400).json({ error: 'Username, password, name, latitude, and longitude are required' });
  }

  const hospitalId = randomUUID();
  // Store specialties as JSON string
  const specialtiesJson = Array.isArray(specialties) ? JSON.stringify(specialties) : (specialties || null);

  try {
    const [result] = await db.execute(
      `INSERT INTO hospitals (hospital_id, name, type, latitude, longitude, address, city, total_beds, icu_beds, emergency_level_supported, contact_number, specialties, doctors_available, username, password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [hospitalId, name, type, latitude, longitude, address, city, total_beds || 0, icu_beds || 0, emergency_level_supported, contact_number, specialtiesJson, doctors_available || 0, username, password]
    );

    res.status(201).json({
      message: 'Hospital registered successfully',
      hospital_id: hospitalId
    });
  } catch (error) {
    console.error('Error registering hospital:', error);
    if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login (Username/Password)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const [rows] = await db.execute('SELECT hospital_id, name, username FROM hospitals WHERE username = ? AND password = ?', [username, password]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      message: 'Login successful',
      hospital_id: rows[0].hospital_id,
      name: rows[0].name,
      username: rows[0].username
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get hospital details
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.execute('SELECT * FROM hospitals WHERE hospital_id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Hospital not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching hospital:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all hospitals (Static Info)
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT hospital_id, name, latitude, longitude, type, total_beds, icu_beds FROM hospitals');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching hospitals:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get current effective state (Live + Simulation)
import { getHospitalCache } from '../decision/stateCache.js';
router.get('/state/all', (req, res) => {
    res.json(getHospitalCache());
});

// Update hospital details (specialties, doctors, beds, contact)
router.put('/:id/details', async (req, res) => {
    const { id } = req.params;
    const { specialties, doctors_available, total_beds, icu_beds, contact_number } = req.body;

    // Store specialties as JSON string
    const specialtiesJson = Array.isArray(specialties) ? JSON.stringify(specialties) : (specialties || null);

    try {
        const [result] = await db.execute(
            `UPDATE hospitals SET specialties = ?, doctors_available = ?, total_beds = ?, icu_beds = ?, contact_number = ? WHERE hospital_id = ?`,
            [specialtiesJson, doctors_available || 0, total_beds || 0, icu_beds || 0, contact_number || null, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Hospital not found' });
        }

        res.json({ message: 'Hospital details updated successfully' });
    } catch (error) {
        console.error('Error updating hospital details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get hospital dashboard data
router.get('/dashboard/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Get hospital details (capacity + specialties + doctors)
        const [hospitalRows] = await db.execute(
            'SELECT total_beds, icu_beds, specialties, doctors_available, contact_number FROM hospitals WHERE hospital_id = ?',
            [id]
        );

        if (hospitalRows.length === 0) {
            return res.status(404).json({ error: 'Hospital not found' });
        }

        const hospital = hospitalRows[0];
        const totalBeds = hospital.total_beds || 0;
        const totalIcuBeds = hospital.icu_beds || 0;

        // 2. Get active reservations
        const [reservationRows] = await db.execute(
            `SELECT
                bed_type,
                reservation_status,
                COUNT(*) as count
             FROM hospital_reservations
             WHERE hospital_id = ?
               AND reservation_status IN ('RESERVED', 'ARRIVED')
             GROUP BY bed_type, reservation_status`,
            [id]
        );

        // Process counts
        let reservedNormal = 0;
        let reservedIcu = 0;
        let arrivedNormal = 0;
        let arrivedIcu = 0;

        reservationRows.forEach(row => {
            if (row.bed_type === 'NORMAL') {
                if (row.reservation_status === 'RESERVED') reservedNormal += row.count;
                if (row.reservation_status === 'ARRIVED') arrivedNormal += row.count;
            } else if (row.bed_type === 'ICU') {
                if (row.reservation_status === 'RESERVED') reservedIcu += row.count;
                if (row.reservation_status === 'ARRIVED') arrivedIcu += row.count;
            }
        });

        const enRouteCount = reservedNormal + reservedIcu;
        const arrivedCount = arrivedNormal + arrivedIcu;
        const activeReservationsCount = enRouteCount + arrivedCount; // Total active (RESERVED + ARRIVED)

        // Calculate effective availability
        const effectiveAvailableBeds = Math.max(0, totalBeds - (reservedNormal + arrivedNormal));
        const effectiveAvailableIcuBeds = Math.max(0, totalIcuBeds - (reservedIcu + arrivedIcu));

         // 3. Get detailed reservation list
        const [reservationList] = await db.execute(
            `SELECT
                r.ambulance_id,
                r.case_id,
                r.bed_type,
                r.reservation_status,
                r.created_at
             FROM hospital_reservations r
             WHERE r.hospital_id = ?
               AND r.reservation_status IN ('RESERVED', 'ARRIVED')
             ORDER BY r.created_at DESC`,
            [id]
        );

        // 4. Calculate System Load
        const systemLoad = totalBeds > 0 ? (activeReservationsCount / totalBeds) * 100 : 0;

        // Parse specialties from JSON string
        let specialtiesList = [];
        try {
            if (hospital.specialties) specialtiesList = JSON.parse(hospital.specialties);
        } catch(e) { /* ignore parse error */ }

        res.json({
            total_beds: totalBeds,
            total_icu_beds: totalIcuBeds,
            effective_available_beds: effectiveAvailableBeds,
            effective_available_icu_beds: effectiveAvailableIcuBeds,
            active_reservations_count: activeReservationsCount,
            en_route_count: enRouteCount,
            arrived_count: arrivedCount,
            incoming_ambulances_count: activeReservationsCount,
            reservation_list: reservationList,
            specialties: specialtiesList,
            doctors_available: hospital.doctors_available || 0,
            contact_number: hospital.contact_number || '',
            last_updated_at: new Date().toISOString(),
            system_calculated_load: parseFloat(systemLoad.toFixed(2))
        });

    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
