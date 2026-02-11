import redis from '../redis/redisClient.js';
import db from '../db/dbClient.js';

const STREAM_KEY = process.env.HOSPITAL_STREAM || 'hospital:state';
const GROUP_NAME = 'api_state_cache';
const CONSUMER_NAME = `cache-${Math.random().toString(36).substring(7)}`;

// In-memory cache: hospital_id -> state object
const hospitalCache = {};
// Simulation overrides: hospital_id -> partial state object
let simulationOverrides = {};

export function getHospitalCache() {
  // Merge Cache + Overrides
  const effectiveCache = { ...hospitalCache };
  for (const [id, override] of Object.entries(simulationOverrides)) {
      if (effectiveCache[id]) {
          effectiveCache[id] = { ...effectiveCache[id], ...override, is_simulated: true };
      }
  }
  return effectiveCache;
}

export function setSimulationOverride(hospitalId, overrideData) {
    simulationOverrides[hospitalId] = {
        ...(simulationOverrides[hospitalId] || {}),
        ...overrideData
    };
    console.log(`[Simulation] Override set for ${hospitalId}`, overrideData);
}

export function clearSimulationOverrides() {
    simulationOverrides = {};
    console.log('[Simulation] Overrides cleared');
}

export function getSimulationState() {
    return simulationOverrides;
}

/**
 * Initializes the consumer group and starts the continuous read loop.
 * This runs in the background of the main API process.
 */
export async function startStateCache() {
  try {
    // 0. Seed from MySQL (Initial State)
    console.log('[StateCache] Seeding from MySQL...');
    const [rows] = await db.execute('SELECT * FROM hospitals');
    for (const row of rows) {
        hospitalCache[row.hospital_id] = {
            hospital_id: row.hospital_id,
            latitude: row.latitude,
            longitude: row.longitude,
            type: row.type,
            // Default state for static data
            available_beds: row.total_beds, // Optimistic default
            available_icu_beds: row.icu_beds,
            current_load_score: 0,
            status: 'NORMAL',
            ...row // Include other fields
        };
    }
    console.log(`[StateCache] Seeded ${Object.keys(hospitalCache).length} hospitals from DB.`);

    // 1. Create Consumer Group (if not exists)
    await redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '0', 'MKSTREAM');
  } catch (err) {
    if (err.message && !err.message.includes('BUSYGROUP')) {
      console.error('Error creating consumer group or seeding:', err);
    }
  }

  console.log(`[StateCache] Started consumer ${CONSUMER_NAME} for group ${GROUP_NAME}`);
  consumeLoop();
}

async function consumeLoop() {
  while (true) {
    try {
      // Read new messages
      const response = await redis.xreadgroup(
        'GROUP',
        GROUP_NAME,
        CONSUMER_NAME,
        'BLOCK',
        2000, // wait 2s for new data
        'COUNT',
        10,
        'STREAMS',
        STREAM_KEY,
        '>' // unread messages
      );

      if (response) {
        const [stream, messages] = response[0];
        
        for (const [id, fields] of messages) {
          // Parse fields array [key1, val1, key2, val2...]
          const state = {};
          for (let i = 0; i < fields.length; i += 2) {
            state[fields[i]] = fields[i + 1];
          }

          // Update Cache
          if (state.hospital_id) {
            // Merge with existing or overwrite?
            // Since our producer sends full snapshots, we overwrite mostly.
            // But let's merge just in case partial updates happen later.
            hospitalCache[state.hospital_id] = {
              ...(hospitalCache[state.hospital_id] || {}),
              ...state,
              last_updated_at: Date.now()
            };
          }

          // Acknowledge immediately (we have it in memory)
          await redis.xack(STREAM_KEY, GROUP_NAME, id);
        }
      }
      
    } catch (error) {
      console.error('[StateCache] Error in loop:', error);
      // specific redis errors handling?
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}
