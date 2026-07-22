export interface TranslationRule {
  readonly pattern: RegExp;
  readonly replacement: string | ((substring: string, ...args: string[]) => string);
}

export type EnglishCatalog = Readonly<Record<string, string>>;

