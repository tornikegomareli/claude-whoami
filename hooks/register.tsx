import type { EngineInterface, Register } from 'claude-code'
import { UNKNOWN, accountOf, parseStatus, pinFor, planOf, usageOf } from './account'
import type { Account, Limit, Pins, Show } from './account'

const USAGE = '/whoami shows the account. /whoami pin expects it in this folder, /whoami unpin stops that, /whoami ok continues on a wrong one.'

let account: Account = UNKNOWN
let plan = '' // "Max 20x"
let limits: readonly Limit[] = []
let show: Show = { fiveHour: true, weekly: 'over-half' }
let pin: { dir: string; account: Account } | undefined
let isAllowed = false // `/whoami ok` was run in this session

const isWrong = () => !!pin && pin.account.id !== account.id && !isAllowed

// The plan's size ("20x") is only in the global config file, beside the login.
async function rateLimitTier($: EngineInterface) {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (await $.env.get('HOME'))
  const text = await $.fs.read(`${dir}/.claude.json`).catch(() => '')
  try {
    return (JSON.parse(text) as { oauthAccount?: { organizationRateLimitTier?: string } }).oauthAccount?.organizationRateLimitTier
  } catch {
    return undefined
  }
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
  plan = usesLogin ? planOf(status?.subscriptionType, await rateLimitTier($)) : ''
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

export const register: Register = (on, options) => {
  show = {
    fiveHour: options.fiveHourLimit !== false,
    weekly: options.weeklyLimit === 'always' || options.weeklyLimit === 'never' ? options.weeklyLimit : 'over-half',
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'whoami', description: `Which Claude account this session uses. ${USAGE}` }).catch(() => {})
    void check($).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'whoami' }, async ($, e) => ({ text: await command($, e.args.trim()) }))

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
    const parts = [
      { text: account.label, color: 'suggestion' },
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
