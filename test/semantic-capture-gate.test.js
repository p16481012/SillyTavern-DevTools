import assert from 'node:assert/strict';
import test from 'node:test';
import {
    SEMANTIC_CAPTURE_DECISION,
    SemanticCaptureGate,
    SemanticCaptureGateError,
} from '../src/semantic-capture-gate.js';

function deterministicCrypto() {
    let sequence = 0;
    return {
        getRandomValues(bytes) {
            sequence += 1;
            for (let index = 0; index < bytes.length; index += 1) {
                bytes[index] = (sequence + index) & 0xff;
            }
            return bytes;
        },
    };
}

test('chat and text captures require an exact prompt and unique nonce match', () => {
    const gate = new SemanticCaptureGate({ crypto: deterministicCrypto() });
    const chat = gate.arm({
        prompt: 'private semantic chat prompt',
        promptType: 'chat-completion',
    });
    const text = gate.arm({
        prompt: 'private semantic text prompt',
        promptType: 'text-completion',
    });

    assert.equal(
        gate.decide({
            phase: 'prompt',
            promptType: 'chat-completion',
            payload: [{
                role: 'user',
                content: `prefix\n${chat.prompt}\nsuffix`,
            }],
        }),
        SEMANTIC_CAPTURE_DECISION.SUPPRESS,
    );
    assert.equal(
        gate.decide({
            phase: 'prompt',
            promptType: 'text-completion',
            payload: `prefix\n${text.prompt}\nsuffix`,
        }),
        SEMANTIC_CAPTURE_DECISION.SUPPRESS,
    );

    const nearMatch = chat.prompt.replace('private semantic', 'near semantic');
    assert.equal(
        gate.decide({
            phase: 'prompt',
            promptType: 'chat-completion',
            payload: [{ role: 'user', content: nearMatch }],
        }),
        SEMANTIC_CAPTURE_DECISION.ALLOW,
    );
    assert.equal(
        gate.decide({
            phase: 'prompt',
            promptType: 'chat-completion',
            payload: [{ role: 'user', content: 'ordinary concurrent generation' }],
        }),
        SEMANTIC_CAPTURE_DECISION.ALLOW,
    );
});

test('request matching consumes once, suppresses exact duplicates, and flags ambiguity', () => {
    const gate = new SemanticCaptureGate({ crypto: deterministicCrypto() });
    const armed = gate.arm({
        prompt: 'semantic request',
        promptType: 'text-completion',
    });

    assert.equal(
        gate.decide({
            phase: 'request',
            promptType: 'chat-completion',
            payload: { prompt: 'unrelated chat request' },
        }),
        SEMANTIC_CAPTURE_DECISION.ALLOW,
    );
    assert.equal(
        gate.decide({
            phase: 'request',
            promptType: 'text-completion',
            payload: { prompt: 'id-less request without the marker' },
        }),
        SEMANTIC_CAPTURE_DECISION.AMBIGUOUS,
    );
    assert.equal(
        gate.decide({
            phase: 'request',
            promptType: 'text-completion',
            payload: { prompt: armed.prompt },
        }),
        SEMANTIC_CAPTURE_DECISION.SUPPRESS,
    );
    assert.equal(
        gate.decide({
            phase: 'request',
            promptType: 'text-completion',
            payload: { prompt: armed.prompt },
        }),
        SEMANTIC_CAPTURE_DECISION.SUPPRESS,
    );
    assert.equal(
        gate.decide({
            phase: 'request',
            promptType: 'text-completion',
            payload: { prompt: 'ordinary request after semantic request matched' },
        }),
        SEMANTIC_CAPTURE_DECISION.ALLOW,
    );
});

test('one capture containing multiple active semantic prompts suppresses and consumes all matches', () => {
    const gate = new SemanticCaptureGate({ crypto: deterministicCrypto() });
    const first = gate.arm({
        prompt: 'first concurrent semantic request',
        promptType: 'chat-completion',
    });
    const second = gate.arm({
        prompt: 'second concurrent semantic request',
        promptType: 'chat-completion',
    });
    const payload = [
        { role: 'user', content: first.prompt },
        { role: 'user', content: second.prompt },
    ];

    assert.equal(
        gate.decide({
            phase: 'prompt',
            promptType: 'chat-completion',
            payload,
        }),
        SEMANTIC_CAPTURE_DECISION.SUPPRESS,
    );
    assert.equal(
        gate.decide({
            phase: 'request',
            promptType: 'chat-completion',
            payload: { messages: payload },
        }),
        SEMANTIC_CAPTURE_DECISION.SUPPRESS,
    );
    assert.equal(
        gate.decide({
            phase: 'request',
            promptType: 'chat-completion',
            payload: { messages: [{ role: 'user', content: 'ordinary request' }] },
        }),
        SEMANTIC_CAPTURE_DECISION.ALLOW,
    );
});

