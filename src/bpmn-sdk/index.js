/**
 * BPMN Client SDK — публичный API.
 *
 * Единственная точка входа для интеграции редактора и просмотрщика
 * BPMN-схем с оркестратором.
 *
 *   import { BpmnViewer, BpmnEditor, useBpmnEngine } from './bpmn-sdk';
 *
 * Стили подключаются здесь, чтобы потребителю барреля не нужно было
 * помнить про CSS-файл.
 */

import './styles/bpmn-sdk.css';

export * from './constants';
export * from './tokens';
export * from './xml/bpmnXml';
export * from './defaults/milkProcess';
export * from './client/httpClient';
export * from './client/wsClient';
export * from './hooks/useBpmnEngine';
export * from './hooks/useProcessTokens';
export * from './hooks/useTokenHighlight';
export * from './components/BpmnViewer';
export * from './components/BpmnEditor';
export * from './panels/EnginePanel';
