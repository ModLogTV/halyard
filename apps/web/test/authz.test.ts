import { describe, expect, it } from 'vitest'
import { assertPermission, assertProjectAccess } from '@/server/services/authz'

const actor = (role: 'owner' | 'editor' | 'viewer', projectId = 'p1') => ({
  userId: 'u',
  name: 'U',
  email: 'u@example.com',
  isAdmin: false,
  projectId,
  role,
})

describe('assertPermission', () => {
  it('follows the role definitions', () => {
    expect(() => assertPermission(actor('viewer'), { flag: ['read'] })).not.toThrow()
    expect(() => assertPermission(actor('viewer'), { flag: ['toggle'] })).toThrow(/permission/)
    expect(() => assertPermission(actor('editor'), { flag: ['toggle', 'promote'] })).not.toThrow()
    expect(() => assertPermission(actor('editor'), { apiKey: ['create'] })).toThrow(/permission/)
    expect(() => assertPermission(actor('editor'), { environment: ['create'] })).toThrow(
      /permission/,
    )
    expect(() => assertPermission(actor('editor'), { member: ['update'] })).toThrow(/permission/)
    expect(() =>
      assertPermission(actor('owner'), { apiKey: ['create'], member: ['update'] }),
    ).not.toThrow()
  })

  it('requires every requested action', () => {
    expect(() => assertPermission(actor('viewer'), { flag: ['read', 'update'] })).toThrow(
      /permission/,
    )
  })

  it('treats an empty request as membership only', () => {
    expect(() => assertPermission(actor('viewer'), {})).not.toThrow()
  })

  it('rejects unknown roles', () => {
    expect(() => assertPermission({ role: 'superuser' as never }, { flag: ['read'] })).toThrow(
      /permission/,
    )
  })
})

describe('assertProjectAccess', () => {
  it('rejects an actor authorized for another project', () => {
    expect(() => assertProjectAccess(actor('owner', 'p1'), 'p2', { flag: ['read'] })).toThrow(
      /not a member/,
    )
    expect(() => assertProjectAccess(actor('owner', 'p1'), 'p1', { flag: ['read'] })).not.toThrow()
  })
})
