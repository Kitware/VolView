import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8')
);
const dependencies = new Set([
  ...Object.keys(manifest.dependencies),
  ...Object.keys(manifest.peerDependencies),
]);
const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === '__tests__' ? [] : sourceFiles(file);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
      ? [file]
      : [];
  });

const importsOf = (file: string) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest
  );
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
};

for (const entry of ['core', 'vtk']) {
  describe(`DICOM ${entry} dependency boundary`, () => {
    const sources = sourceFiles(resolve(root, entry));
    it('has a public entry point', () => {
      expect(sources).toContain(resolve(root, entry, 'index.ts'));
    });
    it.each(sources.map((file) => relative(root, file)))(
      '%s stays inside its declared boundary',
      (name) => {
        for (const specifier of importsOf(resolve(root, name))) {
          if (specifier.startsWith('.')) {
            const target = relative(
              root,
              resolve(dirname(resolve(root, name)), specifier)
            );
            expect(target.startsWith('..')).toBe(false);
            if (entry === 'core') expect(target.startsWith('vtk/')).toBe(false);
          } else {
            const dependency = specifier.startsWith('@')
              ? specifier.split('/').slice(0, 2).join('/')
              : specifier.split('/')[0];
            expect(dependencies.has(dependency), specifier).toBe(true);
            expect(['vue', 'pinia', '@vueuse/core']).not.toContain(dependency);
            if (entry === 'core')
              expect(dependency).not.toBe('@kitware/vtk.js');
          }
        }
      }
    );
  });
}

it('VolView reaches the package only through its public entry points', () => {
  const repository = resolve(root, '../..');
  for (const file of sourceFiles(resolve(repository, 'src'))) {
    for (const specifier of importsOf(file)) {
      const target = specifier.startsWith('@/')
        ? resolve(repository, specifier.slice(2))
        : resolve(dirname(file), specifier);
      if (!target.startsWith(`${root}/`)) continue;
      expect(
        relative(root, target)
          .replace(/\.ts$/, '')
          .replace(/\/index$/, ''),
        relative(repository, file)
      ).toMatch(/^(core|vtk)$/);
    }
  }
});
