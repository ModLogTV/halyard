import { createFileRoute } from '@tanstack/react-router'
import { WRITE_KEY, withManagementKey } from '@/server/api/auth'
import { readJsonObject } from '@/server/api/body'
import { badRequest } from '@/server/errors'
import { applyImport, previewImport } from '@/server/services/transfer'

/**
 * Imports an export document. `dryRun: true` only previews. Without `prune` nothing is
 * deleted. Problems in the document answer 422 and change nothing.
 */
export const Route = createFileRoute('/api/v1/import')({
  server: {
    handlers: {
      POST: withManagementKey(async ({ request, actor, principal }) => {
        const body = await readJsonObject(request)
        if (!('document' in body)) throw badRequest('The body must contain a "document"')
        if (body.prune !== undefined && typeof body.prune !== 'boolean') {
          throw badRequest('"prune" must be true or false')
        }
        if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
          throw badRequest('"dryRun" must be true or false')
        }
        const input = {
          projectId: principal.projectId,
          document: body.document,
          prune: body.prune === true,
        }
        if (body.dryRun === true) {
          const preview = await previewImport(actor, input)
          return Response.json({ ...preview, applied: false })
        }
        return Response.json(await applyImport(actor, input))
      }, WRITE_KEY),
    },
  },
})
