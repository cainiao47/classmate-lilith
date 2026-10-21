import assert from "node:assert/strict";
import test from "node:test";
import { readNdjson } from "../public/modules/ndjson-stream.js";

function responseFrom(text) {
  return new Response(new Blob([text]).stream(), { status: 200 });
}

test("NDJSON reader requires an explicit done event", async () => {
  const events = [];
  await readNdjson(responseFrom('{"type":"chunk","index":0}\n{"type":"done"}\n'), (event) => events.push(event.type));
  assert.deepEqual(events, ["chunk", "done"]);
  await assert.rejects(
    () => readNdjson(responseFrom('{"type":"chunk","index":0}\n'), () => {}),
    /连接提前结束/
  );
});
