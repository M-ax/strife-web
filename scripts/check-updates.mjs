import { readUpdates } from "./update-feed.mjs";
const updates = await readUpdates();
console.log(`Verified ${updates.length} signed update feed(s).`);
