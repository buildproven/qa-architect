#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const prettier = require('prettier')
const {
  loadRuleCatalog,
  renderRuleCatalogMarkdown,
} = require('../lib/assurance/rule-catalog')

const projectRoot = path.resolve(__dirname, '..')
const outputPath = path.join(projectRoot, 'docs', 'ASSURANCE-RULE-CATALOG.md')
async function main() {
  const rendered = renderRuleCatalogMarkdown(loadRuleCatalog(projectRoot))
  const output = await prettier.format(rendered, {
    filepath: outputPath,
  })

  if (process.argv.includes('--check')) {
    const current = fs.existsSync(outputPath)
      ? fs.readFileSync(outputPath, 'utf8')
      : ''
    if (current !== output) {
      console.error(
        'Assurance rule catalog is stale. Run `npm run generate:assurance-catalog`.'
      )
      process.exitCode = 1
    }
  } else {
    fs.writeFileSync(outputPath, output, 'utf8')
    console.log(`Generated ${path.relative(projectRoot, outputPath)}`)
  }
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
