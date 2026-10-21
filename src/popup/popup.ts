import type { Request, Status } from '../shared/storage';
import { MINUTE } from '../shared/time';

const LABELS: Record<Status['state'], string> = {
  ready: 'Ready',
  active: 'Active session',
  cooldown: 'Cooling down',
  spent: 'Budget spent',
};

const $ = (id: string) => document.getElementById(id)!;

function fmt(ms: number): string {
  const totalSec = Math.floor((ms / MINUTE) * 60);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}

async function render(): Promise<void> {
  const s: Status = await chrome.runtime.sendMessage({ type: 'status' } satisfies Request);
  $('used').textContent = fmt(Math.min(s.usedMs, s.budgetMs));
  $('budget').textContent = `of ${s.settings.budgetMin} min`;
  ($('fill') as HTMLElement).style.width = `${Math.min(100, (s.usedMs / s.budgetMs) * 100)}%`;
  $('state').textContent = LABELS[s.state];
  $('pending').hidden = !s.pending;
}

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.extension.isAllowedIncognitoAccess().then((ok) => ($('incognito').hidden = ok));
void render();
setInterval(render, 5000);
