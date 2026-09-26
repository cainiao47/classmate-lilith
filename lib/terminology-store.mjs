import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { writeJsonAtomic } from "./json-file.mjs";

const DEFAULT_GROUP = { id: "general", name: "通用术语", defaultEnabled: true };
const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const unique = (values) => [...new Set(values.map((value) => clean(value, 120)).filter(Boolean))];
const newId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

function normalizeGroup(group = {}, index = 0) {
  return {
    id: clean(group.id, 100) || (index === 0 ? "general" : newId("group")),
    name: clean(group.name, 80) || `术语组 ${index + 1}`,
    defaultEnabled: Boolean(group.defaultEnabled),
    createdAt: clean(group.createdAt, 40) || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function normalizeTerminologyLibrary(input = {}) {
  const rawGroups = Array.isArray(input.groups) ? input.groups.slice(0, 100) : [];
  const groups = rawGroups.map(normalizeGroup);
  if (!groups.some((group) => group.id === "general")) groups.unshift(normalizeGroup(DEFAULT_GROUP));
  const seenGroupIds = new Set();
  for (const group of groups) {
    if (seenGroupIds.has(group.id)) group.id = newId("group");
    seenGroupIds.add(group.id);
  }
  const validGroups = new Set(groups.map((group) => group.id));
  const terms = (Array.isArray(input.terms) ? input.terms : []).slice(0, 5000).map((term = {}) => ({
    id: clean(term.id, 100) || newId("term"),
    canonical: clean(term.canonical, 120),
    aliases: unique(Array.isArray(term.aliases) ? term.aliases : String(term.aliases ?? "").split(/[,，;；\n]/)),
    category: clean(term.category, 40),
    note: clean(term.note, 300),
    groupId: validGroups.has(clean(term.groupId, 100)) ? clean(term.groupId, 100) : "general",
    enabled: term.enabled !== false,
    createdAt: clean(term.createdAt, 40) || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })).filter((term) => term.canonical);
  const seenTermIds = new Set();
  for (const term of terms) {
    if (seenTermIds.has(term.id)) term.id = newId("term");
    seenTermIds.add(term.id);
  }
  return { version: 1, groups, terms, updatedAt: new Date().toISOString() };
}

export class TerminologyStore {
  constructor({ file }) { this.file = file; }

  async initialize() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try { await fs.access(this.file); } catch { await writeJsonAtomic(this.file, normalizeTerminologyLibrary({ groups: [DEFAULT_GROUP], terms: [] })); }
  }

  async load() {
    try { return normalizeTerminologyLibrary(JSON.parse(await fs.readFile(this.file, "utf8"))); }
    catch { return normalizeTerminologyLibrary({ groups: [DEFAULT_GROUP], terms: [] }); }
  }

  async save(input) {
    const library = normalizeTerminologyLibrary(input);
    await writeJsonAtomic(this.file, library);
    return library;
  }

  async upsertTerm(input = {}) {
    const library = await this.load();
    const canonical = clean(input.canonical, 120);
    if (!canonical) throw new Error("术语标准写法不能为空。");
    const groupId = library.groups.some((group) => group.id === input.groupId) ? input.groupId : "general";
    let term = library.terms.find((item) => item.groupId === groupId && item.canonical.toLowerCase() === canonical.toLowerCase());
    if (term) {
      term.aliases = unique([...(term.aliases || []), ...(Array.isArray(input.aliases) ? input.aliases : [])]).filter((alias) => alias !== canonical);
      term.category = clean(input.category, 40) || term.category;
      term.note = clean(input.note, 300) || term.note;
      term.enabled = true;
      term.updatedAt = new Date().toISOString();
    } else {
      term = { id: newId("term"), canonical, aliases: unique(input.aliases || []).filter((alias) => alias !== canonical), category: clean(input.category, 40), note: clean(input.note, 300), groupId, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      library.terms.push(term);
    }
    const saved = await this.save(library);
    return { library: saved, term: saved.terms.find((item) => item.id === term.id) || term };
  }
}
