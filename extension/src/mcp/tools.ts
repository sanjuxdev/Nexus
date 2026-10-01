import { z } from 'zod';
import { SafeTextParamSchema } from '@contracts/action-validator.js';

/**
 * Phase 5: Approved MCP Tool Definitions
 * 
 * Exposes ONLY the minimum approved tools for external agent communication:
 * 1. get_observation
 * 2. click
 * 3. type
 * 4. scroll
 * 5. keypress
 * 
 * Strict policy: Any unapproved tool is rejected.
 * Direct browser manipulation tools or raw access tools are strictly prohibited.
 */

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const APPROVED_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'get_observation',
    description: 'Retrieves the current sanitized, privacy-preserving observation of the active browser page.',
    inputSchema: {
      type: 'object',
      properties: {
        observation_id: {
          type: 'string',
          description: 'Optional observation ID to verify freshness',
        },
      },
      required: [],
    },
  },
  {
    name: 'click',
    description: 'Clicks an interactable target element identified in the sanitized observation.',
    inputSchema: {
      type: 'object',
      properties: {
        observation_id: {
          type: 'string',
          description: 'The observation ID from which the target was observed',
        },
        target_id: {
          type: 'string',
          description: 'The unique region/target ID of the element to click',
        },
        request_id: {
          type: 'string',
          description: 'Optional unique client request ID',
        },
      },
      required: ['observation_id', 'target_id'],
    },
  },
  {
    name: 'type',
    description: 'Types text into an interactable input element identified in the sanitized observation.',
    inputSchema: {
      type: 'object',
      properties: {
        observation_id: {
          type: 'string',
          description: 'The observation ID from which the target was observed',
        },
        target_id: {
          type: 'string',
          description: 'The unique region/target ID of the input element',
        },
        text: {
          type: 'string',
          description: 'The text string to type (injection-checked)',
        },
        request_id: {
          type: 'string',
          description: 'Optional unique client request ID',
        },
      },
      required: ['observation_id', 'target_id', 'text'],
    },
  },
  {
    name: 'scroll',
    description: 'Scrolls the page viewport in a specified direction.',
    inputSchema: {
      type: 'object',
      properties: {
        observation_id: {
          type: 'string',
          description: 'The observation ID to verify freshness',
        },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Scroll direction (default: down)',
        },
        amount: {
          type: 'number',
          description: 'Scroll amount in pixels (default: 500)',
        },
        request_id: {
          type: 'string',
          description: 'Optional unique client request ID',
        },
      },
      required: ['observation_id'],
    },
  },
  {
    name: 'keypress',
    description: 'Dispatches a keyboard event (e.g. Enter, Tab, Escape) to the page.',
    inputSchema: {
      type: 'object',
      properties: {
        observation_id: {
          type: 'string',
          description: 'The observation ID to verify freshness',
        },
        key: {
          type: 'string',
          description: 'Key identifier (e.g. Enter, Tab, ArrowDown)',
        },
        request_id: {
          type: 'string',
          description: 'Optional unique client request ID',
        },
      },
      required: ['observation_id', 'key'],
    },
  },
];

// Zod Input Schemas for Strict MCP Parameter Validation
export const GetObservationInputSchema = z.object({
  observation_id: z.string().optional(),
}).strict();

export const ClickInputSchema = z.object({
  observation_id: z.string().min(1, 'observation_id is required'),
  target_id: z.string().min(1, 'target_id is required'),
  request_id: z.string().optional(),
}).strict();

export const TypeInputSchema = z.object({
  observation_id: z.string().min(1, 'observation_id is required'),
  target_id: z.string().min(1, 'target_id is required'),
  text: SafeTextParamSchema,
  request_id: z.string().optional(),
}).strict();

export const ScrollInputSchema = z.object({
  observation_id: z.string().min(1, 'observation_id is required'),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  amount: z.number().int().min(1).max(10000).optional(),
  request_id: z.string().optional(),
}).strict();

export const KeypressInputSchema = z.object({
  observation_id: z.string().min(1, 'observation_id is required'),
  key: z.string().min(1).max(50),
  request_id: z.string().optional(),
}).strict();
