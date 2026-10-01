import { validateState } from './extension/src/actions/validator/state.js';
import { validateAttestation } from './extension/src/actions/validator/attestation.js';

console.log("=== Testing Phase 4: State Validation (SPA Tolerance) ===");

const recentHashes = ['hash_1', 'hash_2', 'hash_3', 'hash_4', 'hash_5'];

// Test 1: Action matches the exact latest hash
const res1 = validateState({ page_state_hash: 'hash_5' } as any, recentHashes);
console.log("Test 1 (Matches latest hash):", res1.ok ? "PASS" : "FAIL", res1.reason || "");

// Test 2: Action matches an older hash in the buffer (SPA tolerance)
const res2 = validateState({ page_state_hash: 'hash_2' } as any, recentHashes);
console.log("Test 2 (Matches older hash):", res2.ok ? "PASS" : "FAIL", res2.reason || "");

// Test 3: Action hash is not in the buffer (Truly stale)
const res3 = validateState({ page_state_hash: 'hash_stale' } as any, recentHashes);
console.log("Test 3 (Stale Hash):", !res3.ok ? "PASS" : "FAIL", res3.reason || "");

// Test 4: Empty buffer
const res4 = validateState({ page_state_hash: 'hash_5' } as any, []);
console.log("Test 4 (Empty buffer):", !res4.ok ? "PASS" : "FAIL", res4.reason || "");

console.log("\n=== Testing Phase 4: Action Attestation ===");

async function runAttestationTests() {
    // Test 5: Valid attestation
    const res5 = await validateAttestation({ attestation: 'valid-signature-123' } as any);
    console.log("Test 5 (Valid Attestation):", res5.ok ? "PASS" : "FAIL", res5.reason || "");

    // Test 6: Invalid attestation
    const res6 = await validateAttestation({ attestation: 'invalid-signature' } as any);
    console.log("Test 6 (Invalid Attestation):", !res6.ok ? "PASS" : "FAIL", res6.reason || "");

    // Test 7: No attestation (allowed in current permissive mode)
    const res7 = await validateAttestation({ } as any);
    console.log("Test 7 (No Attestation):", res7.ok ? "PASS" : "FAIL", res7.reason || "");
}

runAttestationTests();
