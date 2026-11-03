/**
 * `pathao_integrations` is admin-global (no business/store column). The
 * Integrations page only ever reads the non-secret display columns for a
 * read-only summary.
 */
export interface PathaoSummaryRow {
  id: string;
  name: string | null;
  environment: string | null;
  is_active: boolean;
}
