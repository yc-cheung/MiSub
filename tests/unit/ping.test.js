import { afterEach, describe, expect, it, vi } from 'vitest';
import { pingNode } from '../../src/utils/ping.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pingNode — 可达性探测启发式', () => {
  it('极短时间内 reject 视为不可达（status=error），不再误报为可达', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1003);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('connection refused'))));

    const result = await pingNode('1.2.3.4', 443, 3000);

    expect(result.status).toBe('error');
  });

  it('经过一次网络往返后才 reject（耗时 >= 阈值）视为可达，返回 RTT', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1120);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('tls reset'))));

    const result = await pingNode('1.2.3.4', 443, 3000);

    expect(result.status).toBe('ok');
    expect(result.latency).toBe(120);
  });

  it('fetch 成功（opaque 响应）视为可达', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1050);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({})));

    const result = await pingNode('1.2.3.4', 443, 3000);

    expect(result.status).toBe('ok');
  });

  it('AbortError 视为超时', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1005);
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(abortErr)));

    const result = await pingNode('1.2.3.4', 443, 3000);

    expect(result.status).toBe('timeout');
  });

  it('缺少 host/port 直接返回 error', async () => {
    expect((await pingNode('', 443)).status).toBe('error');
    expect((await pingNode('1.2.3.4', '')).status).toBe('error');
  });
});
