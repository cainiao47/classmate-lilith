import { isOnlineTranscriptionProvider } from "./online-providers.js";

export const TASK_SCHEMA_VERSION = 3;

export function freshState() {
  return {
    taskId: `task-${crypto.randomUUID()}`,
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
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    undoStack: [],
    editSnapshot: null,
    status: "draft",
    transcriptionDraft: "",
    transcriptionMeta: null,
    transcriptionEngine: "alibaba",
    terminologyGroupIds: [],
    terminologySnapshot: null,
    proseRunning: false,
    proseAbortController: null,
    proseStatus: "idle",
    proseMode: "detailed",
    proseGeneratedMode: "",
    proseChunks: [],
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
  if (restored.proseStatus === "running") restored.proseStatus = "paused";
  return restored;
}
