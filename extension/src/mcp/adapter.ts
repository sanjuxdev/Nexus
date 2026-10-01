import {
  APPROVED_MCP_TOOLS,
  McpToolDefinition,
  GetObservationInputSchema,
  ClickInputSchema,
  TypeInputSchema,
  ScrollInputSchema,
  KeypressInputSchema,
} from './tools.js';
import {
  ActionRequest,
  SupportedActionType,
} from '@contracts/action-validator.js';
import {
  ControlledExecutionBoundary,
  executionBoundary as defaultExecutionBoundary,
  ExecutionBoundaryResult,
} from '../security/execution-boundary.js';
import {
  ObservationContext,
} from '../security/action-validator.js';
import type { AgentObservation } from '../agent/protocol/observation.js';

/**
 * Phase 5: Local MCP Adapter
 * 
 * Adapts incoming Model Context Protocol (MCP) tool requests from external agents
 * (e.g. BrowserOS) into the existing Action Contract, Action Validator, and
 * Controlled Execution Boundary pipeline.
 * 
 * CRITICAL ARCHITECTURAL RULE:
 * MCP is an ADAPTER/INTERFACE, NOT an execution path.
 * 
 * Flow:
 * MCP Request
 *   ↓
 * Action Contract
 *   ↓
 * Action Validator
 *   ↓
 * Execution Ticket
 *   ↓
 * Controlled Execution Boundary
 *   ↓
 * Existing Action Executor
 * 
 * Bypassing the validator or execution boundary is strictly impossible.
 * Privacy boundary is preserved: only sanitized observations are exposed.
 */

export interface McpContentItem {
  type: 'text';
  text: string;
}

export interface McpToolCallResponse {
  content: McpContentItem[];
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SanitizedObservationData {
  observation: AgentObservation;
  context: ObservationContext;
}

export class LocalMcpAdapter {
  private executionBoundary: ControlledExecutionBoundary;
  private currentObservation: SanitizedObservationData | null = null;

  constructor(options?: {
    executionBoundary?: ControlledExecutionBoundary;
  }) {
    this.executionBoundary = options?.executionBoundary || defaultExecutionBoundary;
  }

  /**
   * Sets or updates the active sanitized observation.
   * Consumes only sanitized data from the existing privacy pipeline.
   * Rejects any raw screenshot or unredacted DOM representations.
   */
  public setSanitizedObservation(data: SanitizedObservationData | null): void {
    if (!data) {
      this.currentObservation = null;
      return;
    }

    // Defensive check: Ensure no raw visual or screenshot data crosses into MCP
    const obsAny = data.observation as any;
    if (obsAny.screenshot || obsAny.raw_dom || obsAny.raw_pixels) {
      throw new Error('Privacy Violation: Raw screenshot or DOM detected in sanitized observation payload');
    }

    this.currentObservation = data;
  }

  /**
   * Retrieves the list of approved MCP tools.
   */
  public listTools(): McpToolDefinition[] {
    return APPROVED_MCP_TOOLS;
  }

