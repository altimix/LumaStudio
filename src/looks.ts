import type { Clip } from './types';

export const looks: { name: string; description: string; color: string; patch: Partial<Clip> }[] = [
  { name: 'オリジナル', description: 'ニュートラル', color: 'linear-gradient(140deg,#6b949a,#a1987e)', patch: { exposure: 0, contrast: 1, saturation: 1 } },
  { name: 'シネマ', description: '深い陰影、映画のように', color: 'linear-gradient(140deg,#3f7177,#d9aa73)', patch: { exposure: -0.12, contrast: 1.2, saturation: 0.78 } },
  { name: 'ビビッド', description: '鮮やかな色彩', color: 'linear-gradient(140deg,#3ec0ac,#f4c876)', patch: { exposure: 0.1, contrast: 1.12, saturation: 1.4 } },
  { name: 'ソフトフィルム', description: 'やわらかなフィルム調', color: 'linear-gradient(140deg,#a2a9ad,#d2b6a2)', patch: { exposure: 0.18, contrast: 0.85, saturation: 0.78 } },
  { name: 'モノクロ', description: 'モノクローム', color: 'linear-gradient(140deg,#252930,#b2b6bb)', patch: { exposure: 0, contrast: 1.25, saturation: 0 } },
  { name: 'ミュート', description: '静かな、落ち着いた色', color: 'linear-gradient(140deg,#667a7a,#a7a591)', patch: { exposure: -0.05, contrast: 0.95, saturation: 0.55 } }
];
