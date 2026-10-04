import { readFileSync } from 'node:fs'
import type { Condition, Rule, Serve } from '@modlogtv/halyard-engine'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { exportFlagd } from '@/server/transfer/flagd'
import type { ExportDocument, ExportFlag, ExportFlagEnvironment } from '@/server/transfer/format'

// The flagd schemas are checked in under test/fixtures. They come from
// https://raw.githubusercontent.com/open-feature/flagd-schemas/main/json/flags.json and
// .../targeting.json (flags.json references targeting.json relatively).
const readSchema = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as object

function flagdValidator() {
  // The schemas use the draft-07 tuple form (`items` arrays), which ajv flags in strict mode.
  const ajv = new Ajv({ strict: false, allErrors: true })
  ajv.addSchema(readSchema('flagd-targeting-schema.json'))
  return ajv.compile(readSchema('flagd-schema.json'))
}

const validate = flagdValidator()

const expectValid = (flagd: unknown) => {
  const ok = validate(flagd)
  expect(validate.errors ?? []).toEqual([])
  expect(ok).toBe(true)
}

let nextId = 0
const rule = (
  conditions: Condition[],
  serve: Serve,
  extra: { description?: string } = {},
): Rule => ({ id: `rule-${++nextId}`, conditions, serve, ...extra })

const attr = (
  attribute: string,
  operator: Extract<Condition, { type: 'attribute' }>['operator'],
  value?: Extract<Condition, { type: 'attribute' }>['value'],
): Condition => ({ type: 'attribute', attribute, operator, ...(value !== undefined && { value }) })

const on: Serve = { type: 'variant', variant: 'on' }
const off: Serve = { type: 'variant', variant: 'off' }

const booleanVariants = [
  { key: 'on', value: true },
  { key: 'off', value: false },
]

const config = (overrides: Partial<ExportFlagEnvironment> = {}): ExportFlagEnvironment => ({
  enabled: true,
  offVariant: 'off',
  fallthrough: off,
  rules: [],
  ...overrides,
})

const flag = (
  key: string,
  environments: Record<string, ExportFlagEnvironment>,
  overrides: Partial<ExportFlag> = {},
): ExportFlag => ({
  key,
  name: key,
  description: null,
  type: 'boolean',
  variants: booleanVariants,
  tags: [],
  archived: false,
  environments,
  ...overrides,
})

const documentOf = (flags: ExportFlag[]): ExportDocument => ({
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  project: { slug: 'acme', name: 'Acme', description: null },
  environments: [
    {
      key: 'development',
      name: 'Development',
      color: '#3b82f6',
      isProduction: false,
      sortOrder: 0,
    },
    { key: 'production', name: 'Production', color: '#e11d48', isProduction: true, sortOrder: 1 },
  ],
  segments: [
    {
      key: 'beta-users',
      name: 'Beta users',
      description: null,
      match: 'all',
      conditions: [
        { type: 'attribute', attribute: 'plan', operator: 'eq', value: 'pro' },
        { type: 'attribute', attribute: 'country', operator: 'in', value: ['DE', 'AT'] },
      ],
    },
    {
      key: 'staff',
      name: 'Staff',
      description: null,
      match: 'any',
      conditions: [
        { type: 'attribute', attribute: 'email', operator: 'ends_with', value: '@acme.com' },
        { type: 'attribute', attribute: 'role', operator: 'exists' },
      ],
    },
    {
      key: 'emails',
      name: 'Email pattern',
      description: null,
      match: 'all',
      conditions: [
        { type: 'attribute', attribute: 'email', operator: 'regex', value: '@(acme|corp)\\.' },
      ],
    },
    { key: 'everyone', name: 'Everyone', description: null, match: 'all', conditions: [] },
  ],
  flags,
})

