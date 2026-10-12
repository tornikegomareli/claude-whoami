import type { On } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import { accountOf } from '../hooks/account'

const ACME = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'me@acme.com', orgId: 'org-acme', orgName: 'Acme' }
const HOME = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'me@gmail.com', orgId: 'org-home', orgName: "me@gmail.com's Organization" }

// A fake `claude auth status --json`.
function fakeSession(on: On, status: object) {
  const seen = { auth: status }
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(seen.auth), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('command.register', () => ({ value: {} as never }))
  return seen
}

test('labels each login method', () => {
  expect(accountOf(ACME)).toEqual({ id: 'org-acme', label: 'Acme · me@acme.com' })
  expect(accountOf(HOME)).toEqual({ id: 'org-home', label: 'Personal · me@gmail.com' })
  expect(accountOf({ loggedIn: true, authMethod: 'api_key', apiKeySource: 'ANTHROPIC_API_KEY' })).toEqual({ id: 'api-key', label: 'API key from ANTHROPIC_API_KEY' })
  expect(accountOf({ loggedIn: false, authMethod: 'none' })).toEqual({ id: 'none', label: 'not signed in' })
})

test('the footer shows the account beside the other modes', async ($, on) => {
  fakeSession(on, ACME)
  expect((await $.command.run({ command: 'whoami', args: '' } as never)).text).toBe('Signed in: Acme · me@acme.com.')
  const ui = await $.ui.mount({ plugin: 'whoami', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
  expect(await ui.find({ type: 'Text', text: 'focus & Acme · me@acme.com' })).toBeTruthy()
  await ui.unmount()
})
