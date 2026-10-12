/**
 * Инфографика по процессам для кабинета руководителя.
 *
 * Панель показывает по одной карточке на процесс: сколько запусков завершено,
 * среднее/минимальное/максимальное время выполнения и столбики последних
 * запусков. Данные приходят готовыми записями
 * ([`src/metricsStore.js`](metricsStore.js)); панель ничего не знает про
 * движок и хранилище — так её можно рисовать и по метрикам из другого
 * источника.
 *
 * Пока измеряется одно — время выполнения; остальные метрики добавляются
 * плитками (`MetricTile`), а не переделкой макета.
 *
 * @param {Object} props
 * @param {Array<Object>} [props.runs] записи запусков (`loadRuns`).
 * @param {string} [props.preferredOrg] контур пользователя — его процесс первым.
 * @param {() => void} [props.onClear] обработчик кнопки «Очистить» (`null` —
 *   кнопки нет).
 * @param {number} [props.maxBars] сколько последних запусков рисовать.
 */

import React, { useMemo } from 'react';
import { BarChart2, Clock, Trash2 } from 'lucide-react';

import {
  BAR_HEIGHT_PX,
  MAX_BARS,
  barHeightPx,
  formatDuration,
  formatRunTime,
  groupRunsByProcess,
  recentCompletedRuns,
  summarizeRuns,
} from './metricsStore';

/** Названия контуров для бейджа карточки. */
const ORG_LABELS = {
  CUSTOMER: 'Заказчик',
  SUPPLIER: 'Поставщик',
};

/** Высота области столбиков, px: самый высокий столбик плюс подпись над ним. */
const CHART_HEIGHT_PX = BAR_HEIGHT_PX + 40;

/**
 * Плитка метрики: подпись и значение.
 *
 * @param {{label: string, value: string}} props подпись и значение.
 */
function MetricTile({ label, value }) {
  return (
    <div
      data-testid="metrics-tile"
      data-label={label}
      style={{
        flex: '1 1 74px',
        minWidth: '74px',
        padding: '6px 8px',
        backgroundColor: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '6px',
      }}
    >
      <div style={{ fontSize: '10px', color: '#64748b' }}>{label}</div>
      <div
        data-testid="metrics-value"
        style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Карточка одного процесса: подпись, плитки метрик и столбики запусков.
 *
 * @param {Object} props
 * @param {Object} props.group карточка из `groupRunsByProcess`.
 * @param {number} props.maxBars сколько последних запусков рисовать.
 */
function ProcessMetricsCard({ group, maxBars }) {
  const { summary } = group;
  const bars = recentCompletedRuns(group.runs, maxBars);
  const title = group.processName || group.processId || 'Процесс без имени';
  const orgLabel = ORG_LABELS[group.org] || 'Контур не указан';

  return (
    <div
      data-testid="metrics-process"
      data-process-id={group.processId}
      data-org={group.org}
      style={{
        padding: '12px',
        marginTop: '10px',
        backgroundColor: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '13px', color: '#0f172a' }}>{title}</strong>
        <span
          data-testid="metrics-org"
          style={{
            padding: '2px 6px',
            borderRadius: '10px',
            fontSize: '10px',
            fontWeight: '600',
            backgroundColor: '#eff6ff',
            color: '#1e40af',
          }}
        >
          {orgLabel}
        </span>
        {group.processId && (
          <span style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'monospace' }}>
            {group.processId}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '10px 0' }}>
        <MetricTile label="Выполнено" value={String(summary.completedCount)} />
        <MetricTile label="Среднее время" value={formatDuration(summary.averageMs)} />
        <MetricTile label="Минимум" value={formatDuration(summary.minMs)} />
        <MetricTile label="Максимум" value={formatDuration(summary.maxMs)} />
        {summary.activeCount > 0 && (
          <MetricTile label="В работе" value={String(summary.activeCount)} />
        )}
      </div>

      {bars.length === 0 ? (
        <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>
          Завершённых запусков пока нет: метрика появится, когда токен встанет на
          конечный узел процесса.
        </p>
      ) : (
        <>
          <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>
            Время выполнения (последние {bars.length}):
          </div>

          {/* Столбики и подписи — две строки с одинаковой раскладкой колонок:
              подпись не «съедает» высоту столбика, и наклонять её не нужно. */}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-end',
              height: `${CHART_HEIGHT_PX}px`,
              overflowX: 'auto',
            }}
          >
            {bars.map((run) => (
              <div
                key={run.id}
                style={{
                  flex: '1 1 0',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span style={{ fontSize: '10px', fontWeight: '600', color: '#475569' }}>
                  {formatDuration(run.durationMs)}
                </span>
                <div
                  data-testid="metrics-bar"
                  data-run-id={run.id}
                  title={`${run.orderNumber || run.id} · ${formatDuration(run.durationMs)} · старт ${formatRunTime(run.startedAt)} → финиш ${formatRunTime(run.finishedAt)}`}
                  style={{
                    width: '100%',
                    height: `${barHeightPx(run.durationMs, summary.maxMs)}px`,
                    backgroundColor: '#2563eb',
                    borderRadius: '3px 3px 0 0',
                  }}
                />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            {bars.map((run) => (
              <span
                key={run.id}
                style={{
                  flex: '1 1 0',
                  fontSize: '9px',
                  color: '#94a3b8',
                  textAlign: 'center',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {run.orderNumber || run.id}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Панель метрик: сводка по всем процессам и карточка на каждый из них.
 *
 * @param {Object} props см. описание модуля.
 */
export function MetricsPanel({
  runs = [],
  preferredOrg = '',
  onClear = null,
  maxBars = MAX_BARS,
}) {
  const groups = useMemo(
    () => groupRunsByProcess(runs, { preferredOrg }),
    [runs, preferredOrg]
  );
  const summary = useMemo(() => summarizeRuns(runs), [runs]);

  return (
    <section
      data-testid="metrics-panel"
      style={{
        padding: '12px 16px',
        marginBottom: '16px',
        backgroundColor: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <h4
          style={{
            margin: 0,
            fontSize: '13px',
            color: '#334155',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <BarChart2 size={16} color="#2563eb" /> Инфографика по процессам
        </h4>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            data-testid="metrics-total"
            style={{
              fontSize: '11px',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Clock size={12} /> Завершено: {summary.completedCount}
            {summary.activeCount > 0 ? ` · в работе: ${summary.activeCount}` : ''}
          </span>

          {onClear && (
            <button
              type="button"
              data-testid="metrics-clear"
              onClick={onClear}
              title="Забыть сохранённые метрики процессов"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                color: '#475569',
                backgroundColor: '#fff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              <Trash2 size={12} /> Очистить
            </button>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <p
          data-testid="metrics-empty"
          style={{ margin: '10px 0 0 0', fontSize: '11px', color: '#94a3b8' }}
        >
          Метрик пока нет: время выполнения сохраняется, когда процесс доходит до
          конечного события.
        </p>
      ) : (
        groups.map((group) => (
          <ProcessMetricsCard key={group.key} group={group} maxBars={maxBars} />
        ))
      )}

      <p
        data-testid="metrics-note"
        style={{ margin: '10px 0 0 0', fontSize: '10px', color: '#94a3b8' }}
      >
        Метрика считается от старта экземпляра до токена на конечном узле и хранится
        в браузере этого клиента.
      </p>
    </section>
  );
}

export default MetricsPanel;
