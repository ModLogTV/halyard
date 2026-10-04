import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type ConfigFile,
  configPath,
  maskKey,
  normalizeUrl,
  readConfig,
  removeProfile,
  resolveConnection,
  saveProfile,
} from '../src/config.js'
import { CliError, ExitCode } from '../src/errors.js'
import { cleanupTempDirs, makeTempDir } from './helpers.js'

cleanupTempDirs()

describe('configPath', () => {
  it('respects XDG_CONFIG_HOME', () => {
    expect(configPath({ XDG_CONFIG_HOME: '/xdg' }, 'linux', '/home/u')).toBe(
      '/xdg/halyard/config.json',
    )
  })

  it('falls back to ~/.config', () => {
    expect(configPath({}, 'darwin', '/Users/u')).toBe('/Users/u/.config/halyard/config.json')
    expect(configPath({ XDG_CONFIG_HOME: '' }, 'linux', '/home/u')).toBe(
      '/home/u/.config/halyard/config.json',
    )
  })

  it('uses %APPDATA% on Windows', () => {
    const path = configPath({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32', 'C:\\Users\\u')
    expect(path.replaceAll('\\', '/')).toMatch(/AppData\/Roaming.*halyard.config\.json$/)
    expect(path).toContain('halyard')
  })
})

describe('profile store', () => {
  const profile = (n: number) => ({ url: `https://flags${n}.example.com`, key: `hal_mgmt_key${n}` })

  it('returns an empty config when the file does not exist', async () => {
    const path = join(makeTempDir(), 'halyard', 'config.json')
    expect(await readConfig(path)).toEqual({ version: 1, profiles: {} })
  })

  it('saves profiles with restrictive permissions and reads them back', async () => {
    const path = join(makeTempDir(), 'nested', 'halyard', 'config.json')
    await saveProfile(path, 'default', profile(1))
    await saveProfile(path, 'staging', profile(2))
    const config = await readConfig(path)
    expect(config.profiles).toEqual({ default: profile(1), staging: profile(2) })
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true)
  })

  it('keeps the file at 0600 when overwriting a looser one', async () => {
    if (process.platform === 'win32') return
    const path = join(makeTempDir(), 'config.json')
    writeFileSync(path, '{}', { mode: 0o644 })
    await saveProfile(path, 'default', profile(1))
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('overwrites an existing profile', async () => {
    const path = join(makeTempDir(), 'config.json')
    await saveProfile(path, 'default', profile(1))
    await saveProfile(path, 'default', profile(2))
    expect((await readConfig(path)).profiles).toEqual({ default: profile(2) })
  })

  it('removes profiles and deletes the file after the last one', async () => {
    const path = join(makeTempDir(), 'config.json')
    await saveProfile(path, 'a', profile(1))
    await saveProfile(path, 'b', profile(2))
    expect(await removeProfile(path, 'a')).toBe(true)
    expect(Object.keys((await readConfig(path)).profiles)).toEqual(['b'])
    expect(await removeProfile(path, 'a')).toBe(false)
    expect(await removeProfile(path, 'b')).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(await removeProfile(path, 'b')).toBe(false)
  })

  it('rejects invalid profile names', async () => {
    const path = join(makeTempDir(), 'config.json')
    for (const name of ['', '../x', 'a b', '__proto__', '-x']) {
      await expect(saveProfile(path, name, profile(1))).rejects.toBeInstanceOf(CliError)
    }
  })

  it('reports a malformed file as a config error', async () => {
    const dir = makeTempDir()
    for (const content of [
      'not json',
      '[]',
      '{"profiles": []}',
      '{"profiles": {"a": {"url": 1}}}',
    ]) {
      const path = join(dir, 'config.json')
      writeFileSync(path, content)
      await expect(readConfig(path)).rejects.toMatchObject({ exitCode: ExitCode.Config })
    }
  })
})

describe('normalizeUrl', () => {
  it('trims, strips trailing slashes, query and hash', () => {
    expect(normalizeUrl(' https://flags.example.com/ ')).toBe('https://flags.example.com')
    expect(normalizeUrl('http://localhost:3000///')).toBe('http://localhost:3000')
    expect(normalizeUrl('https://x.example.com/halyard/?a=1#b')).toBe(
      'https://x.example.com/halyard',
    )
  })

  it('rejects things that are not http(s) URLs', () => {
    for (const bad of ['flags.example.com', 'ftp://x.example.com', '', 'javascript:alert(1)']) {
      expect(() => normalizeUrl(bad)).toThrow(CliError)
    }
  })
})

describe('resolveConnection', () => {
  const config: ConfigFile = {
    version: 1,
    profiles: {
      default: { url: 'https://stored.example.com', key: 'hal_mgmt_stored' },
      staging: { url: 'https://staging.example.com', key: 'hal_mgmt_staging' },
    },
  }
  const empty: ConfigFile = { version: 1, profiles: {} }

  it('uses the default profile', () => {
    expect(resolveConnection({ flags: {}, env: {}, config })).toEqual({
      url: 'https://stored.example.com',
      key: 'hal_mgmt_stored',
      profile: 'default',
      sources: { url: 'profile', key: 'profile' },
    })
  })

  it('selects a profile by flag or HALYARD_PROFILE', () => {
    expect(resolveConnection({ flags: { profile: 'staging' }, env: {}, config }).url).toBe(
      'https://staging.example.com',
    )
    expect(resolveConnection({ flags: {}, env: { HALYARD_PROFILE: 'staging' }, config }).key).toBe(
      'hal_mgmt_staging',
    )
    expect(
      resolveConnection({
        flags: { profile: 'default' },
        env: { HALYARD_PROFILE: 'staging' },
        config,
      }).profile,
    ).toBe('default')
  })

  it('prefers flags over environment over profile', () => {
    const env = { HALYARD_URL: 'https://env.example.com', HALYARD_API_KEY: 'hal_mgmt_env' }
    expect(resolveConnection({ flags: {}, env, config })).toMatchObject({
      url: 'https://env.example.com',
      key: 'hal_mgmt_env',
      sources: { url: 'env', key: 'env' },
    })
    expect(
      resolveConnection({
        flags: { url: 'https://flag.example.com/', key: 'hal_mgmt_flag' },
        env,
        config,
      }),
    ).toMatchObject({
      url: 'https://flag.example.com',
      key: 'hal_mgmt_flag',
      sources: { url: 'flag', key: 'flag' },
    })
  })

  it('works with environment variables only', () => {
    const env = { HALYARD_URL: 'https://env.example.com', HALYARD_API_KEY: 'hal_mgmt_env' }
    expect(resolveConnection({ flags: {}, env, config: empty }).url).toBe('https://env.example.com')
  })

  it('ignores empty environment variables', () => {
    expect(
      resolveConnection({ flags: {}, env: { HALYARD_URL: '', HALYARD_API_KEY: '' }, config }).url,
    ).toBe('https://stored.example.com')
  })

  it('mixes sources when the URL is unchanged', () => {
    const connection = resolveConnection({
      flags: { url: 'https://stored.example.com/' },
      env: {},
      config,
    })
    expect(connection.key).toBe('hal_mgmt_stored')
    expect(connection.sources).toEqual({ url: 'flag', key: 'profile' })
  })

  it('never sends a stored key to a different URL', () => {
    expect(() =>
      resolveConnection({ flags: { url: 'https://other.example.com' }, env: {}, config }),
    ).toThrow(/key is not reused/)
    expect(
      resolveConnection({
        flags: { url: 'https://other.example.com', key: 'hal_mgmt_explicit' },
        env: {},
        config,
      }).key,
    ).toBe('hal_mgmt_explicit')
  })

  it('fails with a config error when nothing is configured', () => {
    expect(() => resolveConnection({ flags: {}, env: {}, config: empty })).toThrow(
      expect.objectContaining({
        exitCode: ExitCode.Config,
        message: expect.stringContaining('Not logged in'),
      }),
    )
  })

  it('fails when a requested profile does not exist', () => {
    expect(() => resolveConnection({ flags: { profile: 'nope' }, env: {}, config })).toThrow(
      /No profile named "nope"/,
    )
  })

  it('fails without a key', () => {
    expect(() =>
      resolveConnection({ flags: { url: 'https://x.example.com' }, env: {}, config: empty }),
    ).toThrow(/No management key/)
  })

  it('rejects an invalid URL', () => {
    expect(() =>
      resolveConnection({ flags: { url: 'nope', key: 'k' }, env: {}, config: empty }),
    ).toThrow(/Invalid URL/)
  })
})

describe('maskKey', () => {
  it('hides the middle of a key', () => {
    expect(maskKey('hal_mgmt_abcdefghijklmnopqrstuvwxyz')).toBe('hal_mgmt_abc…wxyz')
    expect(maskKey('short')).toBe('shor…')
  })
})
