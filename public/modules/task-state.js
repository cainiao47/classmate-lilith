import { isOnlineTranscriptionProvider } from "./online-providers.js";

export const TASK_SCHEMA_VERSION = 4;

export function freshState() {
  return {
    taskId: `task-${crypto.randomUUID()}`,
    projectTitle: "",
    running: false,
    abortController: null,
    failedIndex: null,
    failedStage: null,
    totalChunks: 0,
    correctedChunks: [],
    workingText: "",
    modelDraft: "",
    uncertainties: [],
    changes: [],
    decisions: {},
    userEdited: false,
    consistencyDone: false,
    reviewSourceHash: "",
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    undoStack: [],
    editSnapshot: null,
    status: "draft",
    transcriptionDraft: "",
    transcriptionMeta: null,
    transcriptionEngine: "alibaba",
    transcriptionModel: "qwen3-asr-flash",
    terminologyGroupIds: [],
    terminologySnapshot: null,
    proseRunning: false,
    proseAbortController: null,
    proseStatus: "idle",
    proseMode: "academic",
    proseLecturePlan: null,
    proseGeneratedMode: "",
    proseChunks: [],
    prosePlan: "",
    proseProtectedFacts: [],
    proseText: "",
    proseTotalChunks: 0,
    proseFailedIndex: null,
    proseUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    proseSourceHash: "",
    proseUserEdited: false
  };
}

export function restoreTaskState(task) {
  const restored = {
    ...freshState(),
    ...task,
    taskId: task.id,
    undoStack: [],
    running: false,
    abortController: null,
    proseRunning: false,
    proseAbortController: null
  };
  if (!isOnlineTranscriptionProvider(restored.transcriptionEngine)) restored.transcriptionEngine = "alibaba";
  if (typeof restored.projectTitle !== "string") restored.projectTitle = "";
  if (typeof restored.transcriptionModel !== "string" || !restored.transcriptionModel) restored.transcriptionModel = "qwen3-asr-flash";
  // Existing tasks retain the earlier default; new tasks use the lecture style.
  if (!task.proseMode) restored.proseMode = "detailed";
  if (!["faithful", "detailed", "lecture", "academic"].includes(restored.proseMode)) restored.proseMode = "academic";
  if (restored.proseStatus === "running") restored.proseStatus = "paused";
  return restored;
}
