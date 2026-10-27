import { test } from "node:test";
import assert from "node:assert/strict";
import { readCompletion } from "../src/completion.ts";
function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7)
          c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`;
test("fragmented streaming answers preserve unicode, final model and usage, ignoring reasoning", async () => {
  const r = await readCompletion(
    response(
      ": ping\r\n\r\n" +
        frame({
          choices: [{ delta: { reasoning_content: "not an answer" } }],
        }) +
        frame({
          model: "route",
          choices: [{ delta: { content: '{"reason":"café"}' } }],
        }) +
        frame({
          model: "actual-model",
          choices: [{ delta: {}, finish_reason: "stop" }],
        }) +
        frame({ choices: [], usage: { total_tokens: 42 } }) +
        "data: [DONE]\r\n\r\n",
    ),
  );
  assert.equal(r.choices[0].message.content, '{"reason":"café"}');
  assert.equal(r.model, "actual-model");
  assert.equal(r.usage.total_tokens, 42);
});
test("HTTP 200 stream errors reject even after answer text and never expose provider error payloads", async () => {
  await assert.rejects(
    () =>
      readCompletion(
        response(
          frame({
            choices: [{ delta: { content: '{"decision":"approve"}' } }],
          }) +
            frame({
              error: { message: "provider_deadline secret-test-token" },
            }) +
            "data: [DONE]\n\n",
        ),
      ),
    (e: any) =>
      e.code === "METERLESS_PROVIDER_TIMEOUT" &&
      !e.message.includes("secret-test-token"),
  );
});
test("truncated or token-limited streams cannot be treated as completed proposals", async () => {
  await assert.rejects(
    () =>
      readCompletion(
        response(
          frame({
            choices: [{ delta: { content: "{}" }, finish_reason: "stop" }],
          }),
        ),
      ),
    /complete answer/,
  );
  await assert.rejects(
    () =>
      readCompletion(
        response(
          frame({
            choices: [{ delta: { content: "{}" }, finish_reason: "length" }],
          }) + "data: [DONE]\n\n",
        ),
      ),
    /complete answer/,
  );
});
