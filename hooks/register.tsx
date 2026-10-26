import type { EngineInterface, Register } from 'claude-code'
import { UNKNOWN, accountOf, nameAndEmail, orgOf, parseStatus, pinFor, planOf, usageOf } from './account'
import type { Account, Limit, Pins, Show } from './account'
import { configFile, loginDir, parseSaved, pick, storageValue, titleOf } from './saved'
import type { Saved } from './saved'

const USAGE = '/whoami shows the account. /whoami pin expects it in this folder, /whoami unpin stops that, /whoami ok continues on a wrong one.'

let account: Account = UNKNOWN
let plan = '' // "Max 20x"
let limits: readonly Limit[] = []
let show: Show = { fiveHour: true, weekly: 'over-half', email: 'full' }
let pin: { dir: string; account: Account } | undefined
let isAllowed = false // `/whoami ok` was run in this session
let home = ''
let dir = '' // the folder whose login the session uses
let email = ''
let org: string | undefined
let saved: readonly Saved[] = [] // the accounts of the Claude Accounts menu bar app
let emails: Record<string, string> = {} // folder to the email of its login, for the picker

const PICKER = 'account'
const ACCOUNT_USAGE = '/account opens a picker. /account <name or number> switches this session to that account.'

const isWrong = () => !!pin && pin.account.id !== account.id && !isAllowed

// The global config file of a folder holds the login's email and the plan's size ("20x").
async function oauthAccount($: EngineInterface, folder: string) {
  const text = await $.fs.read(configFile(folder, home)).catch(() => '')
  try {
    return (JSON.parse(text) as { oauthAccount?: { organizationRateLimitTier?: string; emailAddress?: string } }).oauthAccount
  } catch {
    return undefined
  }
}

async function readSaved($: EngineInterface) {
  home = (await $.env.get('HOME')) ?? ''
  dir = loginDir({ storage: await $.env.get('CLAUDE_SECURESTORAGE_CONFIG_DIR'), config: await $.env.get('CLAUDE_CONFIG_DIR'), home })
  saved = parseSaved(await $.fs.read(`${home}/.claude-accounts/accounts.json`).catch(() => ''))
}

async function pins($: EngineInterface) {
  return ((await $.store.get('pins')) ?? {}) as Pins
}

// Reads the account and this folder's pin, then redraws the footer label and the band.
async function check($: EngineInterface) {
  // `claude auth status` reports ANTHROPIC_API_KEY even when the session declined it and uses the login.
  const usesLogin = (await $.session.authorize().catch(() => null))?.kind === 'bearer'
  const env = usesLogin ? { ANTHROPIC_API_KEY: '' } : undefined
  const r = await $.process.run(['claude', 'auth', 'status', '--json'], { env, timeoutMs: 10000 }).catch(() => undefined)
  const status = r && parseStatus(r.stdout)
  account = status ? accountOf(status) : UNKNOWN
  email = status?.email ?? ''
  org = status && orgOf(status)
  await readSaved($).catch(() => {}) // without the list the footer shows the organization
  plan = usesLogin ? planOf(status?.subscriptionType, (await oauthAccount($, dir))?.organizationRateLimitTier) : ''
  pin = pinFor(await pins($), await $.session.cwd())
  // Figures the session had before this mod loaded never raise a `session.measure` of their own.
  limits = (await $.session.usage().catch(() => undefined))?.rateLimits ?? limits
  $.ui.invalidate('ui.render')
}

async function command($: EngineInterface, arg: string) {
  await check($)
  const cwd = await $.session.cwd()
  const all = await pins($)
  if (arg === 'pin') {
    await $.store.set('pins', { ...all, [cwd]: account })
    await check($)
    return `Pinned ${account.label} to ${cwd} and its subfolders.`
  }
  if (arg === 'unpin') {
    if (!pin) return 'No pin covers this folder.'
    const { [pin.dir]: _, ...rest } = all
    const dir = pin.dir
    await $.store.set('pins', rest)
    await check($)
    return `Removed the pin of ${dir}.`
  }
  if (arg === 'ok') {
    isAllowed = true
    await check($)
    return `Continuing on ${account.label} for this session.`
  }
  if (arg) return USAGE
  const expected = pin ? `\n${pin.dir} expects ${pin.account.label}.` : ''
  return `Signed in: ${account.label}.${expected}`
}

// Points the session at the login of another account. Claude Code reads it on its next login read,
// within 30 seconds; a login with no Keychain item is refused first, so the session never loses its own.
async function switchTo($: EngineInterface, target: Saved) {
  await readSaved($)
  if (target.configDir === dir) return `This session already uses ${titleOf(target)}.`
  const value = storageValue(target.configDir, home)
  const r = await $.process.run(['claude', 'auth', 'status', '--json'], { env: { CLAUDE_SECURESTORAGE_CONFIG_DIR: value, ANTHROPIC_API_KEY: '' }, timeoutMs: 10000 }).catch(() => undefined)
  const status = r && parseStatus(r.stdout)
  if (!status?.loggedIn) return `${titleOf(target)} has no login yet. Log in to it from the Claude Accounts menu bar app first.`
  const set = await $.env.set('CLAUDE_SECURESTORAGE_CONFIG_DIR', value)
  if (set.deny) return `Could not switch to ${titleOf(target)}: ${set.deny}`
  await check($)
  return `This session now uses ${titleOf(target)} (${status.email ?? 'no email'}). Claude Code reads the new login within 30 seconds.`
}

