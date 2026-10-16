export function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Não foi possível concluir. Tente novamente.';
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function shortDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' }).format(new Date(value));
}

export function isToday(value: string): boolean {
  return new Date(value).toDateString() === new Date().toDateString();
}

export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export const accentLabels = { lavender: 'Lavanda', blue: 'Azul', green: 'Verde', peach: 'Pêssego', rose: 'Rosa' };
