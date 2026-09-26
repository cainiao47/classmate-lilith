const clean = (value) => String(value ?? "").trim();

export function createTerminologySnapshot(library, groupIds = []) {
  const selected = new Set(groupIds);
  const groups = (library?.groups || []).filter((group) => selected.has(group.id)).map(({ id, name }) => ({ id, name }));
  const groupSet = new Set(groups.map((group) => group.id));
  const terms = (library?.terms || []).filter((term) => term.enabled !== false && groupSet.has(term.groupId)).map((term) => ({
    id: term.id, canonical: clean(term.canonical), aliases: (term.aliases || []).map(clean).filter(Boolean), category: clean(term.category), note: clean(term.note), groupId: term.groupId
  })).filter((term) => term.canonical);
  return { version: 1, capturedAt: new Date().toISOString(), groups, terms };
}

export function formatTerminologyPrompt(snapshot, sourceText = "", maxLength = 12000) {
  const source = clean(sourceText).toLowerCase();
  const terms = [...(snapshot?.terms || [])].sort((a, b) => {
    const matched = (term) => [term.canonical, ...(term.aliases || [])].some((value) => value && source.includes(String(value).toLowerCase()));
    return Number(matched(b)) - Number(matched(a));
  });
  const lines = [];
  for (const term of terms) {
    const aliases = term.aliases?.length ? `（常见误写/别称：${term.aliases.join("、")}）` : "";
    const category = term.category ? `[${term.category}] ` : "";
    const note = term.note ? ` — ${term.note}` : "";
    const line = `${category}${term.canonical}${aliases}${note}`;
    if (lines.join("\n").length + line.length + 1 > maxLength) break;
    lines.push(line);
  }
  return lines.join("\n");
}

export function combineGlossary(localGlossary, snapshot, sourceText = "", maxLength = 12000) {
  return [clean(localGlossary), formatTerminologyPrompt(snapshot, sourceText, maxLength)].filter(Boolean).join("\n");
}