async function accountCommand($: EngineInterface, arg: string) {
  await readSaved($)
  if (!saved.length) return 'No accounts yet. Add them in the Claude Accounts menu bar app.'
  if (!arg) {
    emails = {}
    for (const a of saved) emails[a.configDir] = (await oauthAccount($, a.configDir))?.emailAddress ?? ''
    await $.ui.open({ id: PICKER, title: 'Switch account', focus: true, closeOnEscape: true, rows: saved.length + 2 })
    return undefined
  }
  const target = pick(saved, arg)
  if (!target) return `No account "${arg}". ${saved.map((a, i) => `${i + 1} ${titleOf(a)}`).join(', ')}.`
  return switchTo($, target)
}

export const register: Register = (on, options) => {
  show = {
    fiveHour: options.fiveHourLimit !== false,
    weekly: options.weeklyLimit === 'always' || options.weeklyLimit === 'never' ? options.weeklyLimit : 'over-half',
    email: options.email === 'name' || options.email === 'hidden' ? options.email : 'full',
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'whoami', description: `Which Claude account this session uses. ${USAGE}` }).catch(() => {})
    await $.command.register({ name: 'account', description: `Switch this session to another Claude account. ${ACCOUNT_USAGE}` }).catch(() => {})
    void check($).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'whoami' }, async ($, e) => ({ text: await command($, e.args.trim()) }))

  on('command.run', { command: 'account' }, async ($, e) => ({ text: await accountCommand($, e.args.trim()) }))

  // The picker `/account` opens: arrows move, Enter switches, Esc closes.
  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e, next) => {
    const elements = $.ui.resolve(e)
    if (!('Select' in elements)) return next(e)
    const { Box, Select, Text } = elements
    const options = saved.map(a => ({
      value: a.configDir,
      label: [titleOf(a), emails[a.configDir] || 'no login', a.configDir === dir ? 'this session' : ''].filter(Boolean).join(' · '),
    }))
    return (
      <Box flexDirection="column">
        <Select
          key="account"
          options={options}
          value={dir}
          autoFocus
          onSelect={async value => {
            const target = saved.find(a => a.configDir === value)
            const text = target ? await switchTo($, target) : 'That account is gone from the list.'
            await $.ui.close({ id: PICKER })
            $.ui.toast(text, { timeoutMs: 8000 })
          }}
        />
        <Text dimColor>Enter switches this session. Esc closes.</Text>
      </Box>
    )
  })

  // A prompt typed in a folder pinned to another account is dropped; the engine puts it back in the box.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' || e.text.trimStart().startsWith('/')) return next(e)
    if (isWrong()) await check($) // after /login the account may be right now
    if (!isWrong()) {
      void check($).catch(() => {})
      return next(e)
    }
    return { drop: `Signed in to ${account.label}, but this folder expects ${pin?.account.label}. Run /login to switch, or /whoami ok to continue.` }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      limits = e.rateLimits
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // The footer's mode labels (`focus`), redrawn on the left with the account, plan and usage after them.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const elements = $.ui.resolve(e)
    if (account === UNKNOWN || !('Box' in elements)) return next(e)
    const { Box, Text } = elements
    const usage = usageOf(limits, show)
    const mine = saved.find(a => a.configDir === dir)
    const parts = [
      { text: email ? nameAndEmail(mine ? titleOf(mine) : org, email, show.email) : account.label, color: 'suggestion' },
      { text: plan, color: 'claude' },
      { text: usage.text, color: usage.used >= 80 ? 'error' : usage.used >= 50 ? 'warning' : 'success' },
    ].filter(p => p.text)
    return (
      <Box width="100%" justifyContent="flex-start">
        <Text>
          {e.props.modes.length ? <Text dimColor>{e.props.modes.join(' & ')} & </Text> : null}
          {parts.map((p, i) => <Text key={p.color}>{i ? <Text dimColor> · </Text> : null}<Text color={p.color}>{p.text}</Text></Text>)}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isWrong() || e.props.hasSurvey) return next(e)
    const elements = $.ui.resolve(e)
    if (!('Box' in elements)) return next(e)
    const { Box, Text } = elements
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
        <Text color="error" bold>Wrong Claude account for this folder</Text>
        <Text>Signed in: {account.label}</Text>
        <Text>{pin?.dir} expects: {pin?.account.label}</Text>
        <Text dimColor>Run /login to switch, or /whoami ok to continue on this account.</Text>
      </Box>
    )
  })
}
