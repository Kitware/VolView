import ts from 'typescript';
import { mergeConfig, type Plugin } from 'vite';
import base from './vite.config';

// Build with `vite build --config vite.brush-profile.config.ts`,
// then set BRUSH_BENCH_DIST=.tmp/brush-profile-dist for brush.conf.ts.
// Measurements are inclusive: nested function durations must not be summed.
const targets: Record<string, string[]> = {
  '/src/store/tools/paint.ts': ['doPaintStroke', 'endStroke'],
  '/src/core/tools/paint/index.ts': ['paintLabelmap'],
  '/src/segmentation/rendering/renderMask.ts': ['segmentRenderMask'],
  '/src/segmentation/geometry.ts': ['reframeMaskScalars'],
  '/src/segmentation/masks/storage.ts': ['regrowMask'],
  '/src/segmentation/measurements/maskSnapshot.ts': ['take'],
  '/src/enface/thickness.ts': ['createThinRegionMask'],
  '/src/core/vtk/useVtkView.ts': ['deferredRender'],
  '/Rendering/OpenGL/ImageMapper.js': ['buildBufferObjects'],
  '/Rendering/OpenGL/ImageResliceMapper.js': ['buildBufferObjects'],
};

function functionName(node: ts.FunctionLikeDeclaration) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  let parent = node.parent;
  if (ts.isCallExpression(parent)) parent = parent.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
    return parent.name.text;
  if (
    ts.isBinaryExpression(parent) &&
    ts.isPropertyAccessExpression(parent.left)
  )
    return parent.left.name.text;
  return '';
}

const measurements: Plugin = {
  name: 'brush-performance-measurements',
  enforce: 'pre',
  transform(code, id) {
    const entry = Object.entries(targets).find(([suffix]) =>
      id.endsWith(suffix)
    );
    if (!entry) return;
    const [suffix, names] = entry;
    const tree = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
    const edits: { at: number; text: string }[] = [];
    const visit = (node: ts.Node) => {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isArrowFunction(node) ||
          ts.isFunctionExpression(node)) &&
        node.body &&
        ts.isBlock(node.body)
      ) {
        const name = functionName(node);
        if (names.includes(name)) {
          const label = JSON.stringify(`paint-prof:${suffix}:${name}`);
          const detail =
            name === 'deferredRender'
              ? ", detail: renderWindowView.getCanvas()?.getAttribute('data-testid') || 'slice'"
              : '';
          edits.push({
            at: node.body.getStart(tree) + 1,
            text: '\nconst brushProfileStart = performance.now(); try {\n',
          });
          edits.push({
            at: node.body.getEnd() - 1,
            text: `\n} finally { performance.measure(${label}, { start: brushProfileStart${detail} }); }\n`,
          });
        }
      }
      if (suffix.endsWith('maskSnapshot.ts')) {
        const copy =
          ts.isNewExpression(node) &&
          node.getText(tree) === 'new Uint8Array(mask.values)';
        const patch =
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'reframeMaskScalars';
        if (copy || patch) {
          const label = `paint-prof:worker-mask-${copy ? 'copy' : 'patch'}`;
          edits.push({
            at: node.getStart(tree),
            text: '(() => { const start = performance.now(); const result = ',
          });
          edits.push({
            at: node.getEnd(),
            text: `; performance.measure('${label}', { start, detail: result.byteLength }); return result; })()`,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const edit of edits.sort((a, b) => b.at - a.at))
      code = code.slice(0, edit.at) + edit.text + code.slice(edit.at);
    return { code, map: null };
  },
};

export default mergeConfig(base, {
  build: { outDir: '.tmp/brush-profile-dist' },
  plugins: [measurements],
});
