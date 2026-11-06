/**
 * Clear-signing tools for AI agents: the MCP server, and the functions behind
 * its tools for use without MCP.
 */
export {
  createClearSigningServer,
  INSTRUCTIONS,
  SERVER_NAME,
} from "./server.js"
export {
  createContext,
  revocationClient,
  SERVICE_LINK,
  type ToolContext,
  type CreateContextOptions,
} from "./context.js"
export { loadConfig, ENVIRONMENT, type ServerConfig } from "./config.js"
export {
  clearSigningStatus,
  type StatusResult,
  type CalldataStatus,
  type TypedDataStatus,
} from "./status.js"
export {
  explainCalls,
  explainTypedData,
  type CallInput,
  type CallStatus,
  type ExplainedCall,
  type ExplainResult,
  type ExplainSignatureResult,
  type TypedDataInput,
} from "./explain.js"
export {
  simulate,
  decodeEvent,
  SimulationUnavailableError,
  type SimulationResult,
  type SimulatedCall,
  type SimulatedEvent,
  type AssetChange,
  type NftChange,
} from "./simulate.js"
export {
  checkAttestations,
  describeAttestation,
  DEFAULT_ATTESTERS,
  type Attester,
  type AttestationReport,
} from "./attestation.js"
export {
  RegistryClient,
  DEFAULT_REGISTRY,
  isRegistryPath,
  type RegistrySource,
} from "./registry.js"
export {
  SourcifyClient,
  DEFAULT_SOURCIFY_URL,
  type SourcifyReport,
} from "./sourcify.js"
export { ChainAccess, KNOWN_CHAINS, type RpcConfig } from "./chains.js"
export { plainDecode, type PlainDecode } from "./decode.js"
export {
  renderExplain,
  renderSignature,
  renderSimulation,
  renderStatus,
  DATA_NOTE,
} from "./render.js"
export { cleanText, cleanDeep, quote, isUnsafeCodePoint } from "./text.js"
export { VERSION } from "./version.js"
