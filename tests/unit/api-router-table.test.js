import { describe, it, expect } from 'vitest';
import { handleApiRequest } from '../../functions/modules/api-router.js';

// Characterization tests for the route-table dispatch (issue #9). They pin the
// per-route response quirks the table must preserve byte-identically: the
// heterogeneous 405 shapes, the diagnostic 404 gate, the multi-path alias, and
// the global-gate semantics for unmatched paths. (Auth boundaries are covered
// by api-route-boundaries.test.js.)

function createKv(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        async get(key) { return values.get(key) ?? null; },
        async put(key, value) { values.set(key, value); },
        async delete(key) { values.delete(key); }
    };
}

const baseEnv = () => ({ MISUB_KV: createKv(), COOKIE_SECRET: 's', ADMIN_PASSWORD: 'pw' });

describe('api-router route table dispatch', () => {
    it('preserves the createErrorResponse-style 405 on a public method-gated route', async () => {
        const res = await handleApiRequest(new Request('https://x/api/public/guestbook', { method: 'PUT' }), baseEnv());
        expect(res.status).toBe(405);
        expect(await res.json()).toEqual({ success: false, error: 'Method Not Allowed', code: 'INTERNAL_ERROR', details: null });
    });

    it('serves both /public_config and /config aliases', async () => {
        const env = baseEnv();
        expect((await handleApiRequest(new Request('https://x/api/public_config'), env)).status).toBe(200);
        expect((await handleApiRequest(new Request('https://x/api/config'), env)).status).toBe(200);
    });

    it('404s diagnostic endpoints when ENABLE_AUTH_DIAGNOSTICS is off', async () => {
        const res = await handleApiRequest(new Request('https://x/api/auth_check', { method: 'POST' }), baseEnv());
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ success: false, error: 'Not Found', code: 'INTERNAL_ERROR', details: null });
    });

    it('keeps the object-style 405 on /auth_check (distinct from the string-style 405s)', async () => {
        const env = { ...baseEnv(), ENABLE_AUTH_DIAGNOSTICS: 'true' };
        const res = await handleApiRequest(new Request('https://x/api/auth_check', { method: 'GET' }), env);
        expect(res.status).toBe(405);
        expect(await res.json()).toEqual({ error: 'Method Not Allowed' });
    });

    it('applies the global auth gate to unmatched paths (401 when unauthenticated)', async () => {
        const res = await handleApiRequest(new Request('https://x/api/does_not_exist'), baseEnv());
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });
});
