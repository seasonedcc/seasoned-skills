import type { GeneratedFile, GenerationContext } from '../types.js'
import { composeSkill } from './compose.js'

/**
 * The mcp-server skill binds only where the configuration declares a machine
 * surface: the parity standard and the exception register it weaves in are
 * facts that exist only then, so without `machineSurface` the skill composes
 * to nothing rather than to doctrine with dangling paths.
 */
export function composeMcpServer(context: GenerationContext): GeneratedFile[] {
  const machineSurface = context.config.machineSurface
  if (!machineSurface) return []
  return [
    composeSkill('mcp-server', context, {
      tokens: {
        'parity-standard': machineSurface.parityStandard,
        'exception-register': machineSurface.exceptionRegister,
      },
    }),
  ]
}
