import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(root, '../..');
const tsFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) return tsFiles(file);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
      ? [file]
      : [];
  });
const isTest = (file: string) => file.includes('/__tests__/');
const sourceFiles = (directory: string) =>
  tsFiles(directory).filter((file) => !isTest(file));
const testFiles = (directory: string) => tsFiles(directory).filter(isTest);

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

const entryPoints = new Set(['core', 'core/index', 'vtk', 'vtk/index']);

// ESLint matches import specifiers, so relative paths that leave the module,
// reach vtk from core or come back through an entry point are checked against
// resolved locations here.
for (const entry of ['core', 'vtk']) {
  describe(`DICOM ${entry} relative imports`, () => {
    const sources = sourceFiles(resolve(root, entry));
    it.each(sources.map((file) => relative(root, file)))(
      '%s stays inside its boundary',
      (name) => {
        for (const specifier of importsOf(resolve(root, name))) {
          if (!specifier.startsWith('.')) continue;
          const target = relative(
            root,
            resolve(dirname(resolve(root, name)), specifier)
          );
          expect(target.startsWith('..'), specifier).toBe(false);
          expect(entryPoints.has(target), specifier).toBe(false);
          if (entry === 'core')
            expect(target.startsWith('vtk/'), specifier).toBe(false);
        }
      }
    );
  });
}

/** The file a specifier names, or undefined for a package import. */
const resolveImport = (from: string, specifier: string) => {
  const base = specifier.startsWith('@/')
    ? resolve(repository, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : undefined;
  if (!base) return undefined;
  return [base, `${base}.ts`, resolve(base, 'index.ts')].find(
    (file) => existsSync(file) && file.endsWith('.ts')
  );
};

/** Files a test reaches through module and shared test fixture imports. */
const reachedFrom = (file: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(file)) return seen;
  seen.add(file);
  importsOf(file)
    .map((specifier) => resolveImport(file, specifier))
    .filter((target): target is string => !!target)
    .forEach((target) => reachedFrom(target, seen));
  return seen;
};

describe('DICOM module tests', () => {
  it.each(testFiles(root).map((file) => relative(root, file)))(
    '%s reaches no VolView application code',
    (name) => {
      const reached = [...reachedFrom(resolve(root, name))].flatMap((file) =>
        importsOf(file)
          .filter(
            (specifier) =>
              relative(
                repository,
                resolveImport(file, specifier) ?? ''
              ).startsWith('src/') || specifier.startsWith('@/src/')
          )
          .map((specifier) => `${relative(repository, file)}: ${specifier}`)
      );
      expect(reached).toEqual([]);
    }
  );
});
