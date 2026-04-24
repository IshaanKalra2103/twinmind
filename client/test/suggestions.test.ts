import { describe, expect, it } from "vitest";
import { parseSuggestionsJson } from "@/lib/suggestions";

const goodThree = JSON.stringify({
  suggestions: [
    { type: "question", preview: "Ask about margins.", rationale: "Margins mentioned." },
    { type: "fact_check", preview: "US CPI is 3.4%, not 2.1%.", rationale: "CPI misstated." },
    { type: "clarifying_info", preview: "EMEA = Europe/ME/Africa.", rationale: "Term used." },
  ],
});

describe("parseSuggestionsJson", () => {
  it("accepts exactly 3 valid suggestions", () => {
    const out = parseSuggestionsJson(goodThree);
    expect(out).toHaveLength(3);
    expect(out[0].type).toBe("question");
    expect(out[1].preview).toMatch(/CPI/);
    expect(out[2].rationale).toBe("Term used.");
  });

  it("rejects wrong suggestion count", () => {
    const raw = JSON.stringify({ suggestions: [] });
    expect(() => parseSuggestionsJson(raw)).toThrow(/Expected 3/);
  });

  it("rejects unknown type values", () => {
    const raw = JSON.stringify({
      suggestions: [
        { type: "bogus", preview: "x", rationale: "y" },
        { type: "question", preview: "x", rationale: "y" },
        { type: "question", preview: "x", rationale: "y" },
      ],
    });
    expect(() => parseSuggestionsJson(raw)).toThrow(/type invalid/);
  });

  it("rejects empty previews", () => {
    const raw = JSON.stringify({
      suggestions: [
        { type: "question", preview: "", rationale: "y" },
        { type: "question", preview: "x", rationale: "y" },
        { type: "question", preview: "x", rationale: "y" },
      ],
    });
    expect(() => parseSuggestionsJson(raw)).toThrow(/preview missing/);
  });

  it("nulls missing rationales and trims/caps fields", () => {
    const raw = JSON.stringify({
      suggestions: [
        { type: "question", preview: "  trim me  " },
        { type: "question", preview: "a".repeat(500), rationale: "b".repeat(500) },
        { type: "talking_point", preview: "ok", rationale: "" },
      ],
    });
    const out = parseSuggestionsJson(raw);
    expect(out[0].preview).toBe("trim me");
    expect(out[0].rationale).toBeNull();
    expect(out[1].preview.length).toBe(280);
    expect(out[1].rationale?.length).toBe(200);
    expect(out[2].rationale).toBeNull();
  });
});
