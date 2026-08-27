import { expect, test } from "vitest";
import { detectLang } from "../src/lang.js";

test("language comes from config first, then LC_ALL / LC_MESSAGES / LANG, defaulting to English", () => {
  expect(detectLang("zh", {})).toBe("zh");
  expect(detectLang("en", { LANG: "zh_CN.UTF-8" })).toBe("en");
  expect(detectLang("auto", { LANG: "zh_CN.UTF-8" })).toBe("zh");
  expect(detectLang("auto", { LANG: "zh_TW.Big5" })).toBe("zh");
  expect(detectLang("auto", { LC_ALL: "en_US.UTF-8", LANG: "zh_CN.UTF-8" })).toBe("en");
  expect(detectLang("auto", { LC_MESSAGES: "zh_CN", LANG: "en_US.UTF-8" })).toBe("zh");
  expect(detectLang("auto", { LANG: "ja_JP.UTF-8" })).toBe("en");
  expect(detectLang("auto", { LANG: "C" })).toBe("en");
  expect(detectLang("auto", {})).toBe("en");
});
