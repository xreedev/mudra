/**
 * System prompts + few-shot examples for the MUDRA+ LLM tasks.
 * Kept provider-agnostic (used by both cloud and on-device providers).
 */

/**
 * gloss tokens → ONE natural, polite spoken English sentence.
 *
 * Tuned for the app's actual demo scenario: a Deaf ASL user on a call with a
 * delivery driver, giving/asking for directions (ARRIVED, GO, HOME,
 * HOSPITAL, LEFT, ME, NEAR, OR, RIGHT, WHERE — the real bundled gesture
 * vocabulary in src/assets/custom_gestures.json). Navigation glosses are
 * often genuinely ambiguous between a statement and a question (e.g. "LEFT
 * OR RIGHT" could be "Go left or right" or "Is it left or right?") — the
 * model has to pick the most natural reading for a live spoken call, same
 * as a human interpreter would, while still never inventing specifics
 * (street names, distances) the signer didn't actually give.
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
  '  "and"/"or"/commas instead of starting a new sentence.',
  '- Keep it short and speakable, the way someone would actually say it while',
  '  giving directions on a call. First person ("I") when the signer is',
  '  talking about themselves.',
  '- OR only joins the two direction/option words immediately next to it',
  '  ("LEFT OR RIGHT" -> "left or right?"). It never applies to the whole',
  '  sentence or to words it is not directly between.',
  '- This is a two-person call: the signer and a delivery driver. Only say',
  '  "I"/"my"/"me" when ME is actually one of the glosses. When ME is NOT',
  '  present, the sentence is about the OTHER person on the call — use',
  '  "you"/"your", not a neutral or ownerless phrasing ("Where is your',
  '  home?" not "Where is my home?" or "Where is home?"; "Is your home to',
  '  the left or the right?" not "Is my home..." or "Is home..."). Do not',
  '  default to first person just because no pronoun was explicitly signed.',
  '- Never add a reference to where the signer themself is or is standing',
  '  ("near where I am", "here", "from my location") unless ME is one of',
  '  the glosses. That is inventing information exactly like adding a',
  '  street name or number that was not signed.',
  '- Never invent street names, distances, numbers, or landmarks that are',
  '  not in the glosses — only turn what was actually signed into words.',
  '- If the glosses do not clearly form one connected idea, do not invent a',
  '  spatial, causal, or logical relationship between them to make the',
  '  sentence sound more complete. Prefer the plainest, most literal',
  '  sentence that only uses the words actually signed — a slightly plain',
  '  sentence is correct; a fluent-sounding one that adds unstated meaning',
  '  is not.',
  '- The sentence must be either fully a statement or fully a question, never',
  '  both — do not append a question onto a statement (not "You are home,',
  '  right or left?"). If the glosses do not cleanly form one statement or',
  '  one question together, translate only the part that does, literally.',
  '- ARRIVED means a completed action (arrived/has arrived), not an ongoing',
  '  state — translate it as "arrived", never as "is/are home" or "is/are',
  '  there". Without ME, phrase it as a question about the other person',
  '  ("Have you arrived?"), not a statement telling them what they already',
  '  know.',
].join(' ');

/** Few-shot pairs steer a small model toward the right register + brevity —
 *  built entirely from the real bundled gesture vocabulary, not placeholder
 *  words, so the model's examples match what it will actually see. */
export const GLOSS_TO_TEXT_FEWSHOT: Array<{ gloss: string; text: string }> = [
  // "Hospital" isn't personal property either way, so no pronoun is needed
  // regardless of ME — this one stays the same in both directions.
  { gloss: 'WHERE HOSPITAL', text: 'Where is the hospital?' },
  { gloss: 'GO LEFT', text: 'Go left.' },
  // No ME here — the sentence is about the OTHER person on the call (the
  // driver), so "your", not neutral and not "my".
  { gloss: 'WHERE HOME', text: 'Where is your home?' },
  { gloss: 'NEAR HOME LEFT OR RIGHT', text: 'Is your home to the left or the right?' },
  // ARRIVED is a completed event, not a state — "Have you arrived?" not
  // "You are home." No ME, so it's a question about the other person.
  { gloss: 'ARRIVED HOME', text: 'Have you arrived home?' },
  // ME present — first person is correct here.
  { gloss: 'ME ARRIVED', text: 'I have arrived.' },
  { gloss: 'ME GO HOME', text: "I'm going home." },
];

export function buildGlossUserPrompt(gloss: string[]): string {
  return `Glosses: ${gloss.join(' ')}`;
}

/**
 * gloss tokens → 2 or 3 DIFFERENT candidate sentences, for when the glosses are
 * genuinely ambiguous about WHO is signing. "ARRIVED HOME RIGHT LEFT" reads
 * one way if the signer is the customer asking the driver ("Have you
 * arrived home, right or left?") and a completely different way if the
 * signer IS the driver reporting to the customer ("I reached your home,
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
  'the call (not "The delivery has arrived home" — say "I have arrived" or',
  '"Have you arrived?" instead, depending on which person is meant).',
  'Rules for EVERY sentence:',
  '- Exactly one sentence each, at most one final period or question mark.',
  '- Only use "I"/"my"/"me" in a sentence if that sentence assumes the',
  '  signer is talking about themselves — never invent a first-person claim',
  '  the glosses do not support just to fill the sentence out.',
  '- OR only joins the two words immediately next to it, never the whole',
  '  sentence.',
  '- ARRIVED is a completed action ("arrived"/"reached"), never an ongoing',
  '  state ("is home").',
  '- Never invent street names, distances, numbers, or landmarks not in the',
  '  glosses.',
  'Return ONLY a JSON array of 2 or 3 strings, nothing else — no notes, no',
  'numbering, no explanation of which reading is which.',
].join(' ');

/** Real examples from testing: same glosses, deliberately different readings
 *  depending on who is assumed to be signing — exactly 2 options each,
 *  demonstrating that 2 solid readings beat a padded, invented 3rd (an
 *  earlier version of this example included a weak "The delivery has
 *  arrived home" third option; removed for exactly that reason). */
export const GLOSS_TO_TEXT_OPTIONS_FEWSHOT: Array<{ gloss: string; options: string[] }> = [
  {
    gloss: 'ARRIVED HOME RIGHT LEFT',
    options: [
      'Have you arrived home, right or left?',
      "I've reached your home — is it on the right or the left?",
    ],
  },
  {
    gloss: 'ARRIVED HOME',
    options: ['Have you arrived home?', "I've arrived home."],
  },
  {
    gloss: 'WHERE HOME',
    options: ['Where is your home?', 'Where am I delivering to?'],
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
