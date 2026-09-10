export function validateTreatment(value) {
  if (value !== undefined && value !== 'speech' && value !== 'normalize') throw new Error('音声の自動調整設定が不正です。');
}
