export type TextModel = 'gpt-6-astra' | 'gpt-6-sol';
export const TEXT_MODELS: readonly TextModel[];
export const DEFAULT_TEXT_MODEL: TextModel;
export function validateTextModel(value?: unknown): TextModel;
