const { number } = require('./audio-render.cjs');

// Blur the entire source so the selected edge samples its original neighbours.
// Blend only an even-aligned rectangle, then stack the untouched strips. YUV420
// chroma has half-size coordinates, so each plane needs its own selection bounds.
function gaussianRegionFilters(clip, index, sigma, width, height, opaque = false) {
  const blur = clip.gaussianBlur;
  if (!opaque || !blur || width < 128 || height < 128 || width % 2 || height % 2) return null;
  const n = value => Number(value.toFixed(8));
  const x0 = n(blur.x - blur.width / 2), x1 = n(blur.x + blur.width / 2);
  const y0 = n(blur.y - blur.height / 2), y1 = n(blur.y + blur.height / 2);
  const left = Math.ceil(width * x0), right = Math.ceil(width * x1);
  const top = Math.ceil(height * y0), bottom = Math.ceil(height * y1);
  const outerLeft = Math.floor(left / 2) * 2, outerRight = Math.ceil(right / 2) * 2;
  const outerTop = Math.floor(top / 2) * 2, outerBottom = Math.ceil(bottom / 2) * 2;
  if (outerLeft < 8 || outerTop < 8 || outerRight > width - 8 || outerBottom > height - 8 ||
      right - left < 2 || bottom - top < 2) return null;
  const tag = name => `${name}${index}`, label = name => `[${tag(name)}]`;
  const expr = (l, r, t, b) => `if(gte(X,${l})*lt(X,${r})*gte(Y,${t})*lt(Y,${b}),B,A)`;
  const luma = expr(left - outerLeft, right - outerLeft, top - outerTop, bottom - outerTop);
  const chroma = expr(
    Math.ceil(width / 2 * x0) - outerLeft / 2,
    Math.ceil(width / 2 * x1) - outerLeft / 2,
    Math.ceil(height / 2 * y0) - outerTop / 2,
    Math.ceil(height / 2 * y1) - outerTop / 2,
  );
  const selection = `blend=c0_expr='${luma}':c1_expr='${chroma}':c2_expr='${chroma}':c3_expr='${luma}'`;
  const roiWidth = outerRight - outerLeft, roiHeight = outerBottom - outerTop;
  const crop = (w, h, x, y) => `crop=w=${w}:h=${h}:x=${x}:y=${y}:exact=1`;
  return [
    `[preblur${index}]format=yuva420p${label('planeinput')}`,
    `${label('planeinput')}split=6${['topinput', 'leftinput', 'rightinput', 'bottominput', 'roiinput', 'blurinput'].map(label).join('')}`,
    `${label('topinput')}${crop(width, outerTop, 0, 0)}${label('top')}`,
    `${label('leftinput')}${crop(outerLeft, roiHeight, 0, outerTop)}${label('left')}`,
    `${label('rightinput')}${crop(width - outerRight, roiHeight, outerRight, outerTop)}${label('right')}`,
    `${label('bottominput')}${crop(width, height - outerBottom, 0, outerBottom)}${label('bottom')}`,
    `${label('roiinput')}${crop(roiWidth, roiHeight, outerLeft, outerTop)}${label('originalroi')}`,
    `${label('blurinput')}gblur=sigma=${number(sigma)},${crop(roiWidth, roiHeight, outerLeft, outerTop)}${label('blurredroi')}`,
    `${label('originalroi')}${label('blurredroi')}${selection}${label('roi')}`,
    `${label('left')}${label('roi')}${label('right')}hstack=inputs=3${label('middle')}`,
    `${label('top')}${label('middle')}${label('bottom')}vstack=inputs=3[postblur${index}]`,
  ];
}

module.exports = { gaussianRegionFilters };
