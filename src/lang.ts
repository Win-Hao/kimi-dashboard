/** Footer/hint language. The agent-facing slash commands localise themselves; this only covers our own strings. */
export type Lang = "zh" | "en";
export type LangSetting = "auto" | Lang;

/** Config wins; otherwise the POSIX locale variables in precedence order; otherwise English. */
export function detectLang(setting: LangSetting, env: NodeJS.ProcessEnv): Lang {
  if (setting === "zh" || setting === "en") return setting;
  for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const value = env[key]?.trim();
    if (!value) continue;
    return value.toLowerCase().startsWith("zh") ? "zh" : "en";
  }
  return "en";
}
