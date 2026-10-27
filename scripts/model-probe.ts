import { config, safeMessage } from "../src/config.ts";
import { readCompletion } from "../src/completion.ts";
const start = Date.now();
const r = await fetch(config.meterlessUrl + "/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + config.meterlessKey,
    "Content-Type": "application/json",
    "meterless-app": config.appId,
    "meterless-scope": "user",
  },
  body: JSON.stringify({
    model: config.model,
    messages: [
      {
        role: "system",
        content:
          "Choose the fastest feasible dispatch. Return JSON with optionId and reason. Only those two keys.",
      },
      {
        role: "user",
        content:
          "Option A uses V2 to deliver 60 kits in 13 minutes. Option B uses V5 to deliver 60 kits in 18 minutes. Both are feasible. Choose the fastest.",
      },
    ],
    max_tokens: 4096,
    temperature: 0.1,
    stream: true,
    stream_options: { include_usage: true },
  }),
  signal: AbortSignal.timeout(180000),
});
let data: any;
let error: string | undefined;
if (!r.ok) {
  error = `HTTP ${r.status}`;
} else {
  try {
    data = await readCompletion(r);
  } catch (e) {
    error = safeMessage(e);
  }
}
console.log(
  JSON.stringify(
    {
      status: r.status,
      durationMs: Date.now() - start,
      model: data?.model,
      usage: data?.usage,
      content: data?.choices?.[0]?.message?.content,
      error,
    },
    null,
    2,
  ),
);
