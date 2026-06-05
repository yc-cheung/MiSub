import { NODE_PROTOCOL_REGEX } from '@/constants/nodeProtocols.js';
import { UNGROUPED_KEY } from './groups.js';
import { MANUAL_NODE_COUNTRY_ALIAS_MAP } from '@/constants/manualNodeCountryAliases.js';

export function isManualNodeEntry(item) {
  if (!item.url) return false;
  if (typeof item.url !== 'string') return false;

  const trimmedUrl = item.url.trim();
  if (!trimmedUrl) return false;

  if (/^https?:\/\//i.test(trimmedUrl)) return false;

  return NODE_PROTOCOL_REGEX.test(trimmedUrl);
}

export function filterManualNodes(nodes, searchTerm, activeColorFilter) {
  let filtered = nodes;

  if (activeColorFilter) {
    if (activeColorFilter === UNGROUPED_KEY) {
      filtered = filtered.filter(n => !n.group);
    } else {
      filtered = filtered.filter(n => n.group === activeColorFilter);
    }
  }

  if (!searchTerm) {
    return filtered;
  }

  const searchQuery = searchTerm.toLowerCase().trim();
  const alternativeTerms = MANUAL_NODE_COUNTRY_ALIAS_MAP[searchQuery] || [];

  return filtered.filter(node => {
    if (!node.name) return false;
    const nodeName = node.name.toLowerCase();
    if (nodeName.includes(searchQuery)) return true;
    for (const altTerm of alternativeTerms) {
      if (nodeName.includes(altTerm.toLowerCase())) return true;
    }
    return false;
  });
}
