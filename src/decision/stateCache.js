import redis from '../redis/redisClient.js';

const STREAM_KEY = process.env.HOSPITAL_STREAM || 'hospital:state';
const GROUP_NAME = 'api_state_cache';
const CONSUMER_NAME = `cache-${Math.random().toString(36).substring(7)}`;

// In-memory cache: hospital_id -> state object
const hospitalCache = {};

export function getHospitalCache() {
  return hospitalCache;
}

/**
 * Initializes the consumer group and starts the continuous read loop.
 * This runs in the background of the main API process.
 */
export async function startStateCache() {
  try {
    // 1. Create Consumer Group (if not exists)
    // using '$' to only get new messages? No, '0' to configure catchup?
    // Actually, for a cache, we want the LATEST state.
    // Ideally we replay widely to build initial state, then tail.
    // For simplicity: We'll start from '$' (live) or '0' (everything) depending on needs.
    // Let's use '$' for now to avoid processing million old messages on startup
    // OR: Use '0' but don't blocking-process old ones?
    // BETTER: Just read latest entries or build from 0. 
    // Let's try creating group pointing to '$'
    await redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '0', 'MKSTREAM');
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) {
      console.error('Error creating consumer group:', err);
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
