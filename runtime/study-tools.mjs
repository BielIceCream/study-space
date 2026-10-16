                                                                

const object = (value         )                                   => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const only = (value                         , keys          ) => Object.keys(value).every(key => keys.includes(key));
/** Treat provider function calls as untrusted input. Creation is always a preview requiring confirmation. */
export function validateJarvisAction(value         , context                    )                      {
  if (!object(value) || !only(value, ['name', 'args']) || !object(value.args)) return null;
  const args = value.args;
  const subjectValid = (id         )               => typeof id === 'string' && context.subjects.some(subject => subject.id === id);
  switch (value.name) {
    case 'open_flashcards':
      return only(args, ['subjectId']) && subjectValid(args.subjectId) ? { name: value.name, args: { subjectId: args.subjectId } } : null;
    case 'start_review':
      return only(args, ['subjectId']) && (args.subjectId === undefined || subjectValid(args.subjectId)) ? { name: value.name, args: args.subjectId === undefined ? {} : { subjectId: args.subjectId } } : null;
    case 'read_active_card':
      return only(args, []) && Boolean(context.contentShared && context.activeCard?.front) ? { name: value.name, args: {} } : null;
    case 'study_feedback':
      return only(args, ['cardId', 'answer']) && context.contentShared && args.cardId === context.activeCard?.id && Boolean(context.activeCard?.front && context.activeCard.back) && typeof args.answer === 'string' && args.answer.trim().length > 0 && args.answer.length <= 4_000
        ? { name: value.name, args: { cardId: args.cardId          , answer: args.answer.trim() } } : null;
    case 'propose_flashcards': {
      const hasSource = Boolean(context.activeNote?.excerpt?.trim()) || context.excerpts.some(excerpt => excerpt.text.trim());
      if (!only(args, ['subjectId', 'cards']) || !subjectValid(args.subjectId) || args.subjectId !== context.activeSubject?.id || !context.contentShared || !hasSource || !Array.isArray(args.cards) || args.cards.length < 1 || args.cards.length > 20) return null;
      const cards                                    = [];
      for (const card of args.cards) {
        if (!object(card) || !only(card, ['front', 'back']) || typeof card.front !== 'string' || typeof card.back !== 'string') return null;
        const front = card.front.trim(); const back = card.back.trim();
        if (!front || !back || front.length > 20_000 || back.length > 20_000) return null;
        if (!cards.some(existing => existing.front === front && existing.back === back)) cards.push({ front, back });
      }
      return { name: value.name, args: { subjectId: args.subjectId, cards } };
    }
    default: return null;
  }
}

export function validateJarvisActions(values         , context                    )                 {
  if (!Array.isArray(values)) return [];
  const seen = new Set        ();
  return values.slice(0, 6).flatMap(value => {
    const action = validateJarvisAction(value, context);
    if (!action) return [];
    const key = JSON.stringify(action);
    if (seen.has(key)) return [];
    seen.add(key);
    return [action];
  });
}
