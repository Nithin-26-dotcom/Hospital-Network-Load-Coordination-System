/**
 * Simple hospital state producer that writes to a Redis Stream.
 * This simulates hospitals pushing periodic updates.
 */
import dotenv from "dotenv";
import redis from "./redisClient.js";
import { randomUUID } from "crypto";

dotenv.config();
const STREAM = process.env.HOSPITAL_STREAM || "hospital:state";

function makeSampleHospitalState(id) {
  const now = Date.now();
  return {
    hospital_id: id,
    available_beds: String(Math.floor(Math.random() * 50)),
    available_icu_beds: String(Math.floor(Math.random() * 10)),
    current_load_score: String((Math.random() * 100).toFixed(2)),
    staff_status: ["adequate", "strained", "critical"][
      Math.floor(Math.random() * 3)
    ],
    incoming_ambulances_count: String(Math.floor(Math.random() * 5)),
    last_heartbeat_at: String(now),
    status: ["NORMAL", "CROWDED", "OVERLOADED", "OFFLINE"][
      Math.floor(Math.random() * 4)
    ],
    latitude: String((37.0 + Math.random()).toFixed(6)),
    longitude: String((-122.0 + Math.random()).toFixed(6)),
  };
}

async function produceOnce(hospitalId) {
  const payload = makeSampleHospitalState(hospitalId);
  const flat = [];
  for (const k of Object.keys(payload)) {
    flat.push(k, payload[k]);
  }
  await redis.xadd(STREAM, "*", ...flat);
  console.log(
    JSON.stringify({ event: "hospital_state_pushed", hospital_id: hospitalId }),
  );
}

async function run() {
  const hospitalIds = [randomUUID(), randomUUID(), randomUUID()];
  console.log(
    JSON.stringify({ event: "simulating_hospitals", hospitals: hospitalIds }),
  );
  setInterval(() => {
    hospitalIds.forEach((id) =>
      produceOnce(id).catch((err) => console.error(err)),
    );
  }, 5000);
}

run().catch((err) => console.error(err));
