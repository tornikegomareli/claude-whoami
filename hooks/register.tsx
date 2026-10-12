import type { EngineInterface, Register } from 'claude-code'
import { UNKNOWN, accountOf, parseStatus } from './account'
import type { Account } from './account'

let account: Account = UNKNOWN

// Reads the account, then redraws the footer label.
async function check($: EngineInterface) {
  // `claude auth status` reports ANTHROPIC_API_KEY even when the session declined it and uses the login.
  const usesLogin = (await $.session.authorize().catch(() => null))?.kind === 'bearer'
  const env = usesLogin ? { ANTHROPIC_API_KEY: '' } : undefined
  const r = await $.process.run(['claude', 'auth', 'status', '--json'], { env, timeoutMs: 10000 }).catch(() => undefined)
  const status = r && parseStatus(r.stdout)
  account = status ? accountOf(status) : UNKNOWN
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'whoami', description: 'Which Claude account this session uses.' }).catch(() => {})
    void check($).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'whoami' }, async $ => {
    await check($)
    return { text: `Signed in: ${account.label}.` }
  })

  // The account can change between prompts (`/login`, another terminal).
  on('prompt.submit', async ($, e, next) => {
    void check($).catch(() => {})
    return next(e)
  })

  // The footer's mode labels (`focus`), redrawn on the left with the account after them.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const elements = $.ui.resolve(e)
    if (account === UNKNOWN || !('Box' in elements)) return next(e)
    const { Box, Text } = elements
    return (
      <Box width="100%" justifyContent="flex-start">
        <Text dimColor>{[...e.props.modes, account.label].join(' & ')}</Text>
      </Box>
    )
  })
}
