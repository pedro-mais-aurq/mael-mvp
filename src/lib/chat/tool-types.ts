import type { JsonValue } from "../mael-types";
import type { ToolAuthorizationPolicy } from "./turn-policy";
import type { TaskResolution } from "./task-resolver";

export interface ToolExecutionResult {
  ok: boolean;
  modelOutput: JsonValue;
  persistedOutput: JsonValue | null;
  fallbackReply: string;
  mutatesTasks: boolean;
}

export interface ToolExecutionContext {
  userId: string;
  userMessage: string;
  now: Date;
  timezone: string;
  policy: ToolAuthorizationPolicy;
  backendTaskResolution: TaskResolution | null;
  backendTaskResolutionPromise: Promise<TaskResolution> | null;
  createdTaskTitles: Set<string>;
  consumedTaskTargetKeys: Set<string>;
  consumedTaskIds: Set<string>;
  mutationAttempts: number;
  readAttempts: number;
}
