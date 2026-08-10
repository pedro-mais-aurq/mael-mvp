import { describe, expect, it, vi } from "vitest";
import { AppError, ValidationError, handleServiceError } from "./exceptions";

describe("handleServiceError", () => {
  it("passes through AppError messages (already safe for the end user)", () => {
    const err = new ValidationError("Título da tarefa é obrigatório.");
    const result = handleServiceError(err, { route: "test" });
    expect(result.message).toBe("Título da tarefa é obrigatório.");
  });

  it("never leaks raw database/driver errors to the caller", () => {
    const dbError = new Error('duplicate key value violates unique constraint "tasks_pkey"');
    const result = handleServiceError(dbError, { route: "test" });
    expect(result.message).not.toContain("constraint");
    expect(result.message).not.toContain("tasks_pkey");
  });

  it("logs the full original error even though the returned message is generic", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handleServiceError(new AppError("algo"), { route: "test", userId: "user-1" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
