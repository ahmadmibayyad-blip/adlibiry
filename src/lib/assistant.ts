// Opens the AI assistant chat panel (AIAssistant.tsx listens for this).
export const OPEN_ASSISTANT_EVENT = "adspy:open-assistant";
export const openAssistant = () => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT));
