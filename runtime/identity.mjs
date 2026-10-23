export const localIdentity = 'StudySpace-Local-2.0.0';

export function classifyLocalIdentity(identity) {
  if (identity === localIdentity) return 'ready';
  if (identity === 'StudySpace-Local-0.2.0') return 'legacy';
  return 'occupied';
}
