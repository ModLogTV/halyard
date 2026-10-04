import {
  type ExportFlagdInput,
  exportFlagdSchema,
  exportProjectSchema,
  importDocumentSchema,
} from '../schemas/transfer'
import {
  applyImport as applyImportDocument,
  type ImportPreview,
  type ImportResult,
  previewImport as previewImportDocument,
} from '../transfer/apply'
import { exportFlagd as exportFlagdDocument, type FlagdExport } from '../transfer/flagd'
import { type ExportDocument, exportProject as exportProjectDocument } from '../transfer/format'
import { assertProjectAccess, type ProjectActor } from './authz'
import { parseInput } from './util'

export type { ExportDocument, FlagdExport, ImportPreview, ImportResult }

/** The project's configuration as an export document. Needs `transfer:export`. */
export async function exportProject(
  actor: ProjectActor,
  input: { projectId: string },
): Promise<ExportDocument> {
  const { projectId } = parseInput(exportProjectSchema, input)
  assertProjectAccess(actor, projectId, { transfer: ['export'] })
  return exportProjectDocument(projectId)
}

/** The flagd definition of one environment, with warnings for what could not be expressed. */
export async function exportFlagd(
  actor: ProjectActor,
  input: ExportFlagdInput,
): Promise<FlagdExport> {
  const { projectId, environmentKey } = parseInput(exportFlagdSchema, input)
  assertProjectAccess(actor, projectId, { transfer: ['export'] })
  const document = await exportProjectDocument(projectId)
  return exportFlagdDocument({ document, environmentKey })
}

/** What an import would change. Writes nothing. Needs `transfer:import`. */
export async function previewImport(
  actor: ProjectActor,
  input: { projectId: string; document: unknown; prune?: boolean },
): Promise<ImportPreview> {
  const data = parseInput(importDocumentSchema, input)
  return previewImportDocument(actor, data)
}

/** Applies an import in one transaction. Needs `transfer:import`. */
export async function applyImport(
  actor: ProjectActor,
  input: { projectId: string; document: unknown; prune?: boolean },
): Promise<ImportResult> {
  const data = parseInput(importDocumentSchema, input)
  return applyImportDocument(actor, data)
}
