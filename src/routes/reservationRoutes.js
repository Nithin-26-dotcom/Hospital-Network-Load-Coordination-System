import express from "express";
import pool from "../db/dbClient.js";
import { randomUUID } from "crypto";
import { createReservation } from "../services/reservationService.js";

const router = express.Router();

// POST /reservations/create
router.post("/create", async (req, res) => {
  const { hospital_id, ambulance_id, requires_icu } = req.body;

  if (!hospital_id || !ambulance_id) {
    return res.status(400).json({ error: "hospital_id and ambulance_id are required" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Use the service to create reservation
    const reservation = await createReservation(connection, {
      hospital_id,
      ambulance_id,
      requires_icu
    });

    await connection.commit();

    res.status(201).json({
      ...reservation,
      message: "Reservation created successfully",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error creating reservation:", error);
    if (error.message === "Hospital not found" || error.message === "Ambulance not found") {
       return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: "Internal server error" });
  } finally {
    connection.release();
  }
});

// GET /reservations/active/:ambulance_id
router.get("/active/:ambulance_id", async (req, res) => {
  const { ambulance_id } = req.params;

  try {
    const [rows] = await pool.execute(
      `SELECT
          r.reservation_id,
          r.bed_type,
          r.reservation_status,
          r.created_at,
          r.expires_at,
          h.name as hospital_name,
          h.hospital_id
       FROM hospital_reservations r
       JOIN hospitals h ON r.hospital_id = h.hospital_id
       WHERE r.ambulance_id = ?
       AND r.reservation_status = 'RESERVED'
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [ambulance_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "No active reservation found" });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching active reservation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
