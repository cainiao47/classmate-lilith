import assert from "node:assert/strict";
import test from "node:test";
import { createSaveQueue } from "../public/modules/save-queue.js";

test("save queue serializes snapshots and reports only the newest result", async () => {
  const order = [];
  const states = [];
  const queue = createSaveQueue({
    save: async (value) => {
      order.push(`start-${value}`);
      await new Promise((resolve) => setTimeout(resolve, value === 1 ? 10 : 0));
      order.push(`end-${value}`);
    },
    onState: (state) => states.push(state)
  });
  await Promise.all([queue.enqueue(1), queue.enqueue(2)]);
  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
  assert.deepEqual(states, ["saved"]);
});

test("save queue reports and propagates failures without blocking later saves", async () => {
  const states = [];
  const queue = createSaveQueue({
    save: async (value) => { if (value === "bad") throw new Error("disk full"); },
    onState: (state) => states.push(state)
  });
  await assert.rejects(() => queue.enqueue("bad"), /disk full/);
  await queue.enqueue("good");
  assert.deepEqual(states, ["failed", "saved"]);
});