const operatorRules: Rule[] = [
  rule([attr('plan', 'eq', 'pro')], on),
  rule([attr('plan', 'neq', 'free')], on),
  rule([attr('country', 'in', ['DE', 'AT'])], on),
  rule([attr('country', 'not_in', ['US'])], off),
  rule([attr('email', 'contains', 'test')], off),
  rule([attr('email', 'not_contains', 'test')], on),
  rule([attr('email', 'starts_with', 'admin')], on),
  rule([attr('email', 'ends_with', '@acme.com')], on),
  rule([attr('seats', 'gt', 5)], on),
  rule([attr('seats', 'gte', '10')], on),
  rule([attr('seats', 'lt', 100)], on),
  rule([attr('seats', 'lte', 99.5)], on),
  rule([attr('version', 'semver_eq', '1.0.0')], on),
  rule([attr('version', 'semver_gt', 'v1.2.3')], on),
  rule([attr('version', 'semver_gte', '2.0.0-beta.1')], on),
  rule([attr('version', 'semver_lt', '3.0.0')], on),
  rule([attr('version', 'semver_lte', '3.1.0+build.5')], on),
  rule([attr('role', 'exists')], on),
  rule([attr('role', 'not_exists')], off),
  rule([{ type: 'segment', segmentKey: 'beta-users' }], on, { description: 'Beta' }),
  rule([{ type: 'segment', segmentKey: 'staff', negate: true }], off),
  rule(
    [attr('plan', 'eq', 'pro'), { type: 'segment', segmentKey: 'staff' }, attr('seats', 'gt', 1)],
    on,
    { description: 'Pro staff' },
  ),
]

function representative(): ExportDocument {
  return documentOf([
    flag(
      'operators',
      { production: config({ rules: operatorRules }) },
      { description: 'All operators', tags: ['qa', 'targeting'] },
    ),
    flag('regexes', {
      production: config({
        rules: [
          rule([attr('email', 'regex', '^a')], on, { description: 'Starts with a' }),
          rule([{ type: 'segment', segmentKey: 'emails' }], on),
          rule([attr('plan', 'eq', 'pro'), attr('email', 'regex', 'x')], on),
          rule([attr('plan', 'eq', 'team')], on),
        ],
      }),
    }),
    flag(
      'theme',
      {
        production: config({
          offVariant: 'blue',
          fallthrough: {
            type: 'rollout',
            variations: [
              { variant: 'blue', weight: 33.3 },
              { variant: 'green', weight: 33.3 },
              { variant: 'red', weight: 33.4 },
            ],
          },
          rules: [
            rule([attr('plan', 'eq', 'pro')], {
              type: 'rollout',
              bucketBy: 'userId',
              variations: [
                { variant: 'green', weight: 50 },
                { variant: 'red', weight: 50 },
              ],
            }),
          ],
        }),
      },
      {
        type: 'string',
        variants: [
          { key: 'blue', value: '#00f' },
          { key: 'green', value: '#0f0' },
          { key: 'red', value: '#f00' },
        ],
      },
    ),
    flag('rollout-only', {
      production: config({
        fallthrough: {
          type: 'rollout',
          variations: [
            { variant: 'on', weight: 10 },
            { variant: 'off', weight: 90 },
          ],
        },
      }),
    }),
    flag('catch-all', {
      production: config({
        rules: [
          rule([attr('plan', 'eq', 'pro')], on),
          rule([{ type: 'segment', segmentKey: 'everyone' }], off),
          rule([], on),
          rule([attr('plan', 'eq', 'never')], off),
        ],
        fallthrough: off,
      }),
    }),
    flag('only-rule', { production: config({ rules: [rule([], on)], fallthrough: off }) }),
    flag('kill-switch', {
      production: config({ enabled: false, offVariant: 'off', fallthrough: on }),
    }),
    flag(
      'limit',
      {
        production: config({
          offVariant: 'low',
          fallthrough: { type: 'variant', variant: 'high' },
        }),
      },
      {
        type: 'number',
        variants: [
          { key: 'low', value: 10 },
          { key: 'high', value: 100 },
        ],
      },
    ),
    flag(
      'settings',
      { production: config({ offVariant: 'a', fallthrough: { type: 'variant', variant: 'b' } }) },
      {
        type: 'json',
        variants: [
          { key: 'a', value: { retries: 1 } },
          { key: 'b', value: { retries: 3, nested: { on: true } } },
        ],
      },
    ),
    flag(
      'list',
      { production: config({ offVariant: 'a', fallthrough: { type: 'variant', variant: 'a' } }) },
      { type: 'json', variants: [{ key: 'a', value: [1, 2, 3] }] },
    ),
    flag('retired', { production: config() }, { archived: true }),
    flag('dev-only', { development: config() }),
  ])
}

