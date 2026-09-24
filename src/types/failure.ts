/**
 * The shape a failure takes once it has left RAM (#205).
 *
 * `FailureReport` (in `hooks/report-failure.ts`) carries `cause: unknown` —
 * whatever was thrown. That is exactly what cannot be stored: a `throw` can
 * carry a DOM node, an `AudioBuffer`, or a cyclic object, and structured-clone
 * refuses several of those outright while others would drag megabytes into the
 * log. So the sink renders the cause to text at the boundary and stores THIS,
 * which is plain data by construction.
 */

/**
 * One durable failure entry.
 *
 * Every field is a string or a number so the row structured-clones on any
 * engine and re-reads identically after an app update. Nothing here is ever
 * rendered to a translator — see #172 — it exists so a facilitator can carry
 * the log off the phone and a maintainer can read what actually broke.
 */
export interface StoredFailure {
  /** When the failure was reported, `Date.now()` at the sink. */
  readonly at: number;
  /** The reporting site's key: `"render"`, `"unhandled-rejection"`, … */
  readonly context: string;
  /**
   * The cause rendered to one line. Bounded — see `describeCause` — because a
   * thrown object can stringify to something arbitrarily large.
   */
  readonly message: string;
  /** The cause's own stack, when it had one. Bounded the same way. */
  readonly stack?: string;
  /** React's component tree for a render throw, when the report carried one. */
  readonly componentStack?: string;
}
