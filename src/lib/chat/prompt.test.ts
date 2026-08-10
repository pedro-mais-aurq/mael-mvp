import { describe, expect, it } from "vitest";

import { buildChatSystemPrompt } from "./prompt";
import { resolveTimezone } from "./timezone";

describe("prompt e timezone da P3", () => {
  it("inclui UTC, horário local e timezone IANA sem reviver o protocolo JSON", () => {
    const prompt = buildChatSystemPrompt({
      timezone: "America/Sao_Paulo",
      now: new Date("2026-08-09T15:00:00.000Z"),
    });
    expect(prompt).toContain("2026-08-09T15:00:00.000Z");
    expect(prompt).toContain("America/Sao_Paulo");
    expect(prompt).toMatch(/12:00/);
    expect(prompt).toContain("DADOS E TOOLS");
    expect(prompt).not.toContain("assistant_reply");
    expect(prompt).not.toContain("no máximo 3 frases");
    expect(prompt.toLowerCase()).not.toContain("sempre em utc");
    expect(prompt).not.toContain("Ana");
  });

  it("prioriza timezone válido do browser, depois perfil, depois UTC", () => {
    expect(resolveTimezone("Europe/Lisbon", "America/Sao_Paulo")).toBe("Europe/Lisbon");
    expect(resolveTimezone("inválido", "America/Sao_Paulo")).toBe("America/Sao_Paulo");
    expect(resolveTimezone("inválido", "também inválido")).toBe("UTC");
  });
});
