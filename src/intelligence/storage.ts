import { emptyState, parseState, type IntelligenceState } from "./engine";
export const storageKey = (accountId: string) =>
  `conferencegate:intelligence:v1:${encodeURIComponent(accountId)}`;
export function readIntelligence(accountId: string) {
  return parseState(localStorage.getItem(storageKey(accountId)));
}
export function saveIntelligence(accountId: string, state: IntelligenceState) {
  localStorage.setItem(storageKey(accountId), JSON.stringify(state));
}
export function exportFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { emptyState };
