'use strict'

const { execFileSync } = require('child_process')

function sanitizedGitEnvironment(overrides = {}) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
  )
  return { ...environment, ...overrides }
}

function runFixtureGit(directory, args, options = {}) {
  const { env = {}, ...executionOptions } = options
  return execFileSync('git', args, {
    cwd: directory,
    ...executionOptions,
    env: sanitizedGitEnvironment(env),
  })
}

function initializeFixtureRepository(directory) {
  runFixtureGit(directory, ['init'], { stdio: 'ignore' })
}

function addGitlink(directory, submodulePath) {
  const tree = String(
    runFixtureGit(directory, ['mktree'], {
      encoding: 'utf8',
      input: '',
    })
  ).trim()
  const commit = String(
    runFixtureGit(directory, ['commit-tree', tree, '-m', 'fixture'], {
      encoding: 'utf8',
      env: {
        GIT_AUTHOR_NAME: 'QA Test',
        GIT_AUTHOR_EMAIL: 'qa@example.com',
        GIT_COMMITTER_NAME: 'QA Test',
        GIT_COMMITTER_EMAIL: 'qa@example.com',
      },
    })
  ).trim()
  runFixtureGit(directory, [
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${commit},${submodulePath}`,
  ])
}

module.exports = {
  addGitlink,
  initializeFixtureRepository,
  runFixtureGit,
  sanitizedGitEnvironment,
}
