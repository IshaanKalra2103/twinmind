import { describe, expect, it } from "vitest";
import { isHallucination } from "@/lib/transcribeFilter";

describe("isHallucination", () => {
  it("flags Whisper phantoms on silence", () => {
    expect(isHallucination("thanks for watching")).toBe(true);
    expect(isHallucination("Thank you!")).toBe(true);
    expect(isHallucination("[Music]")).toBe(true);
    expect(isHallucination("")).toBe(true);
  });

  it("flags short foreign-language phantoms", () => {
    expect(isHallucination("merci")).toBe(true);
    expect(isHallucination("takk")).toBe(true);
    // Norwegian drift under 25 chars with non-ASCII
    expect(isHallucination("hvä")).toBe(true);
  });

  it("passes real English speech", () => {
    expect(isHallucination("We need to talk about the Q3 revenue miss.")).toBe(false);
    expect(isHallucination("Yeah, I think the migration worked.")).toBe(false);
  });

  it("passes longer non-ASCII content (probably real, not a phantom)", () => {
    expect(
      isHallucination(
        "Nuestra reunión sobre el presupuesto del próximo trimestre duró más de lo previsto."
      )
    ).toBe(false);
  });
});
