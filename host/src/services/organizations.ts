import { rpcCall } from './rpc'

export interface Organization {
  id: string
  name: string
}

const PAGE_SIZE = 100
const MAX_ORGANIZATIONS = 5000
const LIST_KEYS = ['orgs', 'organizations', 'items', 'result', 'data', 'list']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function totalOf(value: unknown): number {
  if (!isRecord(value)) return 0
  const total = Number(value.total)
  return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
}

function organizationRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return []

  for (const key of LIST_KEYS) {
    if (Array.isArray(value[key])) return value[key]
  }

  for (const key of LIST_KEYS) {
    const nested = value[key]
    if (isRecord(nested)) {
      const rows = organizationRows(nested)
      if (rows.length) return rows
    }
  }

  return []
}

function normalizeOrganization(value: unknown): Organization | null {
  if (!isRecord(value)) return null

  const id = text(value.id ?? value.oid ?? value.org_id)
  if (!id) return null

  const name = text(value.name ?? value.org_name ?? value.organization_name ?? value.display_name) || id
  return { id, name }
}

function fetchOrganizationPage(offset: number): Promise<unknown> {
  return rpcCall<unknown>('OrganizationService.ListOrg', {
    count: PAGE_SIZE,
    offset,
  })
}

export async function fetchOrganizations(): Promise<Organization[]> {
  const firstPage = await fetchOrganizationPage(0)
  const total = totalOf(firstPage)
  const organizations: Organization[] = []
  const seen = new Set<string>()

  const appendPage = (page: unknown) => {
    let added = 0
    organizationRows(page).forEach((row) => {
      const organization = normalizeOrganization(row)
      if (!organization || seen.has(organization.id)) return
      seen.add(organization.id)
      organizations.push(organization)
      added += 1
    })
    return added
  }

  appendPage(firstPage)
  while (organizations.length < total && organizations.length < MAX_ORGANIZATIONS) {
    const previousCount = organizations.length
    const page = await fetchOrganizationPage(organizations.length)
    if (!appendPage(page) || organizations.length === previousCount) break
  }

  return organizations.slice(0, MAX_ORGANIZATIONS)
}
