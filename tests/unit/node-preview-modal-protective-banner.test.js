import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const { post, get } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));

vi.mock('../../src/lib/http.js', () => ({
    api: { post, get },
    APIError: class APIError extends Error {}
}));

import NodePreviewModal from '../../src/components/modals/NodePreview/NodePreviewModal.vue';

const ONE_NODE = { name: 'HK-01', url: 'trojan://[email protected]:443#HK-01', protocol: 'trojan', region: '香港' };

function mountModal(props) {
    return mount(NodePreviewModal, {
        props: { show: true, ...props },
        global: { stubs: { Teleport: true } }
    });
}

describe('NodePreviewModal 保护性缓存横幅', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        post.mockReset();
        get.mockReset();
    });

    it('单点预览回退到缓存时显示「已用缓存」横幅', async () => {
        post.mockResolvedValue({
            success: true,
            nodes: [ONE_NODE],
            stats: { protocols: { trojan: 1 }, regions: { 香港: 1 } },
            fromCache: true,
            lastSuccess: '2026-06-01T00:00:00.000Z'
        });

        const wrapper = mountModal({ subscriptionId: 'sub-1', subscriptionName: '机场A' });
        await flushPromises();

        expect(wrapper.find('[data-testid="preview-protective-cache-banner"]').exists()).toBe(true);
        expect(wrapper.text()).toContain('已用缓存');
    });

    it('订阅组预览部分成员吃缓存时显示带数量的横幅', async () => {
        post.mockResolvedValue({
            success: true,
            nodes: [ONE_NODE],
            stats: { protocols: { trojan: 1 }, regions: { 香港: 1 } },
            fromCache: true,
            cachedSourceCount: 3
        });

        const wrapper = mountModal({ profileId: 'profile-1', profileName: '我的组' });
        await flushPromises();

        const banner = wrapper.find('[data-testid="preview-protective-cache-banner"]');
        expect(banner.exists()).toBe(true);
        expect(banner.text()).toContain('3');
    });

    it('正常拉取（无 fromCache）时不显示横幅', async () => {
        post.mockResolvedValue({
            success: true,
            nodes: [ONE_NODE],
            stats: { protocols: { trojan: 1 }, regions: { 香港: 1 } }
        });

        const wrapper = mountModal({ subscriptionId: 'sub-1', subscriptionName: '机场A' });
        await flushPromises();

        expect(wrapper.find('[data-testid="preview-protective-cache-banner"]').exists()).toBe(false);
    });
});
