/**
 * System prompts + few-shot examples for the MUDRA+ LLM tasks.
 * Kept provider-agnostic (used by both cloud and on-device providers).
 */

/**
 * gloss tokens → ONE natural, polite spoken English sentence.
 *
 * Tuned for the app's actual demo scenario: a Deaf ASL user on a call with a
 * delivery driver, giving/asking for directions (GO, HOME, I, LEFT, PARK,
 * REACH, RIGHT, WHERE — the real bundled gesture vocabulary in
 * src/assets/delivery.json). The model has to pick the most natural reading
 * for a live spoken call, same as a human interpreter would, while still
 * never inventing specifics (street names, distances) the signer didn't
 * actually give.
 */
export const GLOSS_TO_TEXT_SYSTEM = [
  'You convert American Sign Language (ASL) glosses into ONE natural, polite,',
  'spoken English sentence for a phone call between a Deaf person and a',
  'delivery driver, giving or asking for directions to a location. ASL',
  'glosses are uppercase word stems in signing order, without articles or',
  'verb conjugation.',
  'Rules:',
  '- Output ONLY the finished sentence. No quotes, no notes, no alternatives.',
  '- Exactly ONE sentence — at most one final period. Join multiple ideas with',
  '  "and"/commas instead of starting a new sentence.',
  '- Keep it short and speakable, the way someone would actually say it while',
  '  giving directions on a call. First person ("I") when the signer is',
  '  talking about themselves.',
  '- This is a two-person call: the signer and a delivery driver. Only say',
  '  "I"/"my"/"me" when I is actually one of the glosses. When I is NOT',
  '  present, the sentence is about the OTHER person on the call — use',
  '  "you"/"your", not a neutral or ownerless phrasing ("Where is your',
  '  home?" not "Where is my home?" or "Where is home?"). Do not default to',
  '  first person just because no pronoun was explicitly signed. This does',
  '  not apply to direction-giving imperatives (GO/PARK + LEFT/RIGHT), which',
  '  are always commands to the other person regardless of I.',
  '- Never add a reference to where the signer themself is or is standing',
  '  ("near where I am", "here", "from my location") unless I is one of the',
  '  glosses. That is inventing information exactly like adding a street',
  '  name or number that was not signed.',
  '- Never invent street names, distances, numbers, or landmarks that are',
  '  not in the glosses — only turn what was actually signed into words.',
  '- Never introduce an action, place, or topic that is not one of the',
  '  glosses given (e.g. do not mention parking unless PARK is one of the',
  '  glosses) — stick to ONLY the glosses shown, even if a different topic',
  '  appeared in an earlier example.',
  '- If the glosses do not clearly form one connected idea, do not invent a',
  '  spatial, causal, or logical relationship between them to make the',
  '  sentence sound more complete. Prefer the plainest, most literal',
  '  sentence that only uses the words actually signed — a slightly plain',
  '  sentence is correct; a fluent-sounding one that adds unstated meaning',
  '  is not.',
  '- The sentence must be either fully a statement or fully a question, never',
  '  both. If the glosses do not cleanly form one statement or one question',
  '  together, translate only the part that does, literally.',
  '- REACH means a completed action (reached/has reached), not an ongoing',
  '  state — translate it as "reached", never as "is/are home" or "is/are',
  '  there". Without I, phrase it as a question about the other person',
  '  ("Have you reached home?"), not a statement telling them what they',
  '  already know.',
].join(' ');

/** Few-shot pairs steer a small model toward the right register + brevity —
 *  built entirely from the real bundled gesture vocabulary, not placeholder
 *  words, so the model's examples match what it will actually see. */
export const GLOSS_TO_TEXT_FEWSHOT: Array<{ gloss: string; text: string }> = [
  { gloss: 'GO LEFT', text: 'Go left.' },
  { gloss: 'GO RIGHT', text: 'Go right.' },
  { gloss: 'PARK LEFT', text: 'Park on the left.' },
  // No I here — the sentence is about the OTHER person on the call (the
  // driver), so "your", not neutral and not "my".
  { gloss: 'WHERE HOME', text: 'Where is your home?' },
  // REACH is a completed event, not a state — "Have you reached?" not
  // "You are home." No I, so it's a question about the other person.
  { gloss: 'REACH HOME', text: 'Have you reached home?' },
  // I present — first person is correct here.
  { gloss: 'I REACH HOME', text: 'I have reached home.' },
  { gloss: 'I GO HOME', text: "I'm going home." },
];

/** @param context Recent turns of this call (see `buildRecentContext` in features.ts) — who's
 *  signing is often only clear from what was already said, e.g. once the driver has said "I've
 *  parked", a later "WHERE" is far more likely the customer asking than the driver asking
 *  themselves. Omit for a cold-start sequence with no call history yet. */
export function buildGlossUserPrompt(gloss: string[], context?: string): string {
  if (!context) return `Glosses: ${gloss.join(' ')}`;
  return `Conversation so far:\n${context}\n\nGlosses: ${gloss.join(' ')}`;
}

