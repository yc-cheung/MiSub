import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Card from '../../src/components/ui/Card.vue';

function mountCard(misub) {
    return mount(Card, { props: { misub } });
}

const BASE = {
    id: 's1', name: 'A', url: 'https://airport.example/sub', enabled: true,
    lastUpdate: '2026-06-01T08:00:00.000Z', nodeCount: 12
};

describe('Card 保护性缓存徽标', () => {
    it('开启 enableNodeCache 且上次拉取失败时，显示「已用缓存」徽标', () => {
        const wrapper = mountCard({ ...BASE, enableNodeCache: true, lastError: 'HTTP 403: Forbidden' });
        expect(wrapper.find('[data-testid="protective-cache-badge"]').exists()).toBe(true);
        expect(wrapper.text()).toContain('已用缓存');
    });

    it('无 lastError（拉取正常）时不显示徽标', () => {
        const wrapper = mountCard({ ...BASE, enableNodeCache: true, lastError: null });
        expect(wrapper.find('[data-testid="protective-cache-badge"]').exists()).toBe(false);
    });

    it('未开启 enableNodeCache 时即使有错误也不显示徽标', () => {
        const wrapper = mountCard({ ...BASE, enableNodeCache: false, lastError: 'HTTP 403: Forbidden' });
        expect(wrapper.find('[data-testid="protective-cache-badge"]').exists()).toBe(false);
    });
});
