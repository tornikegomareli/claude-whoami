import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { accountOf, pinFor, planOf, usageOf } from '../hooks/account'

const ACME = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'me@acme.com', orgId: 'org-acme', orgName: 'Acme', subscriptionType: 'max' }
const HOME = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'me@gmail.com', orgId: 'org-home', orgName: "me@gmail.com's Organization" }
const TYPED = { kind: 'composer' } as never

// A fake `claude auth status --json`, a session in /work/app, and every submitted prompt recorded.
function fakeSession(on: On, status: object) {
  const seen = { submitted: [] as string[], auth: status }
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(seen.auth), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('command.register', () => ({ value: {} as never }))
  on('prompt.submit', (_$, e) => {
    seen.submitted.push(e.text)
    return { text: e.text }
  })
  return seen
}

const submit = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: TYPED })

test('labels each login method', () => {
  expect(accountOf(ACME)).toEqual({ id: 'org-acme', label: 'Acme · me@acme.com' })
  expect(accountOf(HOME)).toEqual({ id: 'org-home', label: 'Personal · me@gmail.com' })
  expect(accountOf({ loggedIn: true, authMethod: 'api_key', apiKeySource: 'ANTHROPIC_API_KEY' })).toEqual({ id: 'api-key', label: 'API key from ANTHROPIC_API_KEY' })
  expect(accountOf({ loggedIn: false, authMethod: 'none' })).toEqual({ id: 'none', label: 'not signed in' })
})

test('a pin covers its folder and subfolders only', () => {
  const pins = { '/work': { id: 'org-acme', label: 'Acme' } }
  expect(pinFor(pins, '/work/app/src')?.dir).toBe('/work')
  expect(pinFor(pins, '/work')?.dir).toBe('/work')
  expect(pinFor(pins, '/workshop')).toBe(undefined)
})

// Local times, so the expected text does not depend on the test machine's time zone.
const AT_18_30 = new Date(2026, 9, 12, 18, 30).toISOString()
const FRIDAY = new Date(2026, 9, 16, 9, 0).toISOString()

test('names the plan with its size', () => {
  expect(planOf('max', 'default_claude_max_20x')).toBe('Max 20x')
  expect(planOf('pro', undefined)).toBe('Pro')
  expect(planOf(undefined, 'default_claude_max_5x')).toBe('')
})

const DEFAULT = { fiveHour: true, weekly: 'over-half' } as const
const FIVE = { kind: 'five_hour', percentUsed: 42.4, resetsAt: AT_18_30 }
const WEEK = { kind: 'seven_day', percentUsed: 30, resetsAt: FRIDAY }

test('by default shows the 5-hour window, and the 7-day one once half used', () => {
  expect(usageOf([FIVE, WEEK], DEFAULT)).toEqual({ text: '5h 42%, resets 18:30', used: 42.4 })
  expect(usageOf([{ kind: 'five_hour', percentUsed: 7 }, { ...WEEK, percentUsed: 63 }], DEFAULT)).toEqual({ text: '5h 7% · 7d 63%, resets Fri', used: 63 })
  expect(usageOf([], DEFAULT)).toEqual({ text: '', used: 0 })
})

test('the footer shows the account, plan and usage beside the other modes', async ($, on) => {
  fakeSession(on, ACME)
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('fs.read', (_$, e) => ({ value: e.path === '/home/me/.claude.json' ? JSON.stringify({ oauthAccount: { organizationRateLimitTier: 'default_claude_max_20x' } }) : '' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  expect((await $.command.run({ command: 'whoami', args: '' } as never)).text).toBe('Signed in: Acme · me@acme.com.')
  await $.session.measure({ context: {} as never, rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: AT_18_30 }], changed: ['rateLimits'] })
  const ui = await $.ui.mount({ plugin: 'whoami', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
  expect(await ui.find({ type: 'Text', text: 'focus & Acme · me@acme.com · Max 20x · 5h 42%, resets 18:30' })).toBeTruthy()
  await ui.unmount()
})

test('the footer shows usage the session had before the mod loaded', async ($, on) => {
  fakeSession(on, ACME)
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: {} as never, rateLimits: [{ kind: 'five_hour', percentUsed: 34, resetsAt: AT_18_30 }] } }))
  await $.command.run({ command: 'whoami', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'whoami', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await ui.find({ type: 'Text', text: 'Acme · me@acme.com · 5h 34%, resets 18:30' })).toBeTruthy()
  await ui.unmount()
})

test('a prompt in a folder pinned to another account is held until /whoami ok', async ($, on) => {
  const seen = fakeSession(on, HOME)
  mock.store(on, { pins: { '/work': { id: 'org-acme', label: 'Acme · me@acme.com' } } })
  await $.command.run({ command: 'whoami', args: '' } as never)
  const band = await $.ui.mount({ plugin: 'whoami', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20 } as never })
  expect(await band.find({ type: 'Text', text: '/work expects: Acme · me@acme.com' })).toBeTruthy()
  await band.unmount()

  const held = await submit($, 'fix the bug')
  expect(held.drop).toBe('Signed in to Personal · me@gmail.com, but this folder expects Acme · me@acme.com. Run /login to switch, or /whoami ok to continue.')
  expect(seen.submitted).toEqual([])

  await $.command.run({ command: 'whoami', args: 'ok' } as never)
  await submit($, 'fix the bug')
  expect(seen.submitted).toEqual(['fix the bug'])
})

test('after /login to the pinned account the prompt goes through', async ($, on) => {
  const seen = fakeSession(on, HOME)
  mock.store(on, { pins: { '/work': { id: 'org-acme', label: 'Acme · me@acme.com' } } })
  await $.command.run({ command: 'whoami', args: '' } as never)
  seen.auth = ACME
  await submit($, 'fix the bug')
  expect(seen.submitted).toEqual(['fix the bug'])
})

test('/whoami pin and unpin', async ($, on) => {
  fakeSession(on, ACME)
  mock.store(on)
  expect((await $.command.run({ command: 'whoami', args: 'pin' } as never)).text).toBe('Pinned Acme · me@acme.com to /work/app and its subfolders.')
  expect((await $.command.run({ command: 'whoami', args: '' } as never)).text).toBe('Signed in: Acme · me@acme.com.\n/work/app expects Acme · me@acme.com.')
  expect((await $.command.run({ command: 'whoami', args: 'unpin' } as never)).text).toBe('Removed the pin of /work/app.')
  expect((await $.command.run({ command: 'whoami', args: '' } as never)).text).toBe('Signed in: Acme · me@acme.com.')
})
