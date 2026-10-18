// Languages an ad's transcript can be translated into (transcriptsAi.translate):
// the markets AdSpy Pro users sell in.
export const TRANSCRIPT_LANGUAGES = [
  "English", "Danish", "Swedish", "Norwegian", "Finnish", "German", "Dutch", "French", "Spanish", "Italian", "Portuguese", "Polish", "Arabic",
] as const;

export function isTranscriptLanguage(s: string): s is (typeof TRANSCRIPT_LANGUAGES)[number] {
  return (TRANSCRIPT_LANGUAGES as readonly string[]).includes(s);
}