  /**
   * Handles an incoming MCP tool invocation.
   */
  public async callTool(name: string, rawArgs: unknown): Promise<McpToolCallResponse> {
    try {
      // 1. Tool authorization check
      const isApproved = APPROVED_MCP_TOOLS.some((t) => t.name === name);
      if (!isApproved) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Tool '${name}' is not recognized or not approved by the security boundary`,
            },
          ],
        };
      }

      // 2. Dispatch to dedicated handler
      switch (name) {
        case 'get_observation':
          return this.handleGetObservation(rawArgs);

        case 'click':
          return this.handleClick(rawArgs);

        case 'type':
          return this.handleType(rawArgs);

        case 'scroll':
          return this.handleScroll(rawArgs);

        case 'keypress':
          return this.handleKeypress(rawArgs);

        default:
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Unsupported tool handler: ${name}`,
              },
            ],
          };
      }
    } catch (err: any) {
      // Fail closed on any unhandled adapter exception
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `MCP Adapter Internal Error: ${err?.message || String(err)}`,
          },
        ],
      };
    }
  }

  /**
   * get_observation Handler
   * Exposes ONLY the existing sanitized observation representation.
   * Does NOT capture additional screenshots and does NOT touch raw DOM.
   */
  private handleGetObservation(rawArgs: unknown): McpToolCallResponse {
    const parseRes = GetObservationInputSchema.safeParse(rawArgs || {});
    if (!parseRes.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Malformed get_observation arguments: ${parseRes.error.issues[0]?.message}`,
          },
        ],
      };
    }

    if (!this.currentObservation) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'No active observation available from the perception pipeline',
          },
        ],
      };
    }

    const { observation, context } = this.currentObservation;

    // Check optional freshness requirement if observation_id was supplied
    if (parseRes.data.observation_id && parseRes.data.observation_id !== observation.cycle_id) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Requested observation_id '${parseRes.data.observation_id}' is stale. Active is '${observation.cycle_id}'`,
          },
        ],
      };
    }

    // Return the sanitized representation with safe targets
    const responsePayload = {
      observation_id: observation.cycle_id,
      page_state_hash: observation.page_state_hash,
      origin: observation.origin,
      url: observation.url,
      timestamp: observation.timestamp,
      targets: observation.regions.map((r) => ({
        target_id: r.region_id,
        type: r.type,
        text: r.text,
        interactable: r.interactable,
      })),
      history: observation.history || [],
    };

    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify(responsePayload, null, 2),
        },
      ],
      metadata: {
        observation_id: observation.cycle_id,
        target_count: observation.regions.length,
      },
    };
  }

  /**
   * click Handler
   */
  private async handleClick(rawArgs: unknown): Promise<McpToolCallResponse> {
    const parseRes = ClickInputSchema.safeParse(rawArgs);
    if (!parseRes.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Malformed click arguments: ${parseRes.error.issues[0]?.message}`,
          },
        ],
      };
    }

    const args = parseRes.data;
    const actionRequest: ActionRequest = {
      request_id: args.request_id || `mcp_click_${Date.now()}`,
      observation_id: args.observation_id,
      action: {
        type: 'click',
        target_id: args.target_id,
      },
      page_state_hash: this.currentObservation?.context.page_state_hash,
    };

    return this.dispatchThroughSecurityPipeline(actionRequest);
  }

  /**
   * type Handler
   */
  private async handleType(rawArgs: unknown): Promise<McpToolCallResponse> {
    const parseRes = TypeInputSchema.safeParse(rawArgs);
    if (!parseRes.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Malformed type arguments: ${parseRes.error.issues[0]?.message}`,
          },
        ],
      };
    }

    const args = parseRes.data;
    const actionRequest: ActionRequest = {
      request_id: args.request_id || `mcp_type_${Date.now()}`,
      observation_id: args.observation_id,
      action: {
        type: 'type',
        target_id: args.target_id,
        params: {
          text: args.text,
        },
      },
      page_state_hash: this.currentObservation?.context.page_state_hash,
    };

    return this.dispatchThroughSecurityPipeline(actionRequest);
  }

  /**
   * scroll Handler
   */
  private async handleScroll(rawArgs: unknown): Promise<McpToolCallResponse> {
    const parseRes = ScrollInputSchema.safeParse(rawArgs);
    if (!parseRes.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Malformed scroll arguments: ${parseRes.error.issues[0]?.message}`,
          },
        ],
      };
    }

    const args = parseRes.data;
    const actionRequest: ActionRequest = {
      request_id: args.request_id || `mcp_scroll_${Date.now()}`,
      observation_id: args.observation_id,
      action: {
        type: 'scroll',
        params: {
          direction: args.direction || 'down',
          amount: args.amount || 500,
        },
      },
      page_state_hash: this.currentObservation?.context.page_state_hash,
    };

    return this.dispatchThroughSecurityPipeline(actionRequest);
  }

  /**
   * keypress Handler
   */
  private async handleKeypress(rawArgs: unknown): Promise<McpToolCallResponse> {
    const parseRes = KeypressInputSchema.safeParse(rawArgs);
    if (!parseRes.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Malformed keypress arguments: ${parseRes.error.issues[0]?.message}`,
          },
        ],
      };
    }

    const args = parseRes.data;
    const actionRequest: ActionRequest = {
      request_id: args.request_id || `mcp_kp_${Date.now()}`,
      observation_id: args.observation_id,
      action: {
        type: 'keypress',
        params: {
          key: args.key,
        },
      },
      page_state_hash: this.currentObservation?.context.page_state_hash,
    };

    return this.dispatchThroughSecurityPipeline(actionRequest);
  }

  /**
   * Routes all action tool executions strictly through the Action Contract,
   * Action Validator, and Controlled Execution Boundary.
   * 
   * NEVER calls the browser or executor directly.
   */
  private async dispatchThroughSecurityPipeline(actionRequest: ActionRequest): Promise<McpToolCallResponse> {
    const context = this.currentObservation?.context;

    // Fails closed if no active observation context is available
    if (!context) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Execution denied: No active observation context available to validate against',
          },
        ],
      };
    }

    // Dispatch through the Controlled Execution Boundary
    const boundaryResult: ExecutionBoundaryResult = await this.executionBoundary.validateAndExecute(
      actionRequest,
      context
    );

    if (!boundaryResult.executed) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Action execution rejected: [${boundaryResult.error?.code || 'VALIDATION_DENIED'}] ${boundaryResult.error?.message || boundaryResult.verdict.reason}`,
          },
        ],
        metadata: {
          executed: false,
          code: boundaryResult.error?.code,
          reason: boundaryResult.verdict.reason,
        },
      };
    }

    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: `Action '${actionRequest.action.type}' executed successfully through security boundary.`,
        },
      ],
      metadata: {
        executed: true,
        action_id: boundaryResult.action_id,
        action_type: actionRequest.action.type,
      },
    };
  }

  /**
   * Standard JSON-RPC 2.0 interface for standard MCP client transports.
   */
  public async handleJsonRpc(rpcReq: { jsonrpc?: string; id?: string | number; method?: string; params?: any }): Promise<{ jsonrpc: '2.0'; id: string | number; result?: any; error?: any }> {
    const id = rpcReq?.id ?? null;
    if (rpcReq?.jsonrpc !== '2.0' || !rpcReq.method) {
      return {
        jsonrpc: '2.0',
        id: id as any,
        error: { code: -32600, message: 'Invalid Request: Must be JSON-RPC 2.0' },
      };
    }

    switch (rpcReq.method) {
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: id as any,
          result: { tools: this.listTools() },
        };

      case 'tools/call':
        if (!rpcReq.params?.name) {
          return {
            jsonrpc: '2.0',
            id: id as any,
            error: { code: -32602, message: 'Invalid params: tool name required' },
          };
        }
        const callRes = await this.callTool(rpcReq.params.name, rpcReq.params.arguments || {});
        return {
          jsonrpc: '2.0',
          id: id as any,
          result: callRes,
        };

      default:
        return {
          jsonrpc: '2.0',
          id: id as any,
          error: { code: -32601, message: `Method not found: ${rpcReq.method}` },
        };
    }
  }
}

export const localMcpAdapter = new LocalMcpAdapter();
