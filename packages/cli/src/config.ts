import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CliError, ExitCode } from './errors.js'

export const DEFAULT_PROFILE = 'default'

export interface Profile {
  url: string
  key: string
}

export interface ConfigFile {
  version: 1
  profiles: Record<string, Profile>
}

type Env = Record<string, string | undefined>

/**
 * Location of the config file:
 * `$XDG_CONFIG_HOME/halyard/config.json`, falling back to `~/.config/halyard/config.json`,
 * and `%APPDATA%/halyard/config.json` on Windows.
 */
export function configPath(env: Env, platform: string, homedir: string): string {
  if (platform === 'win32') {
    const appData = env.APPDATA || join(homedir, 'AppData', 'Roaming')
    return join(appData, 'halyard', 'config.json')
  }
  const base = env.XDG_CONFIG_HOME || join(homedir, '.config')
  return join(base, 'halyard', 'config.json')
}

export function assertValidProfileName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name === '__proto__') {
    throw new CliError(
      `Invalid profile name "${name}".`,
      ExitCode.Validation,
      'Use letters, digits, ".", "_" and "-".',
    )
  }
}

/** Validates and normalises a base URL: http(s) only, no trailing slash, no query or hash. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new CliError(
      `Invalid URL "${input}".`,
      ExitCode.Config,
      'Use the base URL of your instance, e.g. https://flags.example.com',
    )
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliError(
      `Invalid URL "${input}": only http and https are supported.`,
      ExitCode.Config,
    )
  }
  parsed.hash = ''
  parsed.search = ''
  return parsed.toString().replace(/\/+$/, '')
}

const emptyConfig = (): ConfigFile => ({ version: 1, profiles: {} })

export async function readConfig(path: string): Promise<ConfigFile> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig()
    throw new CliError(`Could not read ${path}: ${(error as Error).message}`, ExitCode.Config)
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw malformed(path)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw malformed(path)
  const rawProfiles = (data as { profiles?: unknown }).profiles
  if (rawProfiles === undefined) return emptyConfig()
  if (!rawProfiles || typeof rawProfiles !== 'object' || Array.isArray(rawProfiles)) {
    throw malformed(path)
  }
  const profiles: Record<string, Profile> = {}
  for (const [name, value] of Object.entries(rawProfiles)) {
    const profile = value as Partial<Profile> | null
    if (!profile || typeof profile.url !== 'string' || typeof profile.key !== 'string') {
      throw malformed(path)
    }
    profiles[name] = { url: profile.url, key: profile.key }
  }
  return { version: 1, profiles }
}

function malformed(path: string): CliError {
  return new CliError(
    `The config file ${path} is malformed.`,
    ExitCode.Config,
    'Fix or delete it, then run `halyard login` again.',
  )
}

async function writeConfig(path: string, config: ConfigFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  try {
    await chmod(tmp, 0o600)
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

export async function saveProfile(path: string, name: string, profile: Profile): Promise<void> {
  assertValidProfileName(name)
  const config = await readConfig(path)
  config.profiles[name] = profile
  await writeConfig(path, config)
}

/** Removes a profile. Deletes the file when it was the last one. Returns false if it did not exist. */
export async function removeProfile(path: string, name: string): Promise<boolean> {
  const config = await readConfig(path)
  if (!Object.hasOwn(config.profiles, name)) return false
  delete config.profiles[name]
  if (Object.keys(config.profiles).length === 0) {
    await rm(path, { force: true })
  } else {
    await writeConfig(path, config)
  }
  return true
}

// ---------------------------------------------------------------------------
// Resolution: flags > environment > stored profile
// ---------------------------------------------------------------------------

export type ValueSource = 'flag' | 'env' | 'profile'

export interface Connection {
  url: string
  key: string
  /** The profile that was consulted (it may not exist when flags or env are complete). */
  profile: string
  sources: { url: ValueSource; key: ValueSource }
}

export interface ConnectionInput {
  flags: { url?: string; key?: string; profile?: string }
  env: Env
  config: ConfigFile
}

const nonEmpty = (value: string | undefined): string | undefined => (value ? value : undefined)

export function resolveConnection({ flags, env, config }: ConnectionInput): Connection {
  const explicitProfile = nonEmpty(flags.profile) ?? nonEmpty(env.HALYARD_PROFILE)
  const profileName = explicitProfile ?? DEFAULT_PROFILE
  assertValidProfileName(profileName)
  const stored = Object.hasOwn(config.profiles, profileName)
    ? config.profiles[profileName]
    : undefined

  const flagUrl = nonEmpty(flags.url)
  const envUrl = nonEmpty(env.HALYARD_URL)
  const flagKey = nonEmpty(flags.key)
  const envKey = nonEmpty(env.HALYARD_API_KEY)

  const overridden = flagUrl ?? envUrl
  const url = overridden ?? stored?.url
  const urlSource: ValueSource = flagUrl ? 'flag' : envUrl ? 'env' : 'profile'

  if (!url) {
    if (explicitProfile && !stored) {
      throw new CliError(
        `No profile named "${profileName}".`,
        ExitCode.Config,
        `Run \`halyard login --profile ${profileName}\` first.`,
      )
    }
    throw new CliError(
      'Not logged in: no Halyard URL configured.',
      ExitCode.Config,
      'Run `halyard login`, pass --url and --key, or set HALYARD_URL and HALYARD_API_KEY.',
    )
  }
  const normalizedUrl = normalizeUrl(url)

  let key = flagKey ?? envKey
  let keySource: ValueSource = flagKey ? 'flag' : 'env'
  if (!key && stored) {
    // Never send a stored key to a URL it was not created for.
    if (!overridden || normalizeUrl(stored.url) === normalizedUrl) {
      key = stored.key
      keySource = 'profile'
    } else {
      throw new CliError(
        `The URL differs from the one stored in profile "${profileName}", so its key is not reused.`,
        ExitCode.Config,
        'Pass --key (or set HALYARD_API_KEY), or run `halyard login` for this URL.',
      )
    }
  }
  if (!key) {
    throw new CliError(
      'No management key configured.',
      ExitCode.Config,
      'Run `halyard login`, pass --key, or set HALYARD_API_KEY.',
    )
  }
  return {
    url: normalizedUrl,
    key,
    profile: profileName,
    sources: { url: urlSource, key: keySource },
  }
}

/** `hal_mgmt_abcd…wxyz`: enough to recognise a key without revealing it. */
export function maskKey(key: string): string {
  if (key.length <= 16) return `${key.slice(0, 4)}…`
  return `${key.slice(0, 12)}…${key.slice(-4)}`
}
