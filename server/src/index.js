import "dotenv/config";
import mongoose from "mongoose";
import app from "./app.js";
import { Settings } from "./models.js";

const requiredEnv = ["MONGODB_URI", "JWT_SECRET"];
for (const name of requiredEnv) {
  if (!process.env[name]) throw new Error(`${name} must be set.`);
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters.");
}

const port = Number(process.env.PORT) || 4000;
await mongoose.connect(process.env.MONGODB_URI);
await Settings.updateOne(
  { key: "app" },
  { $setOnInsert: { key: "app", setupComplete: false } },
  { upsert: true }
);

app.listen(port, () => console.log(`People Ops API listening on port ${port}`));

async function shutdown() {
  await mongoose.disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
