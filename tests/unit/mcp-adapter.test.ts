import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalMcpAdapter } from '../../extension/src/mcp/adapter.js';
import { APPROVED_MCP_TOOLS } from '../../extension/src/mcp/tools.js';
import {
  ControlledExecutionBoundary,
} from '../../extension/src/security/execution-boundary.js';
import {
  ActionValidator,
  ObservationContext,
  actionValidator,
} from '../../extension/src/security/action-validator.js';
import type { AgentObservation } from '../../extension/src/agent/protocol/observation.js';
import type { ExecResult, StructuredAction } from '../../contracts/ts/index.js';

describe('Phase 5: Local MCP Adapter Tests', () => {
  let mockExecutor: ReturnType<typeof vi.fn>;
  let boundary: ControlledExecutionBoundary;
  let mcp: LocalMcpAdapter;

  const validSanitizedObs: AgentObservation = {
    task_id: 'task_isro_01',
    cycle_id: 'obs_mcp_live_100',
    page_state_hash: 'hash_live_page_55',
    origin: 'http://localhost:3000',
    frame_id: 'main',
    url: 'http://localhost:3000/console',
    timestamp: Date.now(),
    regions: [
      {
        region_id: 'btn-launch',
        type: 'button',
        text: 'Initiate Sequence',
        interactable: true,
      },
      {
        region_id: 'input-coordinates',
        type: 'input',
        text: '',
        interactable: true,
      },
      {
        region_id: 'btn-disabled',
        type: 'button',
        text: 'Abort Sequence',
        interactable: false,
      },
    ],
    history: [],
  };

  const validContext: ObservationContext = {
    observation_id: 'obs_mcp_live_100',
    page_state_hash: 'hash_live_page_55',
    origin: 'http://localhost:3000',
    timestamp: Date.now(),
    ttl_ms: 15000,
    targets: {
      'btn-launch': {
        target_id: 'btn-launch',
        role: 'button',
        tag: 'button',
        bbox: [100, 100, 120, 40],
        visible: true,
        interactable: true,
        allowed_actions: ['click'],
      },
      'input-coordinates': {
        target_id: 'input-coordinates',
        role: 'textbox',
        tag: 'input',
        bbox: [100, 180, 200, 35],
        visible: true,
        interactable: true,
        allowed_actions: ['type', 'focus', 'click'],
      },
      'btn-disabled': {
        target_id: 'btn-disabled',
        role: 'button',
        bbox: [100, 250, 120, 40],
        visible: true,
        interactable: false,
        allowed_actions: ['click'],
      },
    },
  };

  beforeEach(() => {
    mockExecutor = vi.fn().mockResolvedValue({
      ok: true,
      action_id: 'exec_mcp_test',
      navigated: false,
      new_page_state_hash: 'hash_live_page_56',
    } as ExecResult);

    boundary = new ControlledExecutionBoundary({
      executor: mockExecutor,
    });

    mcp = new LocalMcpAdapter({
      executionBoundary: boundary,
    });

    mcp.setSanitizedObservation({
      observation: validSanitizedObs,
      context: validContext,
    });
  });

  // 1. Valid get_observation
  it('1. returns sanitized observation via get_observation tool', async () => {
    const res = await mcp.callTool('get_observation', {});
    expect(res.isError).toBeFalsy();
    expect(res.content[0].type).toBe('text');

    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.observation_id).toBe('obs_mcp_live_100');
    expect(parsed.page_state_hash).toBe('hash_live_page_55');
    expect(parsed.targets).toHaveLength(3);
    expect(parsed.targets[0].target_id).toBe('btn-launch');
  });

  // 2. Valid click
  it('2. maps valid click through validator and boundary to executor', async () => {
    const res = await mcp.callTool('click', {
      observation_id: 'obs_mcp_live_100',
      target_id: 'btn-launch',
    });

    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('executed successfully');
    expect(mockExecutor).toHaveBeenCalledTimes(1);

    const callArg: StructuredAction = mockExecutor.mock.calls[0][0];
    expect(callArg.action).toBe('click');
    expect(callArg.target?.region_id).toBe('btn-launch');
  });

  // 3. Valid type
  it('3. maps valid type through validator and boundary to executor', async () => {
    const res = await mcp.callTool('type', {
      observation_id: 'obs_mcp_live_100',
      target_id: 'input-coordinates',
      text: 'LAT 13.0827 LONG 80.2707',
    });

    expect(res.isError).toBeFalsy();
    expect(mockExecutor).toHaveBeenCalledTimes(1);

    const callArg: StructuredAction = mockExecutor.mock.calls[0][0];
    expect(callArg.action).toBe('type');
    expect(callArg.target?.region_id).toBe('input-coordinates');
    expect(callArg.params?.text).toBe('LAT 13.0827 LONG 80.2707');
  });

  // 4. Valid scroll
  it('4. maps valid scroll through validator and boundary to executor', async () => {
    const res = await mcp.callTool('scroll', {
      observation_id: 'obs_mcp_live_100',
      direction: 'down',
      amount: 450,
    });

    expect(res.isError).toBeFalsy();
    expect(mockExecutor).toHaveBeenCalledTimes(1);

    const callArg: StructuredAction = mockExecutor.mock.calls[0][0];
    expect(callArg.action).toBe('scroll');
    expect(callArg.params?.direction).toBe('down');
    expect(callArg.params?.amount).toBe(450);
  });

  // 5. Valid keypress
  it('5. maps valid keypress through validator and boundary to executor', async () => {
    const res = await mcp.callTool('keypress', {
      observation_id: 'obs_mcp_live_100',
      key: 'Enter',
    });

    expect(res.isError).toBeFalsy();
    expect(mockExecutor).toHaveBeenCalledTimes(1);

    const callArg: StructuredAction = mockExecutor.mock.calls[0][0];
    expect(callArg.action).toBe('keypress');
    expect(callArg.params?.key).toBe('Enter');
  });

  // 6. Malformed MCP request
  it('6. rejects malformed MCP request and NEVER executes', async () => {
    // Missing required target_id for click
    const res = await mcp.callTool('click', {
      observation_id: 'obs_mcp_live_100',
      // target_id missing!
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Malformed click arguments');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 7. Unknown MCP tool
  it('7. rejects unknown or unapproved MCP tool and NEVER executes', async () => {
    const res = await mcp.callTool('dangerous_eval', {
      code: 'console.log("hacked")',
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not recognized or not approved');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 8. Invalid target
  it('8. rejects action against nonexistent target and NEVER executes', async () => {
    const res = await mcp.callTool('click', {
      observation_id: 'obs_mcp_live_100',
      target_id: 'btn-ghost-nonexistent',
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('TARGET_NOT_FOUND');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 9. Stale observation
  it('9. rejects action against stale observation and NEVER executes', async () => {
    const res = await mcp.callTool('click', {
      observation_id: 'obs_stale_from_past_cycle',
      target_id: 'btn-launch',
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('STALE_OBSERVATION');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 10. Policy-denied action
  it('10. rejects policy-denied action (e.g. typing into a button) and NEVER executes', async () => {
    const res = await mcp.callTool('type', {
      observation_id: 'obs_mcp_live_100',
      target_id: 'btn-launch', // button allows only 'click'
      text: 'malicious input',
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('POLICY_DENIED');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 11. Replay attempt
  it('11. rejects ticket replay attempt and NEVER executes on replay', async () => {
    const validReq = {
      request_id: 'req_rep',
      observation_id: 'obs_mcp_live_100',
      action: { type: 'click', target_id: 'btn-launch' },
    };

    const verdict = actionValidator.validate(validReq, validContext);
    expect(verdict.allowed).toBe(true);

    if (verdict.allowed && verdict.ticket) {
      // First execution succeeds
      const exec1 = await boundary.executeValidated(verdict.ticket, validContext);
      expect(exec1.executed).toBe(true);
      expect(mockExecutor).toHaveBeenCalledTimes(1);

      // Replay attempt rejected
      const exec2 = await boundary.executeValidated(verdict.ticket, validContext);
      expect(exec2.executed).toBe(false);
      expect(exec2.error?.code).toBe('REPLAY_REJECTED');
      expect(mockExecutor).toHaveBeenCalledTimes(1); // Still 1!
    }
  });

  // 12. Missing execution ticket
  it('12. rejects execution attempt without an authentic ticket and NEVER executes', async () => {
    const execRes = await boundary.executeValidated(null, validContext);
    expect(execRes.executed).toBe(false);
    expect(execRes.error?.code).toBe('NO_VALIDATION_VERDICT');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 13. Direct execution bypass attempt
  it('13. rejects direct execution bypass attempt and NEVER executes', async () => {
    const bypassRes = await boundary.executeDirect({ action: 'click', target_id: 'btn-launch' });
    expect(bypassRes.executed).toBe(false);
    expect(bypassRes.error?.code).toBe('UNVALIDATED_EXECUTION_ATTEMPT');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 14. MCP cannot access raw unsanitized observation
  it('14. prevents MCP from ingesting raw unsanitized observation data', () => {
    const taintedObs: any = {
      ...validSanitizedObs,
      raw_dom: '<html><body><script>alert(1)</script></body></html>',
    };

    expect(() => {
      mcp.setSanitizedObservation({
        observation: taintedObs,
        context: validContext,
      });
    }).toThrow('Privacy Violation');
  });

  // 15. MCP cannot access raw screenshot
  it('15. verifies MCP observation response contains zero screenshot or pixel data', async () => {
    const res = await mcp.callTool('get_observation', {});
    const text = res.content[0].text;

    expect(text).not.toContain('screenshot');
    expect(text).not.toContain('base64');
    expect(text).not.toContain('data:image');
    expect(text).not.toContain('raw_pixels');

    const parsed = JSON.parse(text);
    expect(parsed.screenshot).toBeUndefined();
    expect(parsed.image).toBeUndefined();
  });

  // 16. MCP cannot bypass Action Validator
  it('16. verifies MCP cannot bypass Action Validator', async () => {
    const rejectingValidator = new ActionValidator();
    vi.spyOn(rejectingValidator, 'validate').mockReturnValue({
      allowed: false,
      reason: 'Strict validation policy block',
      code: 'POLICY_DENIED',
    });

    const guardedBoundary = new ControlledExecutionBoundary({
      validator: rejectingValidator,
      executor: mockExecutor,
    });

    const guardedMcp = new LocalMcpAdapter({
      executionBoundary: guardedBoundary,
    });
    guardedMcp.setSanitizedObservation({
      observation: validSanitizedObs,
      context: validContext,
    });

    const res = await guardedMcp.callTool('click', {
      observation_id: 'obs_mcp_live_100',
      target_id: 'btn-launch',
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('POLICY_DENIED');
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // 17. MCP cannot bypass ControlledExecutionBoundary
  it('17. verifies MCP cannot bypass ControlledExecutionBoundary', async () => {
    const rejectingBoundary = new ControlledExecutionBoundary({
      executor: mockExecutor,
    });
    vi.spyOn(rejectingBoundary, 'validateAndExecute').mockResolvedValue({
      executed: false,
      verdict: {
        allowed: false,
        reason: 'Execution boundary barricade triggered',
        code: 'UNVALIDATED_EXECUTION_ATTEMPT',
      },
      error: {
        code: 'UNVALIDATED_EXECUTION_ATTEMPT',
        message: 'Barricade active',
      },
    });

    const guardedMcp = new LocalMcpAdapter({
      executionBoundary: rejectingBoundary,
    });
    guardedMcp.setSanitizedObservation({
      observation: validSanitizedObs,
      context: validContext,
    });

    const res = await guardedMcp.callTool('click', {
      observation_id: 'obs_mcp_live_100',
      target_id: 'btn-launch',
    });

    expect(res.isError).toBe(true);
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  // SECURITY PROOF TEST
  it('SECURITY TEST: explicitly proves MCP -> Executor is impossible without Contract + Validator + Ticket + Execution Boundary', async () => {
    // Stage 1: Contract Failure (Script injection in type text)
    const injectionRes = await mcp.callTool('type', {
      observation_id: 'obs_mcp_live_100',
      target_id: 'input-coordinates',
      text: '<script>window.location="http://attacker.com"</script>',
    });
    expect(injectionRes.isError).toBe(true);
    expect(mockExecutor).not.toHaveBeenCalled();

    // Stage 2: Validator Failure (Target does not exist)
    const badTargetRes = await mcp.callTool('click', {
      observation_id: 'obs_mcp_live_100',
      target_id: 'btn-ghost',
    });
    expect(badTargetRes.isError).toBe(true);
    expect(mockExecutor).not.toHaveBeenCalled();

    // Stage 3: Missing/Forged Ticket at Boundary
    const fakeTicket = {
      ticket_id: 'forged_1',
      request_id: 'r1',
      observation_id: 'obs_mcp_live_100',
      action_type: 'click',
      signature: 'bad_sig',
    };
    const ticketBypassRes = await boundary.executeValidated(fakeTicket, validContext);
    expect(ticketBypassRes.executed).toBe(false);
    expect(mockExecutor).not.toHaveBeenCalled();

    // Stage 4: Only complete verified chain reaches executor
    const legitRes = await mcp.callTool('click', {
      observation_id: 'obs_mcp_live_100',
      target_id: 'btn-launch',
    });
    expect(legitRes.isError).toBeFalsy();
    expect(mockExecutor).toHaveBeenCalledTimes(1);
  });

  // JSON-RPC 2.0 Compliance Test
  it('supports standard MCP JSON-RPC 2.0 tools/list and tools/call protocol', async () => {
    // tools/list
    const listRes = await mcp.handleJsonRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(listRes.jsonrpc).toBe('2.0');
    expect(listRes.result.tools).toHaveLength(5);

    // tools/call
    const callRpcRes = await mcp.handleJsonRpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_observation',
        arguments: {},
      },
    });
    expect(callRpcRes.jsonrpc).toBe('2.0');
    expect(callRpcRes.result.isError).toBeFalsy();
  });
});
