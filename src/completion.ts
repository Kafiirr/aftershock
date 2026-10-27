import { AppError } from "./domain.ts";

// Buffer only answer text. Reasoning deltas are not executable proposals.
export async function readCompletion(response: Response): Promise<any> {
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return response.json();
  if (!response.body)
    throw new AppError(
      "METERLESS_STREAM",
      "Nightshift returned no response stream.",
      503,
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "",
    data: string[] = [],
    content = "",
    model: string | undefined;
  let usage: unknown = null,
    finished = false,
    finishReason: string | null = null,
    size = 0;
  const frame = () => {
    if (!data.length) return;
    const raw = data.join("\n");
    data = [];
    if (raw === "[DONE]") {
      finished = true;
      return;
    }
    const chunk = JSON.parse(raw);
    if (chunk.error) {
      const timeout = JSON.stringify(chunk.error).includes("provider_deadline");
      throw new AppError(
        timeout ? "METERLESS_PROVIDER_TIMEOUT" : "METERLESS_STREAM",
        timeout
          ? "Nightshift's model provider timed out. No partial answer was accepted."
          : "Nightshift reported a generation error. No partial answer was accepted.",
        503,
      );
    }
    if (chunk.model) model = chunk.model;
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (typeof choice?.delta?.content === "string")
      content += choice.delta.content;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  };
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000)
        throw new AppError(
          "METERLESS_STREAM",
          "Model response exceeded the bounded response size.",
          503,
        );
      pending += decoder.decode(value, { stream: true });
      let boundary: number;
      while (!finished && (boundary = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, boundary).replace(/\r$/, "");
        pending = pending.slice(boundary + 1);
        if (!line) frame();
        else if (line.startsWith("data:"))
          data.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (!finished || finishReason !== "stop" || !content.trim())
      throw new AppError(
        "METERLESS_INCOMPLETE",
        "Nightshift did not finish a complete answer. No partial answer was accepted.",
        503,
      );
    return {
      model,
      usage,
      choices: [{ message: { content }, finish_reason: finishReason }],
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "METERLESS_STREAM",
      "Nightshift's response stream was interrupted or malformed. No partial answer was accepted.",
      503,
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