describe('exportFlagd', () => {
  it('maps every operator, segment and serve type', () => {
    const { flagd, warnings } = exportFlagd({
      document: representative(),
      environmentKey: 'production',
    })

    const subject = (attribute: string) => ({ var: attribute })
    expect(flagd.flags.operators).toEqual({
      state: 'ENABLED',
      variants: { on: true, off: false },
      defaultVariant: 'off',
      metadata: { description: 'All operators', tags: 'qa,targeting' },
      targeting: {
        if: [
          { '==': [subject('plan'), 'pro'] },
          'on',
          { '!=': [subject('plan'), 'free'] },
          'on',
          { in: [subject('country'), ['DE', 'AT']] },
          'on',
          { '!': [{ in: [subject('country'), ['US']] }] },
          'off',
          { in: ['test', subject('email')] },
          'off',
          { '!': [{ in: ['test', subject('email')] }] },
          'on',
          { starts_with: [subject('email'), 'admin'] },
          'on',
          { ends_with: [subject('email'), '@acme.com'] },
          'on',
          { '>': [subject('seats'), 5] },
          'on',
          { '>=': [subject('seats'), 10] },
          'on',
          { '<': [subject('seats'), 100] },
          'on',
          { '<=': [subject('seats'), 99.5] },
          'on',
          { sem_ver: [subject('version'), '=', '1.0.0'] },
          'on',
          { sem_ver: [subject('version'), '>', '1.2.3'] },
          'on',
          { sem_ver: [subject('version'), '>=', '2.0.0-beta.1'] },
          'on',
          { sem_ver: [subject('version'), '<', '3.0.0'] },
          'on',
          { sem_ver: [subject('version'), '<=', '3.1.0+build.5'] },
          'on',
          { '!!': [subject('role')] },
          'on',
          { '!': [subject('role')] },
          'off',
          { $ref: 'beta-users' },
          'on',
          { '!': [{ $ref: 'staff' }] },
          'off',
          {
            and: [
              { '==': [subject('plan'), 'pro'] },
              { $ref: 'staff' },
              { '>': [subject('seats'), 1] },
            ],
          },
          'on',
        ],
      },
    })

    expect(flagd.$evaluators).toEqual({
      'beta-users': {
        and: [{ '==': [subject('plan'), 'pro'] }, { in: [subject('country'), ['DE', 'AT']] }],
      },
      staff: { or: [{ ends_with: [subject('email'), '@acme.com'] }, { '!!': [subject('role')] }] },
      everyone: { '==': [1, 1] },
    })

    const fractionalKey = (attribute: string) => ({
      cat: [{ var: '$flagd.flagKey' }, { var: attribute }],
    })
    expect(flagd.flags.theme).toEqual({
      state: 'ENABLED',
      variants: { blue: '#00f', green: '#0f0', red: '#f00' },
      defaultVariant: 'blue',
      targeting: {
        if: [
          { '==': [subject('plan'), 'pro'] },
          { fractional: [fractionalKey('userId'), ['green', 50], ['red', 50]] },
          {
            fractional: [
              fractionalKey('targetingKey'),
              ['blue', 333],
              ['green', 333],
              ['red', 334],
            ],
          },
        ],
      },
    })
    expect(flagd.flags['rollout-only']).toEqual({
      state: 'ENABLED',
      variants: { on: true, off: false },
      defaultVariant: 'off',
      targeting: { fractional: [fractionalKey('targetingKey'), ['on', 10], ['off', 90]] },
    })

    // An unconditional rule ends the chain; the rules after it are unreachable.
    expect(flagd.flags['catch-all']).toMatchObject({
      defaultVariant: 'off',
      targeting: {
        if: [{ '==': [subject('plan'), 'pro'] }, 'on', { $ref: 'everyone' }, 'off', 'on'],
      },
    })
    expect(flagd.flags['only-rule']).toEqual({
      state: 'ENABLED',
      variants: { on: true, off: false },
      defaultVariant: 'on',
    })

    expect(flagd.flags['kill-switch']).toEqual({
      state: 'DISABLED',
      variants: { on: true, off: false },
      defaultVariant: 'on',
    })
    expect(flagd.flags.limit).toEqual({
      state: 'ENABLED',
      variants: { low: 10, high: 100 },
      defaultVariant: 'high',
    })
    expect(flagd.flags.settings).toMatchObject({
      variants: { a: { retries: 1 }, b: { retries: 3, nested: { on: true } } },
      defaultVariant: 'b',
    })

    // Skipped flags and rules.
    expect(Object.keys(flagd.flags)).toEqual([
      'operators',
      'regexes',
      'theme',
      'rollout-only',
      'catch-all',
      'only-rule',
      'kill-switch',
      'limit',
      'settings',
    ])
    expect(flagd.flags.regexes).toEqual({
      state: 'ENABLED',
      variants: { on: true, off: false },
      defaultVariant: 'off',
      targeting: { if: [{ '==': [subject('plan'), 'team'] }, 'on'] },
    })

    expect(flagd.$schema).toBe('https://flagd.dev/schema/v0/flags.json')
    expect(flagd.metadata).toEqual({
      source: 'halyard',
      project: 'acme',
      environment: 'production',
    })

    expect(warnings).toEqual([
      'Segment "emails" is skipped: the "regex" operator on "email" has no flagd equivalent. Rules that use it are skipped as well',
      'Flag "operators" rule 18: "exists" on "role" is exported as a JsonLogic truthiness test, so empty strings, 0 and false count as missing',
      'Flag "operators" rule 19: "not_exists" on "role" is exported as a JsonLogic truthiness test, so empty strings, 0 and false count as missing',
      'Flag "regexes" rule 1 ("Starts with a") is skipped: the "regex" operator on "email" has no flagd equivalent',
      'Flag "regexes" rule 2 is skipped: segment "emails" cannot be expressed in flagd',
      'Flag "regexes" rule 3 is skipped: the "regex" operator on "email" has no flagd equivalent',
      'Flag "theme" rule 1 serves a percentage rollout, which is exported as flagd\'s "fractional" operator; flagd buckets users with a different hash than Halyard, so the same user can get a different variant',
      'Flag "theme" fallthrough serves a percentage rollout, which is exported as flagd\'s "fractional" operator; flagd buckets users with a different hash than Halyard, so the same user can get a different variant',
      'Flag "rollout-only" fallthrough serves a percentage rollout, which is exported as flagd\'s "fractional" operator; flagd buckets users with a different hash than Halyard, so the same user can get a different variant',
      'Flag "kill-switch" is disabled in "production": flagd serves the code default for disabled flags, so the off variant "off" is lost',
      'Flag "list" is skipped: variant "a" is not a JSON object, and flagd object flags only support objects',
      'Flag "retired" is archived and is not exported',
      'Flag "dev-only" has no configuration for environment "production" and is skipped',
    ])

    expectValid(flagd)
  })

  it('exports another environment of the same document', () => {
    const { flagd, warnings } = exportFlagd({
      document: representative(),
      environmentKey: 'development',
    })
    expect(Object.keys(flagd.flags)).toEqual(['dev-only'])
    expect(flagd.metadata?.environment).toBe('development')
    // Segments are exported whatever the flags use.
    expect(Object.keys(flagd.$evaluators ?? {})).toEqual(['beta-users', 'staff', 'everyone'])
    expect(warnings).toContain(
      'Flag "operators" has no configuration for environment "development" and is skipped',
    )
    expectValid(flagd)
  })

  it('omits $evaluators and metadata that would be empty', () => {
    const document = documentOf([flag('plain', { production: config() })])
    document.segments = []
    const { flagd, warnings } = exportFlagd({ document, environmentKey: 'production' })
    expect(flagd.$evaluators).toBeUndefined()
    expect(flagd.flags.plain).toEqual({
      state: 'ENABLED',
      variants: { on: true, off: false },
      defaultVariant: 'off',
    })
    expect(warnings).toEqual([])
    expectValid(flagd)
  })

  it('scales decimal rollout weights to integers', () => {
    const document = documentOf([
      flag('split', {
        production: config({
          fallthrough: {
            type: 'rollout',
            variations: [
              { variant: 'on', weight: 0.5 },
              { variant: 'off', weight: 99.5 },
            ],
          },
        }),
      }),
    ])
    const { flagd } = exportFlagd({ document, environmentKey: 'production' })
    expect(flagd.flags.split?.targeting).toEqual({
      fractional: [
        { cat: [{ var: '$flagd.flagKey' }, { var: 'targetingKey' }] },
        ['on', 5],
        ['off', 995],
      ],
    })
    expectValid(flagd)
  })

  it('rejects unknown environments with a 400', () => {
    expect(() => exportFlagd({ document: representative(), environmentKey: 'nope' })).toThrow(
      expect.objectContaining({ status: 400, message: 'Unknown environment "nope"' }),
    )
  })

  it('validates against the flagd schema, and the schema rejects bad definitions', () => {
    expect(
      validate({ flags: { x: { state: 'ENABLED', variants: { on: true, off: 'no' } } } }),
    ).toBe(false)
    expect(validate({ flags: { x: { state: 'MAYBE', variants: { on: true } } } })).toBe(false)
    expect(
      validate({
        flags: { x: { state: 'ENABLED', variants: { on: true }, targeting: { nope: [1, 2] } } },
      }),
    ).toBe(false)
  })
})
