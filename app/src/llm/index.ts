export * from './LlmProvider';
export * from './features';
export * from './prompts';
// LocalLlmProvider.ts is deliberately NOT re-exported here — it imports
// llama.rn (a native module), same reason useLiveHandGestures.ts is kept
// out of recognition/index.ts's barrel. Import it directly where needed
// so the Jest environment (and anything else importing from './llm')
// never has to resolve a native module that may not be installed/built.
