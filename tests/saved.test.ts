import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { loginDir, parseSaved, pick, storageValue, titleOf } from '../hooks/saved'

const HOME = '/home/me'
const ACCOUNTS = [
  { name: 'Home', configDir: '/home/me/.claude', emoji: '🏠' },
  { name: 'Work', configDir: '/home/me/.claude-work', emoji: '💼' },
  { name: 'Side', configDir: '/home/me/.claude-side' },
]
const LOGINS: Record<string, object> = {
  '': { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'me@gmail.com', orgId: 'org-home', orgName: "me@gmail.com's Organization", subscriptionType: 'max' },
  '/home/me/.claude-work': { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'me@acme.com', orgId: 'org-acme', orgName: 'Acme', subscriptionType: 'team' },
  '/home/me/.claude-side': { loggedIn: false, authMethod: 'none' },
}

// A session that started on the default folder. `claude auth status` answers for the login that
// CLAUDE_SECURESTORAGE_CONFIG_DIR names, in the call's env or else in the session's.
function fakeSession(on: On) {
  const seen = { env: { HOME } as Record<string, string>, toasts: [] as string[], opened: [] as string[] }
  on('env.get', (_$, e) => ({ value: seen.env[e.name] }))
  on('env.set', (_$, e) => {
    if (e.value === undefined) delete seen.env[e.name]
    else seen.env[e.name] = e.value
    return { value: {} }
  })
  on('process.run', (_$, e) => {
    const storage = e.init?.env?.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? seen.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? ''
    return { value: { exitCode: 0, stdout: JSON.stringify(LOGINS[storage]), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_$, e) => {
    if (e.path === '/home/me/.claude-accounts/accounts.json') return { value: JSON.stringify(ACCOUNTS) }
    if (e.path === '/home/me/.claude-work/.claude.json') return { value: JSON.stringify({ oauthAccount: { emailAddress: 'me@acme.com' } }) }
    if (e.path === '/home/me/.claude.json') return { value: JSON.stringify({ oauthAccount: { emailAddress: 'me@gmail.com' } }) }
    return { deny: 'no such file' }
  })
  on('session.cwd', () => ({ value: '/work/app' }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('command.register', () => ({ value: {} as never }))
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  return seen
}

const run = ($: Engine, args: string) => $.command.run({ command: 'account', args } as never)

test('reads the list and names accounts', () => {
  expect(parseSaved(JSON.stringify(ACCOUNTS)).length).toBe(3)
  expect(parseSaved('not json')).toEqual([])
  expect(parseSaved('[{"name":1}]')).toEqual([])
  expect(titleOf(ACCOUNTS[0]!)).toBe('🏠 Home')
  expect(titleOf(ACCOUNTS[2]!)).toBe('Side')
  expect(pick(ACCOUNTS, '2')?.name).toBe('Work')
  expect(pick(ACCOUNTS, 'work')?.name).toBe('Work')
  expect(pick(ACCOUNTS, 'si')?.name).toBe('Side')
  expect(pick(ACCOUNTS, '9')).toBe(undefined)
})

test('the login folder follows the switch, then the start folder', () => {
  expect(storageValue('/home/me/.claude', HOME)).toBe('')
  expect(storageValue('/home/me/.claude-work', HOME)).toBe('/home/me/.claude-work')
  expect(loginDir({ home: HOME })).toBe('/home/me/.claude')
  expect(loginDir({ config: '/home/me/.claude-work', home: HOME })).toBe('/home/me/.claude-work')
  expect(loginDir({ storage: '', config: '/home/me/.claude-work', home: HOME })).toBe('/home/me/.claude')
  expect(loginDir({ storage: '/home/me/.claude-side', home: HOME })).toBe('/home/me/.claude-side')
})

test('/account work switches the session login and the footer', async ($, on) => {
  const seen = fakeSession(on)
  mock.store(on)
  const footer = async (text: string) => {
    const ui = await $.ui.mount({ plugin: 'whoami', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
    expect(await ui.find({ type: 'Text', text })).toBeTruthy()
    await ui.unmount()
  }
  await $.command.run({ command: 'whoami', args: '' } as never)
  await footer('🏠 Home · me@gmail.com')

  expect((await run($, 'work')).text).toBe('This session now uses 💼 Work (me@acme.com). Claude Code reads the new login within 30 seconds.')
  expect(seen.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe('/home/me/.claude-work')
  await footer('💼 Work · me@acme.com')

  expect((await run($, 'work')).text).toBe('This session already uses 💼 Work.')
  expect((await run($, '1')).text).toBe('This session now uses 🏠 Home (me@gmail.com). Claude Code reads the new login within 30 seconds.')
  expect(seen.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe('')
})

test('an account with no login is refused, and the session keeps its own', async ($, on) => {
  const seen = fakeSession(on)
  mock.store(on)
  expect((await run($, 'side')).text).toBe('Side has no login yet. Log in to it from the Claude Accounts menu bar app first.')
  expect(seen.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(undefined)
  expect((await run($, 'nope')).text).toBe('No account "nope". 1 🏠 Home, 2 💼 Work, 3 Side.')
})

test('/account opens a picker, and a pick switches and closes it', async ($, on) => {
  const seen = fakeSession(on)
  mock.store(on)
  expect((await run($, '')).text).toBe(undefined)
  expect(seen.opened).toEqual(['account'])
  const pane = await $.ui.mount({ plugin: 'whoami', surface: 'terminal', component: 'Pane', requestId: 'account', props: {} as never })
  expect(await pane.find({ type: 'Select', key: 'account' })).toBeTruthy()
  await pane.select({ key: 'account', value: '/home/me/.claude-work' })
  expect(seen.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe('/home/me/.claude-work')
  expect(seen.toasts).toEqual(['This session now uses 💼 Work (me@acme.com). Claude Code reads the new login within 30 seconds.'])
  await pane.unmount()
})