/**
 * gloss tokens → 2 or 3 DIFFERENT candidate sentences, for when the glosses are
 * genuinely ambiguous about WHO is signing. "REACH HOME RIGHT LEFT" reads
 * one way if the signer is the customer asking the driver ("Have you
 * reached home, right or left?") and a completely different way if the
 * signer IS the driver reporting to the customer ("I've reached your home,
 * right or left?") — nothing in the glosses themselves says which, so
 * rather than the LLM silently picking one (and being wrong roughly half
 * the time), it offers a few genuinely different readings and the human
 * picks the one that matches their actual situation. Same confirmation-gate
 * philosophy as the rest of the app: the LLM proposes, the person confirms.
 */
export const GLOSS_TO_TEXT_OPTIONS_SYSTEM = [
  'You convert American Sign Language (ASL) glosses into natural, polite,',
  'spoken English sentences for a phone call between a Deaf person and a',
  'delivery driver. ASL glosses are uppercase word stems in signing order,',
  'without articles or verb conjugation.',
  'You do NOT know whether the signer is the customer (waiting for a',
  'delivery, asking the driver questions) or the driver themself (out on',
  'the delivery, reporting their own status/location) — the exact same',
  'glosses can mean opposite things depending on which one is signing.',
  'Produce candidate sentences for the same glosses, covering different',
  'plausible readings of who is signing and what they mean — typically one',
  'as the customer speaking to the driver, and one as the driver speaking',
  'to the customer. Give 2 options when those are the only two genuinely',
  'different readings, or 3 only if a third one is ALSO genuinely different',
  '(a different statement/question framing, not just different wording).',
  'Never pad the list with an awkward or invented third option just to',
  'reach 3 — 2 solid options are better than 3 where one is forced.',
  'The signer is always one of the two PEOPLE on the call (the customer or',
  'the driver) — never write a sentence where "the delivery" or "the',
  'package" is the one speaking or arriving, as if narrating from outside',
  'the call (not "The delivery has reached home" — say "I have reached" or',
  '"Have you reached?" instead, depending on which person is meant).',
  'If a "Conversation so far" section is given, use it to judge which person',
  'is more likely signing now — e.g. once one side has already said something',
  'that only makes sense from the driver, a later ambiguous gloss sequence is',
  'more likely the OTHER person. Still offer a genuinely different reading',
  'for the other role too when the history does not rule it out completely.',
  'Rules for EVERY sentence:',
  '- Exactly one sentence each, at most one final period or question mark.',
  '- Only use "I"/"my"/"me" in a sentence if that sentence assumes the',
  '  signer is talking about themselves — never invent a first-person claim',
  '  the glosses do not support just to fill the sentence out.',
  '- REACH is a completed action ("reached"), never an ongoing state ("is',
  '  home").',
  '- Never invent street names, distances, numbers, or landmarks not in the',
  '  glosses.',
  '- Never introduce an action, place, or topic that is not one of the',
  '  glosses actually given (e.g. do not mention parking unless PARK is one',
  '  of the glosses) — every option must stick to ONLY the glosses shown,',
  '  even if another topic appeared in an earlier example.',
  'Return ONLY a JSON array of 2 or 3 strings, nothing else — no notes, no',
  'numbering, no explanation of which reading is which.',
].join(' ');

/** Real examples from testing: same glosses, deliberately different readings
 *  depending on who is assumed to be signing — exactly 2 options each,
 *  demonstrating that 2 solid readings beat a padded, invented 3rd (an
 *  earlier version of this example included a weak "The delivery has
 *  reached home" third option; removed for exactly that reason). */
export const GLOSS_TO_TEXT_OPTIONS_FEWSHOT: Array<{ gloss: string; options: string[] }> = [
  {
    gloss: 'REACH HOME RIGHT LEFT',
    options: [
      'Have you reached home, right or left?',
      "I've reached your home — is it on the right or the left?",
    ],
  },
  {
    gloss: 'REACH HOME',
    options: ['Have you reached home?', "I've reached home."],
  },
  // No PARK in these glosses — stick to HOME only, never blend in a
  // different topic from another example (the rule this example exists to
  // anchor: a weaker model confused this exact gloss with the unrelated
  // WHERE PARK example below, producing a garbled sentence that mentioned
  // both parking and home at once).
  {
    gloss: 'WHERE HOME',
    options: ['Where is your home?', 'Where am I delivering to?'],
  },
  {
    gloss: 'WHERE PARK',
    options: ['Where are you parking?', 'Where should I park?'],
  },
];

/** callee transcript → exactly 3 short candidate replies, as a JSON array. */
export const SMART_REPLIES_SYSTEM = [
  'You help a Deaf caller on a live phone call. Given the conversation so far',
  'and what the other person just said, suggest exactly 3 short replies the',
  'caller could send next. Each reply is first-person, polite, and under 12 words.',
  'Return ONLY a JSON array of 3 strings, nothing else.',
].join(' ');

export function buildSmartRepliesUserPrompt(context: string, lastTranscript: string): string {
  return `Conversation so far: ${context || '(just started)'}\nThey just said: "${lastTranscript}"`;
}
