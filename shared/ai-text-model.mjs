export const TEXT_MODELS = Object.freeze(['gpt-6-astra', 'gpt-6-sol']);
export const DEFAULT_TEXT_MODEL = TEXT_MODELS[0];

export function validateTextModel(value = DEFAULT_TEXT_MODEL) {
  if (!TEXT_MODELS.includes(value)) throw new Error('投稿文モデルを選び直してください。');
  return value;
}
