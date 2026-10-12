// What `claude auth status --json` prints. Fields absent for a login method are left out.
export type AuthStatus = {
  loggedIn?: boolean
  authMethod?: string
  apiProvider?: string
  apiKeySource?: string
  email?: string
  orgId?: string
  orgName?: string
}

// `id` tells accounts apart; `label` is what the person reads.
export type Account = { id: string; label: string }

export const UNKNOWN: Account = { id: 'unknown', label: 'account unknown' }

export function accountOf(s: AuthStatus): Account {
  if (s.apiProvider && s.apiProvider !== 'firstParty') return { id: `provider:${s.apiProvider}`, label: s.apiProvider }
  if (s.authMethod === 'api_key') return { id: 'api-key', label: `API key from ${s.apiKeySource ?? 'unknown source'}` }
  if (!s.loggedIn) return { id: 'none', label: 'not signed in' }
  const org = s.email && s.orgName === `${s.email}'s Organization` ? 'Personal' : s.orgName
  const label = [org, s.email].filter(Boolean).join(' · ')
  return { id: s.orgId ?? s.email ?? UNKNOWN.id, label: label || UNKNOWN.label }
}

export function parseStatus(stdout: string): AuthStatus | undefined {
  try {
    return JSON.parse(stdout) as AuthStatus
  } catch {
    return undefined
  }
}

