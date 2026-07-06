import { describe, expect, it } from "vitest";
import { bannerMarkdown, normalizeLang } from "../src/instance";

describe("per-language instance banner", () => {
  const MAP = JSON.stringify({ en: "In alpha.", es: "En alfa.", ja: "アルファ版です。" });

  it("keeps a plain string banner as-is for any language", () => {
    expect(bannerMarkdown("Keep copies.", "en")).toBe("Keep copies.");
    expect(bannerMarkdown("Keep copies.", "es")).toBe("Keep copies.");
  });

  it("picks the requested language from a JSON map", () => {
    expect(bannerMarkdown(MAP, "es")).toBe("En alfa.");
    expect(bannerMarkdown(MAP, "ja")).toBe("アルファ版です。");
  });

  it("falls back to en, then to the first value", () => {
    expect(bannerMarkdown(MAP, "de")).toBe("In alpha.");
    expect(bannerMarkdown(JSON.stringify({ fr: "En alpha." }), "ko")).toBe("En alpha.");
  });

  it("treats a non-JSON brace-opening banner as plain markdown", () => {
    expect(bannerMarkdown("{not json, just a banner", "en")).toBe("{not json, just a banner");
  });

  it("returns null for empty or effectively-empty values", () => {
    expect(bannerMarkdown(undefined, "en")).toBeNull();
    expect(bannerMarkdown("   ", "en")).toBeNull();
    expect(bannerMarkdown(JSON.stringify({ en: "  " }), "en")).toBeNull();
  });

  it("normalizes language tags", () => {
    expect(normalizeLang("es-MX")).toBe("es");
    expect(normalizeLang("EN")).toBe("en");
    expect(normalizeLang("")).toBe("en");
    expect(normalizeLang("<script>")).toBe("script");
    expect(normalizeLang(undefined)).toBe("en");
  });
});