test('tickets are opaque identity objects and disarm is identity-exact', () => {
    const gate = new SemanticCaptureGate({ crypto: deterministicCrypto() });
    const armed = gate.arm({
        prompt: 'opaque ticket',
        promptType: 'chat-completion',
    });

    assert.equal(Object.isFrozen(armed.ticket), true);
    assert.deepEqual(Object.keys(armed.ticket), []);
    assert.equal(gate.disarm(Object.freeze(Object.create(null))), false);
    assert.equal(gate.activeCount, 1);
    assert.equal(gate.disarm(armed.ticket), true);
    assert.equal(gate.activeCount, 0);
    assert.equal(
        gate.decide({
            phase: 'prompt',
            promptType: 'chat-completion',
            payload: [{ content: armed.prompt }],
        }),
        SEMANTIC_CAPTURE_DECISION.ALLOW,
    );
});

test('TTL expiry frees bounded capacity and expired prompts are not suppressed', () => {
    let now = 1_000;
    const gate = new SemanticCaptureGate({
        crypto: deterministicCrypto(),
        now: () => now,
        ttlMs: 20,
        maxActive: 1,
    });
    const first = gate.arm({
        prompt: 'first',
        promptType: 'chat-completion',
    });
    assert.throws(
        () => gate.arm({
            prompt: 'second',
            promptType: 'chat-completion',
        }),
        (value) => (
            value instanceof SemanticCaptureGateError
            && value.code === 'SEMANTIC_GATE_CAPACITY'
        ),
    );

    now += 21;
    assert.equal(gate.activeCount, 0);
    assert.equal(
        gate.decide({
            phase: 'prompt',
            promptType: 'chat-completion',
            payload: [{ content: first.prompt }],
        }),
        SEMANTIC_CAPTURE_DECISION.ALLOW,
    );
    assert.doesNotThrow(() => gate.arm({
        prompt: 'second',
        promptType: 'chat-completion',
    }));
});

test('TTL timer releases an active call without another gate operation', async () => {
    const gate = new SemanticCaptureGate({
        crypto: deterministicCrypto(),
        ttlMs: 8,
        maxActive: 1,
    });
    gate.arm({
        prompt: 'automatic expiry',
        promptType: 'chat-completion',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(gate.activeCount, 0);
});

test('bounded request scanning fails closed without invoking proxy traps unsafely', () => {
    const gate = new SemanticCaptureGate({ crypto: deterministicCrypto() });
    gate.arm({
        prompt: 'proxy-safe',
        promptType: 'chat-completion',
    });
    const hostile = new Proxy({}, {
        getPrototypeOf() {
            throw new Error('must not escape');
        },
    });

    assert.doesNotThrow(() => gate.decide({
        phase: 'request',
        promptType: 'chat-completion',
        payload: hostile,
    }));
    assert.equal(
        gate.decide({
            phase: 'request',
            promptType: 'chat-completion',
            payload: hostile,
        }),
        SEMANTIC_CAPTURE_DECISION.AMBIGUOUS,
    );
});

test('an incomplete bounded scan never allows a semantic prompt hidden after 256 strings', () => {
    const gate = new SemanticCaptureGate({ crypto: deterministicCrypto() });
    const armed = gate.arm({
        prompt: 'semantic prompt after the bounded prefix',
        promptType: 'chat-completion',
    });
    const messages = Array.from({ length: 130 }, (_, index) => ({
        role: 'user',
        content: `ordinary bounded prefix ${index}`,
    }));
    messages.push({ role: 'user', content: armed.prompt });

    assert.equal(
        gate.decide({
            phase: 'prompt',
            promptType: 'chat-completion',
            payload: messages,
        }),
        SEMANTIC_CAPTURE_DECISION.AMBIGUOUS,
    );
    assert.equal(
        gate.decide({
            phase: 'request',
            promptType: 'chat-completion',
            payload: { messages },
        }),
        SEMANTIC_CAPTURE_DECISION.AMBIGUOUS,
    );
    assert.equal(
        gate.decide({
            phase: 'prompt',
            promptType: 'chat-completion',
            payload: [{ role: 'user', content: 'ordinary short prompt' }],
        }),
        SEMANTIC_CAPTURE_DECISION.ALLOW,
    );
});
