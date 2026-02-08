/**
 * Simple Decision Agent which consumes hospital state stream using a consumer group.
 * Demonstrates Redis Streams consumer group usage with replay capability.
 */
import dotenv from "dotenv";
import redis from "../redis/redisClient.js";
import { randomUUID } from "crypto";

dotenv.config();
const STREAM = process.env.HOSPITAL_STREAM || "hospital:state";
const GROUP = "decision_agents";
const CONSUMER = `agent-${randomUUID().slice(0, 8)}`;

async function ensureGroup() {
  try {
    await redis.xgroup("CREATE", STREAM, GROUP, "$", "MKSTREAM");
    console.log(
      JSON.stringify({ event: "consumer_group_created", group: GROUP }),
    );
  } catch (err) {
    if (err.message && err.message.includes("BUSYGROUP")) {
      // already exists
    } else {
      console.error("Error creating group", err.message || err);
    }
  }
}

async function handleMessage(id, fields) {
  const obj = {};
  for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
  console.log(
    JSON.stringify({
      event: "message_received",
      id,
      hospital_id: obj.hospital_id,
      status: obj.status,
      available_beds: obj.available_beds,
    }),
  );
}

async function mainLoop() {
  while (true) {
    try {
      const res = await redis.xreadgroup(
        "GROUP",
        GROUP,
        CONSUMER,
        "BLOCK",
        5000,
        "COUNT",
        10,
        "STREAMS",
        STREAM,
        ">",
      );
      if (!res) continue;
      const [_stream, messages] = res[0];
      for (const [id, fields] of messages) {
        await handleMessage(id, fields);
        await redis.xack(STREAM, GROUP, id);
      }
    } catch (err) {
      console.error(
        JSON.stringify({ event: "agent_loop_error", error: String(err) }),
      );
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function run() {
  await ensureGroup();
  console.log(
    JSON.stringify({
      event: "agent_start",
      consumer: CONSUMER,
      stream: STREAM,
    }),
  );
  await mainLoop();
}

run().catch((err) => console.error(err));
