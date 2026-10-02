/**
 * SDK version and the versions it is tied to (ADR-0042 "Versioning").
 *
 * - `SDK_VERSION` follows semver. A manifest's `sdk` range must accept it,
 *   or the runner refuses the extension.
 * - Breaking changes to the hook, skill or adapter contracts bump the major.
 * - `PROTO_VERSION` must equal `protocol::PROTO_VERSION` of the client-wasm
 *   build the runner loads (it is read from `version()` at start-up).
 */
export const SDK_VERSION = "0.1.0";
export const PROTO_VERSION = 3;
/** `@swarm-press/content-schema` version whose page JSON skills produce. */
export const CONTENT_SCHEMA_VERSION = "1.0.0";
/** The manifest file every extension folder has. */
export const MANIFEST_FILE = "simpress.ext.json";
