/**
 * Тест вендорного бандла BPMN Client SDK (`src/vendor/bpmn-sdk`).
 *
 * Проверяет то, что не увидит `tools/verify.mjs` (там нет DOM):
 *  1. бандл загружается и отдаёт документированное публичное API;
 *  2. код бандла действительно исполняется (константы, утилиты, WS-разбор);
 *  3. React в бандле внешний: вторая копия React сломала бы хуки SDK
 *     («Invalid hook call»), поэтому реальный компонент рендерится на том же
 *     React, что и приложение;
 *  4. артефакт актуален исходникам SDK и не правился руками после сборки —
 *     «забыли пересобрать» падает в тестах, а не на стенде.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

const path = require('path');

const sdk = require('./bpmn-sdk');
const buildInfo = require('./bpmn-sdk/BUILD_INFO.json');
const { computeSourceHash, fileHash } = require('../bpmn-sdk/tools/lib/build-info.cjs');

/** Имена, на которые опираются приложение и документация SDK. */
const PUBLIC_API = [
  // компоненты
  'BpmnViewer',
  'BpmnEditor',
  'EnginePanel',
  // хуки
  'useBpmnEngine',
  'useProcessTokens',
  'useTokenHighlight',
  // транспорт
  'GatewayClient',
  'StatusSocket',
  'createUuid',
  'normalizeGatewayUrl',
  // константы
  'DEFAULT_CUSTOMER_BPMN_XML',
  'DEFAULT_SUPPLIER_BPMN_XML',
  'DEFAULT_GATEWAY_URL',
  'DEFAULT_WS_URL',
  'INSTANCE_PREFIX',
  'SOCKET_EVENTS',
  'TOKEN_STATES',
  'ENGINE_EVENTS',
  // логика токенов и XML
  'isDeployInstanceId',
  'parseTokenMessage',
  'resolveTokenMap',
  'applyTokenUpdate',
  'listFlowElements',
  'isValidXml',
];

describe('вендорный бандл BPMN Client SDK', () => {
  it('отдаёт документированный публичный API', () => {
    expect(PUBLIC_API.filter((name) => sdk[name] === undefined)).toEqual([]);
  });

  it('исполняет код бандла: константы, утилиты, разбор WS-сообщения', () => {
    expect(sdk.INSTANCE_PREFIX.CUSTOMER).toBe('inst-cust-');
    expect(sdk.INSTANCE_PREFIX.DEPLOY).toBe('inst-deploy-');
    expect(sdk.SOCKET_EVENTS.TOKEN).toBe('token');
    expect(sdk.TOKEN_STATES.ACTIVE).toBe('ACTIVE');
    expect(sdk.DEFAULT_CUSTOMER_BPMN_XML).toContain('Process_MilkCustomer_v1');
    expect(sdk.DEFAULT_SUPPLIER_BPMN_XML).toContain('Process_SupplierSupply_v1');

    expect(sdk.createUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(sdk.isDeployInstanceId('inst-deploy-customer')).toBe(true);
    expect(sdk.isDeployInstanceId('inst-cust-abc')).toBe(false);

    expect(
      sdk.parseTokenMessage(
        JSON.stringify({
          event: 'token_updated',
          instance_id: 'inst-cust-1',
          element_id: 'Task_A',
          state: 'ACTIVE',
        })
      )
    ).toMatchObject({ instanceId: 'inst-cust-1', elementId: 'Task_A', state: 'ACTIVE' });

    expect(sdk.resolveTokenMap({ Task_A: 'ACTIVE' })).toEqual({
      Task_A: 'bpmn-sdk-token--active',
    });
    expect(sdk.isValidXml(sdk.DEFAULT_CUSTOMER_BPMN_XML)).toBe(true);
  });

  it('рендерит компонент бандла на том же React, что и приложение', () => {
    render(
      <sdk.EnginePanel
        elements={[{ id: 'Task_Approve', name: 'Согласовать', type: 'bpmn:UserTask' }]}
        selectedElementId="Task_Approve"
      />
    );

    expect(screen.getByDisplayValue('Task_Approve')).toBeTruthy();
  });

  it('собран из текущих исходников SDK', () => {
    const { hash, count } = computeSourceHash();

    expect(`${buildInfo.sourceHash}/${buildInfo.sourceFileCount}`).toBe(`${hash}/${count}`);
  });

  it('не правился руками после сборки', () => {
    ['bpmn-sdk.umd.js', 'bpmn-sdk.umd.js.map'].forEach((name) => {
      const file = path.join(__dirname, 'bpmn-sdk', name);

      expect(fileHash(file)).toBe(buildInfo.artifacts[name].sha256);
    });
  });
});
