/**
 * Which repository the company writes to (increment G2, ADR-0047). The
 * session puts it on the boot screen (`showBootBinding`) and in the HUD
 * (`hudSite`), so it is always visible. Read only: the binding is the
 * server's configuration (`PATCH /api/companies/me` changes it, with the
 * lease), never the page's.
 */
import type { Company, SiteBinding } from '../net/central'

export interface SiteBindingView {
  /** `owner/name` of the site repository the gateway writes to. */
  repo: string
  baseBranch: string
  /**
   * The server's default for new companies when it is not this company's
   * binding (the owner changed it after the company was founded); null when
   * they agree or the server does not say.
   */
  serverDefault: { repo: string; baseBranch: string } | null
}

export function siteBindingView(company: Pick<Company, 'site_repo' | 'site_base_branch'>, serverDefault?: SiteBinding | null): SiteBindingView {
  const differs =
    !!serverDefault &&
    (serverDefault.site_repo.toLowerCase() !== company.site_repo.toLowerCase() || serverDefault.base_branch !== company.site_base_branch)
  return {
    repo: company.site_repo,
    baseBranch: company.site_base_branch,
    serverDefault: differs ? { repo: serverDefault.site_repo, baseBranch: serverDefault.base_branch } : null,
  }
}

/** One sentence: where the company writes, and the server's default when it differs. */
export function siteBindingText(v: SiteBindingView): string {
  const base = `Writes to ${v.repo} (base branch ${v.baseBranch}).`
  return v.serverDefault
    ? `${base} The server's default is ${v.serverDefault.repo} (${v.serverDefault.baseBranch}): this company was bound before it changed.`
    : base
}
