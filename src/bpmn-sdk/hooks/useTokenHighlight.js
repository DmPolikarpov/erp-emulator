import { useMemo } from 'react';

import { collectActiveElementIds, resolveTokenMap } from '../tokens';

/**
 * Готовит данные подсветки для `BpmnViewer` из карты состояний токенов.
 *
 * @param {Object<string, string>} [tokens] карта `element_id -> состояние`.
 * @param {Object} [options]
 * @param {string|null} [options.activeElementId] активный узел (fallback).
 * @returns {{
 *   tokenMap: Object<string, string>,
 *   activeElementIds: string[],
 *   activeElementId: string|null
 * }}
 */
export function useTokenHighlight(tokens, options = {}) {
  const { activeElementId = null } = options;

  const tokenMap = useMemo(
    () => resolveTokenMap(tokens, activeElementId),
    [tokens, activeElementId]
  );

  const activeElementIds = useMemo(
    () => collectActiveElementIds(tokens),
    [tokens]
  );

  return {
    tokenMap,
    activeElementIds,
    activeElementId:
      activeElementIds.length > 0
        ? activeElementIds[activeElementIds.length - 1]
        : activeElementId,
  };
}
