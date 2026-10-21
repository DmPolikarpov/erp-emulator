/**
 * BPMN Client SDK — публичный API.
 *
 * Единственная точка входа для интеграции редактора и просмотрщика
 * BPMN-схем с оркестратором.
 *
 *   import { BpmnViewer, BpmnEditor, useBpmnEngine } from './bpmn-sdk';
 *
 * Стили подключаются здесь, чтобы потребителю барреля не нужно было
 * помнить про CSS-файл: сначала базовые стили холста `bpmn-js`/`diagram-js`,
 * затем стили SDK (они переопределяют базовые).
 *
 * CSS `bpmn-js` импортируется именно файлами, а не JS-прослойкой: пакет
 * SDK объявляет `sideEffects: ["*.css"]`, поэтому JS-модуль без экспортов
 * webpack вправе выбросить вместе с его импортами. Импорты CSS из
 * `index.js` (точки входа) сохраняются всегда, а сами CSS-файлы помечены
 * как «с побочными эффектами» в `package.json` пакета `bpmn-js`.
 */

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-codes.css';
// `bpmn-codes.css` выше задаёт иконкам только `content` (`\e8xx`), поэтому
// семейство шрифта к `.bpmn-icon-*` привязывает `bpmnFont.css` (там же и
// `@font-face`) — иначе глифы палитры рисуются fallback-шрифтом.
import './styles/bpmnFont.css';
import './styles/bpmn-sdk.css';

export * from './constants';
export * from './tokens';
export * from './xml/bpmnXml';
export * from './xml/triggerModdle';
export * from './xml/actionModdle';
export * from './xml/rolesModdle';
export * from './xml/projectXml';
export * from './defaults/milkProcess';
export * from './client/httpClient';
export * from './client/wsClient';
export * from './hooks/useBpmnEngine';
export * from './hooks/useProcessTokens';
export * from './hooks/useTokenHighlight';
export * from './components/BpmnViewer';
export * from './components/BpmnEditor';
export * from './panels/EnginePanel';
