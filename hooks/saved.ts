// An account of the Claude Accounts menu bar app: a name, an emoji, and the
// config folder whose Keychain login it uses. The app keeps the list in
// ~/.claude-accounts/accounts.json.
export type Saved = { name: string; configDir: string; emoji?: string }

export function parseSaved(text: string): Saved[] {
  try {
    const list = JSON.parse(text) as unknown
    if (!Array.isArray(list)) return []
    return list.filter((a): a is Saved => typeof a?.name === 'string' && typeof a?.configDir === 'string')
  } catch {
    return []
  }
}

// "💼 Work", or the name alone.
export const titleOf = (a: Saved) => (a.emoji ? `${a.emoji} ${a.name}` : a.name)

// The account a `/account` argument names: its number in the list, its name, or the start of its name.
export function pick(list: readonly Saved[], arg: string): Saved | undefined {
  if (/^\d+$/.test(arg)) return list[Number(arg) - 1]
  const q = arg.toLowerCase()
  return list.find(a => a.name.toLowerCase() === q) ?? list.find(a => a.name.toLowerCase().startsWith(q))
}

// Claude Code names the Keychain item of a login after CLAUDE_SECURESTORAGE_CONFIG_DIR, and reads that
// variable each time it reads the login. Empty means the default folder, whose item name has no hash.
export const storageValue = (dir: string, home: string) => (dir === `${home}/.claude` ? '' : dir)

// The folder whose login the session uses: the switched one, else the folder it started with.
export function loginDir(env: { storage?: string; config?: string; home: string }) {
  if (env.storage !== undefined) return env.storage || `${env.home}/.claude`
  return env.config || `${env.home}/.claude`
}

// Where Claude Code keeps the global config, with the login's email and plan size, for a folder.
export const configFile = (dir: string, home: string) => (dir === `${home}/.claude` ? `${home}/.claude.json` : `${dir}/.claude.json`)
