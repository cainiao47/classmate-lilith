export function splitTranscript(text, limit = 10_000) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > limit) {
      pushCurrent();
      const sentences = paragraph.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) || [paragraph];
      for (const sentence of sentences) {
        if ((current + sentence).length > limit) pushCurrent();
        if (sentence.length > limit) {
          for (let index = 0; index < sentence.length; index += limit) chunks.push(sentence.slice(index, index + limit));
        } else {
          current += sentence;
        }
      }
      pushCurrent();
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > limit) pushCurrent();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  pushCurrent();
  return chunks;
}

export function extractJsonObject(content) {
  const source = String(content || "");
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

export function escapeJsonControlCharacters(content) {
  const source = String(content || "");
  let quoted = false;
  let escaped = false;
  let output = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
        output += char;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        output += char;
        continue;
      }
      if (char === '"') {
        quoted = false;
        output += char;
        continue;
      }
      const code = char.charCodeAt(0);
      if (code < 0x20) {
        const next = source.slice(index + 1).match(/\S/)?.[0] || "";
        if ((char === "\n" || char === "\r") && (next === "}" || next === "]")) {
          output += `"${char}`;
          quoted = false;
          continue;
        }
        output += char === "\n" ? "\\n" : char === "\r" ? "\\r" : char === "\t" ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
    } else if (char === '"') {
      quoted = true;
    }
    output += char;
  }
  return output;
}

function parseJsonPayload(content) {
  if (!content || !content.trim()) throw new Error("模型返回了空内容。");
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch (originalError) {
    const extracted = extractJsonObject(cleaned);
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    const object = extracted || (firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : null);
    if (!object) throw originalError;
    try { return JSON.parse(object); }
    catch { return JSON.parse(escapeJsonControlCharacters(object)); }
  }
}

export function parseModelJson(content) {
  const parsed = parseJsonPayload(content);
  const correctedText = parsed.corrected_text ?? parsed.correctedText ?? parsed.text;
  if (typeof correctedText !== "string" || !correctedText.trim()) throw new Error("模型返回格式缺少校订文本。");
  return {
    corrected_text: correctedText,
    uncertainties: Array.isArray(parsed.uncertainties) ? parsed.uncertainties : [],
    changes: Array.isArray(parsed.changes) ? parsed.changes : []
  };
}

export function parseRewriteJson(content) {
  const parsed = parseJsonPayload(content);
  const writtenText = parsed.written_text ?? parsed.writtenText ?? parsed.text;
  if (typeof writtenText !== "string" || !writtenText.trim()) throw new Error("模型返回格式缺少论述稿正文。");
  return { written_text: writtenText.trim() };
}

export function sanitizeCorrectedText(output, sourceText) {
  let text = String(output || "").trim();
  const tagged = text.match(/<transcript>\s*([\s\S]*?)(?:\s*<\/transcript>|$)/i);
  if (tagged?.[1]) text = tagged[1].trim();
  text = text
    .replace(/^(?:(?:课程背景|术语(?:、人名或补充)?提示)[：:]?.*(?:\r?\n)+)+/g, "")
    .replace(/^请只做全文一致性检查[：:]?\s*/i, "")
    .replace(/^<\/?transcript>\s*/i, "")
    .replace(/\s*<\/transcript>\s*$/i, "")
    .trim();
  const sourceLength = String(sourceText || "").trim().length;
  if (!text || (sourceLength > 300 && (text.length < sourceLength * 0.45 || text.length > sourceLength * 1.8))) {
    throw new Error("模型返回的校订稿长度异常，程序未覆盖现有文本。");
  }
  return text;
}

export function locateUncertainties(text, uncertainties) {
  return uncertainties.map((item) => {
    const needle = String(item.current_text || item.suggestion || item.original || "");
    let start = -1;
    const context = String(item.context || "");
    if (needle && context) {
      const contextStart = text.indexOf(context);
      const withinContext = context.indexOf(needle);
      if (contextStart >= 0 && withinContext >= 0) start = contextStart + withinContext;
    }
    if (start < 0 && needle) start = text.indexOf(needle);
    return {
      ...item,
      current_text: needle,
      anchor: start >= 0 ? {
        start,
        end: start + needle.length,
        prefix: text.slice(Math.max(0, start - 28), start),
        suffix: text.slice(start + needle.length, start + needle.length + 28)
      } : null
    };
  }).filter((item) => item.anchor);
}

export function openAiSchema(parser) {
  if (parser === parseRewriteJson) {
    return { type: "object", properties: { written_text: { type: "string" } }, required: ["written_text"], additionalProperties: false };
  }
  const uncertainty = { type: "object", properties: {
    original: { type: "string" }, current_text: { type: "string" }, suggestion: { type: "string" },
    reason: { type: "string" }, context: { type: "string" }, confidence: { type: "string", enum: ["low", "medium"] }
  }, required: ["original", "current_text", "suggestion", "reason", "context", "confidence"], additionalProperties: false };
  const change = { type: "object", properties: { before: { type: "string" }, after: { type: "string" }, reason: { type: "string" } }, required: ["before", "after", "reason"], additionalProperties: false };
  return { type: "object", properties: {
    corrected_text: { type: "string" }, uncertainties: { type: "array", items: uncertainty }, changes: { type: "array", items: change }
  }, required: ["corrected_text", "uncertainties", "changes"], additionalProperties: false };
}

export function openAiOutputText(payload) {
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) if (part?.type === "output_text" && part.text) return String(part.text);
  }
  return String(payload?.output_text || "");
}
