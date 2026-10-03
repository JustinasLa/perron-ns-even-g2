import { defineConfig, mergeConfig } from 'vitest/config'
import MagicString from 'magic-string'
import ts from 'typescript'
import viteConfig from './vite.config'

export default mergeConfig(viteConfig, defineConfig({
  plugins: [{
    name: 'test-entrypoint-access',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('/src/main.ts')) return
      const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true)
      const functions: string[] = []
      const properties: string[] = []
      for (const statement of source.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name) {
          functions.push(statement.name.text)
        }
        if (!ts.isVariableStatement(statement)) continue
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) continue
          const name = declaration.name.text
          properties.push(`get ${name}() { return ${name} }`)
          if (!(statement.declarationList.flags & ts.NodeFlags.Const)) {
            properties.push(`set ${name}(value) { ${name} = value }`)
          }
        }
      }
      const output = new MagicString(code)
      output.append(`\nexport const testApp = { ${functions.join(',')}, state: { ${properties.join(',')} } }\n`)
      return { code: output.toString(), map: output.generateMap({ hires: true, source: id }) }
    },
  }],
  test: {
    projects: [
      { extends: true, test: { name: 'ui', environment: 'jsdom', include: ['src/main.test.ts'] } },
      { extends: true, test: { name: 'services', environment: 'node', include: ['src/**/*.test.ts', 'proxy/**/*.test.js'], exclude: ['src/main.test.ts'] } },
    ],
    coverage: {
      provider: 'v8',
      experimentalAstAwareRemapping: true,
      include: ['src/**/*.ts', 'proxy/worker.js'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'html', 'json', 'json-summary'],
      reportOnFailure: true,
      thresholds: { perFile: true, statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
}))
