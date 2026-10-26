// What `claude auth status --json` prints. Fields absent for a login method are left out.
export type AuthStatus = {
  loggedIn?: boolean
  authMethod?: string
  apiProvider?: string
  apiKeySource?: string
  email?: string
  orgId?: string
  orgName?: string
  subscriptionType?: string
}

// One usage-limit window, as `session.measure` reports it.
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// `id` is what a pin compares; `label` is what the person reads.
export type Account = { id: string; label: string }

// Folder path to the account expected there.
export type Pins = Record<string, Account>

export const UNKNOWN: Account = { id: 'unknown', label: 'account unknown' }

// The organization as the footer names it: a personal account's generated name reads as "Personal".
export const orgOf = (s: AuthStatus) => (s.email && s.orgName === `${s.email}'s Organization` ? 'Personal' : s.orgName)

export function accountOf(s: AuthStatus): Account {
  if (s.apiProvider && s.apiProvider !== 'firstParty') return { id: `provider:${s.apiProvider}`, label: s.apiProvider }
  if (s.authMethod === 'api_key') return { id: 'api-key', label: `API key from ${s.apiKeySource ?? 'unknown source'}` }
  if (!s.loggedIn) return { id: 'none', label: 'not signed in' }
  const label = [orgOf(s), s.email].filter(Boolean).join(' · ')
  return { id: s.orgId ?? s.email ?? UNKNOWN.id, label: label || UNKNOWN.label }
}

export function parseStatus(stdout: string): AuthStatus | undefined {
  try {
    return JSON.parse(stdout) as AuthStatus
  } catch {
    return undefined
  }
}

// `max` and `default_claude_max_20x` read as "Max 20x".
export function planOf(subscriptionType?: string, rateLimitTier?: string) {
  if (!subscriptionType) return ''
  const size = rateLimitTier?.match(/_(\d+x)$/)?.[1]
  return [subscriptionType[0]!.toUpperCase() + subscriptionType.slice(1), size].filter(Boolean).join(' ')
}

const pad = (n: number) => String(n).padStart(2, '0')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Which windows the footer shows: the fiveHourLimit and weeklyLimit settings.
export type Show = { fiveHour: boolean; weekly: 'always' | 'over-half' | 'never'; email: 'full' | 'name' | 'hidden' }

// The footer's account part: the account's name, then the email as the email setting asks.
export function nameAndEmail(name: string | undefined, email: string, show: Show['email']) {
  const shown = show === 'hidden' ? '' : show === 'name' ? email.split('@')[0] : email
  return [name, shown].filter(Boolean).join(' · ')
}

type Windows = Pick<Show, 'fiveHour' | 'weekly'>

const isShown = (l: Limit, show: Windows) =>
  l.kind === 'five_hour' ? show.fiveHour
  : l.kind === 'seven_day' && (show.weekly === 'always' || (show.weekly === 'over-half' && l.percentUsed >= 50))

// "5h 42%, resets 18:30 · 7d 63%, resets Fri", and the highest percent shown, for its color.
export function usageOf(limits: readonly Limit[], show: Windows) {
  const parts: string[] = []
  let used = 0
  for (const l of limits) {
    if (!isShown(l, show)) continue
    const at = l.resetsAt ? new Date(l.resetsAt) : undefined
    const resets = at ? `, resets ${l.kind === 'five_hour' ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : DAYS[at.getDay()]}` : ''
    parts.push(`${l.kind === 'five_hour' ? '5h' : '7d'} ${Math.round(l.percentUsed)}%${resets}`)
    used = Math.max(used, l.percentUsed)
  }
  return { text: parts.join(' · '), used }
}

// The pin of `dir` or of its nearest parent folder.
export function pinFor(pins: Pins, dir: string): { dir: string; account: Account } | undefined {
  for (let d = dir; d; d = d.slice(0, d.lastIndexOf('/'))) {
    const account = pins[d]
    if (account) return { dir: d, account }
  }
}
