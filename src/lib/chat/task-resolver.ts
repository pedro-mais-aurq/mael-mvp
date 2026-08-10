import type { TaskRow } from "../mael-types";
import type { TaskService } from "../services/task.service";
import { normalizePolicyText, type TaskResolutionStatus } from "./turn-policy";

export interface ResolvedTaskReference {
  id: string;
  title: string;
  completed: boolean;
}

export interface TargetCandidateSet {
  key: string;
  candidates: ReadonlyArray<ResolvedTaskReference>;
}

export interface TaskResolution {
  targets: ReadonlyArray<TargetCandidateSet>;
  truncated: boolean;
}

function tokens(value: string): string[] {
  return normalizePolicyText(value).split(/\s+/).filter(Boolean);
}

function matchesTarget(task: TaskRow, target: ReadonlyArray<string>): boolean {
  const titleTerms = new Set(tokens(task.title));
  return target.length > 0 && target.every((term) => titleTerms.has(term));
}

export function taskTargetKey(target: ReadonlyArray<string>): string {
  return target.join("\u0000");
}

/** Resolve candidatos sem aceitar filtros controlados pelo LLM. */
export class TaskResolver {
  constructor(private readonly taskService: TaskService) {}

  async resolve(
    userId: string,
    targets: ReadonlyArray<ReadonlyArray<string>>,
    status: TaskResolutionStatus,
  ): Promise<TaskResolution> {
    const result = await this.taskService.listForMutationResolution(userId, status);
    return {
      truncated: result.truncated,
      targets: targets.map((target) => ({
        key: taskTargetKey(target),
        candidates: result.tasks
          .filter((task) => matchesTarget(task, target))
          .map((task) => ({ id: task.id, title: task.title, completed: task.completed })),
      })),
    };
  }
}
