import { buildProjectXml } from '../xml/projectXml';

/**
 * Проект «Молочный завод» — полный цикл заказа, закупки сырья, приёмки,
 * производства и отгрузки.
 *
 * Схема выросла из `wip/edvanced_dairy_plant.bpmn` (три пула: Клиент, Молочный
 * завод, Поставщик сырья). В проект вошли два процесса — завод и поставщик:
 * клиент в демо-кабинете не ведёт шагов, его роль играет кнопка старта завода
 * (`createOrder` на стартовом событии).
 *
 * Почему схему пришлось «разложить», а не положить как есть:
 *
 *  - движок разбирает только `startEvent`, `endEvent`, `userTask`,
 *    `serviceTask`, `exclusiveGateway` и `parallelGateway`
 *    (`ENGINE_FLOW_NODE_TYPES`); `sendTask`, `receiveTask`, `subProcess`,
 *    `boundaryEvent`, `intermediateThrowEvent` он не читает, и связи через них
 *    становятся висячими — определение не компилируется целиком;
 *  - `bpmn:messageFlow` между пулами движок не исполняет: обмен между сторонами
 *    идёт событиями оркестратора, поэтому в проекте сообщения заменены
 *    кнопками (`startsProcess`, `counterpartEvent`);
 *  - оркестратор однопроцессный (`bpm_engine_bpmn/src/parser.rs` читает первый
 *    `bpmn:process`), поэтому проект — это `bpmn:collaboration` с двумя
 *    процессами, а в движок уезжает нарезка (`extractProcessXml`).
 *
 * Как читается результат:
 *
 *  - дорожки (`bpmn:lane`) сохранены: по ним видно, кто ведёт шаг;
 *  - каждая задача несёт кнопки `act:userAction` — надпись, иконку, роль и
 *    узел, который станет активным после нажатия. Ветвление нарисовано
 *    `bpmn:exclusiveGateway`: у каждой «Да»-связи есть `conditionExpression`, а
 *    `default` указывает на негативную ветку, поэтому движок M1
 *    (`ENGINE_ROUTING=graph`) выбирает ветку сам. Кнопки объявляют те же
 *    значения через `variables` (`haveStock` → `stockSufficient=true`), так что
 *    `elementId` кнопки и маршрут графа совпадают — это проверяет
 *    `dairyPlant.test.js`;
 *  - процессные роли (`role:catalog`) — это вход в кабинет: 9 ролей завода и
 *    3 роли поставщика, руководители (`kind="EXECUTIVE"`) видят схему и метрики;
 *  - служебные задачи ERP (`Task_ERP_*`) объявлены `userTask`, а не
 *    `serviceTask`: у демо-клиента нет воркеров, и токен на `serviceTask`
 *    некому двигать. Контракт воркера — пункт дорожной карты
 *    (`docs/dairy-plant-roadmap.md`).
 *
 * Файл не зависит от DOM: это строки и чистая сборка проекта, поэтому модуль
 * работает и в браузере, и в Jest без `jsdom`.
 */

/** Идентификатор процесса завода (`bpmn:process/@id`). */
export const DAIRY_PLANT_PROCESS_ID = 'Process_Dairy';

/** Идентификатор процесса поставщика сырья. */
export const DAIRY_SUPPLIER_PROCESS_ID = 'Process_Supplier';

/** Имя проекта: подпись в списке проектов и в шапке кабинета. */
export const DAIRY_PLANT_PROJECT_NAME = 'Молочный завод: заказ → производство → отгрузка';

/** Код роли завода, которая ведёт заказ клиента. */
export const DAIRY_SALES_ROLE = 'SALES';


/**
 * Процесс завода: заказ клиента → закупка сырья → приёмка → производство →
 * склад ГП → отгрузка, с ветками брака и эскалациями в ERP.
 *
 * Координаты DI нарисованы «дорожками»: 20..1210 по вертикали, шаг дорожки
 * 150 px, производство занимает три ряда (норма / коррекция / авария). Проект
 * ставит второй процесс ниже на `PROJECT_ROW_OFFSET`, поэтому здесь начало
 * координат — верхняя дорожка.
 */
export const DAIRY_PLANT_PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:act="http://erp.mes/schema/bpmn/action"
                  xmlns:role="http://erp.mes/schema/bpmn/roles"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  id="Definitions_DairyPlant"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Dairy" name="Молочный завод: заказ, производство, отгрузка" isExecutable="true">
    <bpmn:extensionElements>
      <role:catalog id="RoleCatalog_Dairy">
        <role:businessRole code="DIRECTOR" title="Директор завода" kind="EXECUTIVE" icon="Crown" />
        <role:businessRole code="SALES" title="Менеджер по продажам" icon="Briefcase" />
        <role:businessRole code="PURCHASE" title="Менеджер по закупкам" icon="ShoppingCart" />
        <role:businessRole code="QC" title="Приёмка и лаборатория" icon="FlaskConical" />
        <role:businessRole code="WAREHOUSE" title="Склад сырья и ГП" icon="PackageCheck" />
        <role:businessRole code="PRODUCTION" title="Оператор линии" icon="Factory" />
        <role:businessRole code="TECHNOLOGIST" title="Технолог цеха" icon="ClipboardCheck" />
        <role:businessRole code="MAINTENANCE" title="Служба ТОиР" icon="Wrench" />
        <role:businessRole code="LOGISTICS" title="Логист" icon="Truck" />
      </role:catalog>
    </bpmn:extensionElements>

    <bpmn:laneSet id="LaneSet_Dairy">
      <bpmn:lane id="Lane_Sales" name="Менеджер по продажам">
        <bpmn:documentation>ДИ-МЕН-ПР-01: приём заказов, проверка кредитного лимита, резервирование ГП.</bpmn:documentation>
        <bpmn:flowNodeRef>Start_Dairy</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_ReceiveOrder</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_ProcessOrder</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_CheckStock</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_Stock</bpmn:flowNodeRef>
      </bpmn:lane>

      <bpmn:lane id="Lane_Purchase" name="Менеджер по закупкам">
        <bpmn:documentation>ДИ-МЕН-ЗАК-01: лимиты закупки, выбор поставщика, заказ сырья по EDI.</bpmn:documentation>
        <bpmn:flowNodeRef>Task_CreatePO</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_ApprovePO</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_SendPO</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_WaitPOConfirmed</bpmn:flowNodeRef>
      </bpmn:lane>

      <bpmn:lane id="Lane_QC" name="Приёмка и лаборатория">
        <bpmn:documentation>ДИ-ПРИЁМ-01 / ДИ-ЛАБ-01: приёмка молочного сырья, отбор проб, право отказа партии по ГОСТ.</bpmn:documentation>
        <bpmn:flowNodeRef>Task_ReceiveMilk</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_AcceptMilk</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_AnalyzeMilk</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_Quality</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_ReturnMilk</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Reject</bpmn:flowNodeRef>
      </bpmn:lane>

      <bpmn:lane id="Lane_Warehouse" name="Склад сырья и ГП">
        <bpmn:documentation>ДИ-КЛАД-01: учёт партий сырья в танках и приёмка паллет ГП в холодильную камеру (1С:ERP / WMS).</bpmn:documentation>
        <bpmn:flowNodeRef>Task_StoreMilk</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_StoreFG</bpmn:flowNodeRef>
      </bpmn:lane>

      <bpmn:lane id="Lane_Prod" name="Производство (Цех / MES)">
        <bpmn:documentation>ДИ-ОПЕР-01 / ДИ-ТЕХН-01: ведение технологического процесса в MES/SCADA, эскалация деградаций и аварий в ERP (ISA-95 L3 → L4).</bpmn:documentation>
        <bpmn:flowNodeRef>Tech_CleanCool</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Tech_Normalize</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Tech_Homogenize</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Tech_Pasteurize</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_PasteurizeOK</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Tech_Ferment</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Tech_CoolCheck</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_TechQC</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Tech_Pack</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_PackOutcome</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Tech_Rework</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Tech_LogDegradation</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_ERP_HandleDeviation</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_ERP_CriticalAlert</bpmn:flowNodeRef>
      </bpmn:lane>

      <bpmn:lane id="Lane_Logistics" name="Логистика">
        <bpmn:documentation>ДИ-ЛОГ-01: холодовая цепь, комплектация, УПД и ТТН.</bpmn:documentation>
        <bpmn:flowNodeRef>Task_Ship</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Main</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>

    <!-- Продажи: заказ клиента приходит сообщением, его принимает кнопка старта. -->
    <bpmn:startEvent id="Start_Dairy" name="Заказ клиента получен">
      <bpmn:extensionElements>
        <act:userAction id="createOrder" label="Принять заказ клиента" role="SALES" icon="PlusCircle" elementId="Task_ReceiveOrder" />
      </bpmn:extensionElements>
      <bpmn:outgoing>SF1</bpmn:outgoing>
    </bpmn:startEvent>

    <bpmn:userTask id="Task_ReceiveOrder" name="Принять заказ клиента">
      <bpmn:extensionElements>
        <act:userAction id="receiveOrder" label="Зарегистрировать заказ в 1С:УТ" role="SALES" icon="ClipboardCheck" elementId="Task_ProcessOrder" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-01: регистрация заказа в 1С:УТ, проверка реквизитов и номенклатуры.</bpmn:documentation>
      <bpmn:incoming>SF1</bpmn:incoming>
      <bpmn:outgoing>SF2</bpmn:outgoing>
      <bpmn:potentialOwner name="SALES" />
    </bpmn:userTask>

    <bpmn:userTask id="Task_ProcessOrder" name="Обработать заказ">
      <bpmn:extensionElements>
        <act:userAction id="processOrder" label="Проверить лимит и подтвердить сроки" role="SALES" icon="CheckCircle2" elementId="Task_CheckStock" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-02: проверка кредитного лимита, цен и скидок, подтверждение сроков поставки.</bpmn:documentation>
      <bpmn:incoming>SF2</bpmn:incoming>
      <bpmn:outgoing>SF3</bpmn:outgoing>
      <bpmn:potentialOwner name="SALES" />
    </bpmn:userTask>

    <bpmn:userTask id="Task_CheckStock" name="Проверить остатки ГП">
      <bpmn:extensionElements>
        <act:userAction id="haveStock" label="ГП хватает — отгрузить со склада" role="SALES" icon="Truck" elementId="Task_Ship" variables="stockSufficient=true" />
        <act:userAction id="needPurchase" label="ГП не хватает — закупить сырьё" role="SALES" icon="ShoppingCart" elementId="Task_CreatePO" variables="stockSufficient=false" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-03: запрос остатков готовой продукции в 1С:ERP и оценка покрытия заказа.</bpmn:documentation>
      <bpmn:incoming>SF3</bpmn:incoming>
      <bpmn:outgoing>SF4</bpmn:outgoing>
      <bpmn:potentialOwner name="SALES" />
    </bpmn:userTask>

    <bpmn:exclusiveGateway id="Gateway_Stock" name="Хватает ГП?" default="SF5">
      <bpmn:incoming>SF4</bpmn:incoming>
      <bpmn:outgoing>SF5</bpmn:outgoing>
      <bpmn:outgoing>SF6</bpmn:outgoing>
    </bpmn:exclusiveGateway>

    <!-- Закупки: заказ на сырьё уходит поставщику и запускает его процесс. -->
    <bpmn:userTask id="Task_CreatePO" name="Создать заказ сырья">
      <bpmn:extensionElements>
        <act:userAction id="createPO" label="Рассчитать потребность и создать заказ" role="PURCHASE" icon="FileText" elementId="Task_ApprovePO" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-04: расчёт потребности в сырье, выбор поставщика, черновик заказа.</bpmn:documentation>
      <bpmn:incoming>SF5</bpmn:incoming>
      <bpmn:outgoing>SF7</bpmn:outgoing>
      <bpmn:potentialOwner name="PURCHASE" />
    </bpmn:userTask>

    <bpmn:userTask id="Task_ApprovePO" name="Согласовать закупку">
      <bpmn:extensionElements>
        <act:userAction id="approvePO" label="Согласовать в пределах лимита" role="PURCHASE" icon="CheckCircle2" elementId="Task_SendPO" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-05: проверка лимита, цены и условий; ДИ-РУК-01 — право подписи.</bpmn:documentation>
      <bpmn:incoming>SF7</bpmn:incoming>
      <bpmn:outgoing>SF8</bpmn:outgoing>
      <bpmn:potentialOwner name="PURCHASE" />
    </bpmn:userTask>

    <bpmn:userTask id="Task_SendPO" name="Отправить заказ поставщику">
      <bpmn:extensionElements>
        <act:userAction id="sendToSupplier" label="Отправить заказ поставщику" role="PURCHASE" icon="Send" elementId="Task_WaitPOConfirmed" startsProcess="Process_Supplier" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-06: отправка через EDI / e-mail и запуск процесса поставщика (startsProcess).</bpmn:documentation>
      <bpmn:incoming>SF8</bpmn:incoming>
      <bpmn:outgoing>SF9</bpmn:outgoing>
      <bpmn:potentialOwner name="PURCHASE" />
    </bpmn:userTask>

    <bpmn:userTask id="Task_WaitPOConfirmed" name="Ожидание подтверждения заказа">
      <bpmn:extensionElements>
        <act:userAction id="poConfirmed" label="Подтверждение получено" role="PURCHASE" icon="PackageCheck" elementId="Task_ReceiveMilk" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-П-01 со стороны завода: сверка объёмов, сроков и цены с подтверждением поставщика.</bpmn:documentation>
      <bpmn:incoming>SF9</bpmn:incoming>
      <bpmn:outgoing>SF10</bpmn:outgoing>
      <bpmn:potentialOwner name="PURCHASE" />
    </bpmn:userTask>

    <!-- Приёмка и лаборатория -->
    <bpmn:userTask id="Task_ReceiveMilk" name="Принять партию молока">
      <bpmn:extensionElements>
        <act:userAction id="acceptTruck" label="Проверить ТТН, пломбы и температуру" role="QC" icon="Truck" elementId="Task_AcceptMilk" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-07: приём машины с сырьём, проверка ТТН, пломб и температуры.</bpmn:documentation>
      <bpmn:incoming>SF10</bpmn:incoming>
      <bpmn:outgoing>SF11</bpmn:outgoing>
      <bpmn:potentialOwner name="QC" />
    </bpmn:userTask>

    <bpmn:userTask id="Task_AcceptMilk" name="Взвесить и отобрать пробы">
      <bpmn:extensionElements>
        <act:userAction id="sampleMilk" label="Взвесить и отобрать пробы по ГОСТ" role="QC" icon="ClipboardCheck" elementId="Task_AnalyzeMilk" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-08: взвешивание, отбор проб по ГОСТ 26809, регистрация в журнале.</bpmn:documentation>
      <bpmn:incoming>SF11</bpmn:incoming>
      <bpmn:outgoing>SF12</bpmn:outgoing>
      <bpmn:potentialOwner name="QC" />
    </bpmn:userTask>

    <bpmn:userTask id="Task_AnalyzeMilk" name="Лабораторный анализ">
      <bpmn:extensionElements>
        <act:userAction id="qualityPassed" label="ГОСТ ОК — оприходовать партию" role="QC" icon="CheckCircle2" elementId="Task_StoreMilk" variables="labPassed=true" />
        <act:userAction id="qualityRejected" label="Брак — оформить возврат" role="QC" icon="AlertCircle" elementId="Task_ReturnMilk" variables="labPassed=false" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-09: жирность, белок, кислотность, антибиотики, КМАФАнМ.</bpmn:documentation>
      <bpmn:incoming>SF12</bpmn:incoming>
      <bpmn:outgoing>SF13</bpmn:outgoing>
      <bpmn:potentialOwner name="QC" />
    </bpmn:userTask>

    <bpmn:exclusiveGateway id="Gateway_Quality" name="ГОСТ ОК?" default="SF15">
      <bpmn:incoming>SF13</bpmn:incoming>
      <bpmn:outgoing>SF14</bpmn:outgoing>
      <bpmn:outgoing>SF15</bpmn:outgoing>
    </bpmn:exclusiveGateway>

    <bpmn:userTask id="Task_ReturnMilk" name="Оформить возврат">
      <bpmn:extensionElements>
        <act:userAction id="returnMilk" label="Составить акт несоответствия" role="QC" icon="FileText" elementId="End_Reject" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-10: акт несоответствия, возврат партии, уведомление закупок.</bpmn:documentation>
      <bpmn:incoming>SF15</bpmn:incoming>
      <bpmn:outgoing>SF16</bpmn:outgoing>
      <bpmn:potentialOwner name="QC" />
    </bpmn:userTask>

    <bpmn:endEvent id="End_Reject" name="Партия отклонена">
      <bpmn:incoming>SF16</bpmn:incoming>
    </bpmn:endEvent>

    <!-- Склад сырья и ГП -->
    <bpmn:userTask id="Task_StoreMilk" name="Оприходовать сырьё на склад">
      <bpmn:extensionElements>
        <act:userAction id="storeMilk" label="Присвоить номер партии в 1С:ERP" role="WAREHOUSE" icon="PackageCheck" elementId="Tech_CleanCool" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-11: номер партии в 1С:ERP, размещение в танке сырого молока, передача лимита в цех.</bpmn:documentation>
      <bpmn:incoming>SF14</bpmn:incoming>
      <bpmn:outgoing>SF17</bpmn:outgoing>
      <bpmn:potentialOwner name="WAREHOUSE" />
    </bpmn:userTask>

    <bpmn:userTask id="Task_StoreFG" name="Принять ГП в холодильную камеру">
      <bpmn:extensionElements>
        <act:userAction id="storeFG" label="Разместить паллеты и допустить к отгрузке" role="WAREHOUSE" icon="PackageCheck" elementId="Task_Ship" />
      </bpmn:extensionElements>
      <bpmn:documentation>ТИ-01.8 / СОП-13.2: приём паллет из цеха, выдержка при 4±2 °C, статус «Допущено к отгрузке».</bpmn:documentation>
      <bpmn:incoming>SF18_ToWarehouse</bpmn:incoming>
      <bpmn:outgoing>SF19</bpmn:outgoing>
      <bpmn:potentialOwner name="WAREHOUSE" />
    </bpmn:userTask>

    <!-- Производство, ряд «норма»: MES ведёт технологический процесс. -->
    <bpmn:userTask id="Tech_CleanCool" name="Очистка и охлаждение">
      <bpmn:extensionElements>
        <act:userAction id="cleanCool" label="Очистка и охлаждение выполнены" role="PRODUCTION" icon="CheckCircle2" elementId="Tech_Normalize" />
      </bpmn:extensionElements>
      <bpmn:documentation>ТИ-01.2: фильтрация, центробежная очистка, охлаждение до 4 °C.</bpmn:documentation>
      <bpmn:incoming>SF17</bpmn:incoming>
      <bpmn:outgoing>SF20_Clean</bpmn:outgoing>
      <bpmn:potentialOwner name="PRODUCTION" />
    </bpmn:userTask>

    <bpmn:userTask id="Tech_Normalize" name="Нормализация">
      <bpmn:extensionElements>
        <act:userAction id="normalize" label="Жирность приведена к рецептуре" role="TECHNOLOGIST" icon="CheckCircle2" elementId="Tech_Homogenize" />
      </bpmn:extensionElements>
      <bpmn:documentation>ТИ-01.3: нормализация по жиру и белку, баланс сухих веществ.</bpmn:documentation>
      <bpmn:incoming>SF20_Clean</bpmn:incoming>
      <bpmn:outgoing>SF21_Norm</bpmn:outgoing>
      <bpmn:potentialOwner name="TECHNOLOGIST" />
    </bpmn:userTask>

    <bpmn:userTask id="Tech_Homogenize" name="Гомогенизация">
      <bpmn:extensionElements>
        <act:userAction id="homogenize" label="Давление гомогенизации в норме" role="PRODUCTION" icon="CheckCircle2" elementId="Tech_Pasteurize" />
      </bpmn:extensionElements>
      <bpmn:documentation>ТИ-01.4: гомогенизация при 15–20 МПа, контроль дисперсности жира.</bpmn:documentation>
      <bpmn:incoming>SF21_Norm</bpmn:incoming>
      <bpmn:outgoing>SF22_Homog</bpmn:outgoing>
      <bpmn:potentialOwner name="PRODUCTION" />
    </bpmn:userTask>

    <bpmn:userTask id="Tech_Pasteurize" name="Пастеризация">
      <bpmn:extensionElements>
        <act:userAction id="pasteurizeDone" label="Режим выдержан, продукт пастеризован" role="TECHNOLOGIST" icon="CheckCircle2" elementId="Tech_Ferment" variables="pasteurizeOk=true" />
        <act:userAction id="pasteurizeCrash" label="Авария ПОУ — эскалация в ERP" role="TECHNOLOGIST" icon="AlertCircle" elementId="Task_ERP_CriticalAlert" variables="pasteurizeOk=false" />
      </bpmn:extensionElements>
      <bpmn:documentation>ТИ-01.5: пастеризация 85±2 °C с выдержкой 15–20 с; при отказе ПОУ — останов линии.</bpmn:documentation>
      <bpmn:incoming>SF22_Homog</bpmn:incoming>
      <bpmn:outgoing>SF23_Past</bpmn:outgoing>
      <bpmn:potentialOwner name="TECHNOLOGIST" />
    </bpmn:userTask>

    <bpmn:exclusiveGateway id="Gateway_PasteurizeOK" name="Режим выдержан?" default="SF_T5_No">
      <bpmn:incoming>SF23_Past</bpmn:incoming>
      <bpmn:outgoing>SF_T5</bpmn:outgoing>
      <bpmn:outgoing>SF_T5_No</bpmn:outgoing>
    </bpmn:exclusiveGateway>

    <bpmn:userTask id="Tech_Ferment" name="Ферментация / сквашивание">
      <bpmn:extensionElements>
        <act:userAction id="ferment" label="Сквашивание завершено" role="TECHNOLOGIST" icon="CheckCircle2" elementId="Tech_CoolCheck" />
      </bpmn:extensionElements>
      <bpmn:documentation>ТИ-01.6: внесение закваски, термостатирование, контроль титруемой кислотности.</bpmn:documentation>
      <bpmn:incoming>SF_T5</bpmn:incoming>
      <bpmn:outgoing>SF_T6</bpmn:outgoing>
      <bpmn:potentialOwner name="TECHNOLOGIST" />
    </bpmn:userTask>

    <bpmn:userTask id="Tech_CoolCheck" name="Охлаждение и технологический контроль">
      <bpmn:extensionElements>
        <act:userAction id="techQCPassed" label="Партия соответствует ТУ" role="TECHNOLOGIST" icon="CheckCircle2" elementId="Tech_Pack" variables="techQcPassed=true" />
        <act:userAction id="techQCFailed" label="Отклонение ТУ — на переработку" role="TECHNOLOGIST" icon="AlertCircle" elementId="Tech_Rework" variables="techQcPassed=false" />
      </bpmn:extensionElements>
      <bpmn:documentation>ТИ-01.7: охлаждение, контроль кислотности, вкуса и консистенции.</bpmn:documentation>
      <bpmn:incoming>SF_T6</bpmn:incoming>
      <bpmn:outgoing>SF_T7</bpmn:outgoing>
      <bpmn:potentialOwner name="TECHNOLOGIST" />
    </bpmn:userTask>

    <bpmn:exclusiveGateway id="Gateway_TechQC" name="ТУ соблюдены?" default="SF_T8_No">
      <bpmn:incoming>SF_T7</bpmn:incoming>
      <bpmn:outgoing>SF_T8_Yes</bpmn:outgoing>
      <bpmn:outgoing>SF_T8_No</bpmn:outgoing>
    </bpmn:exclusiveGateway>

    <bpmn:userTask id="Tech_Pack" name="Розлив и упаковка">
      <bpmn:extensionElements>
        <act:userAction id="packCompleted" label="Партия упакована и промаркирована" role="PRODUCTION" icon="PackageCheck" elementId="Task_StoreFG" variables="packOutcome=good" />
        <act:userAction id="packDegraded" label="Деградация линии — коррекция" role="PRODUCTION" icon="AlertCircle" elementId="Tech_LogDegradation" variables="packOutcome=degraded" />
        <act:userAction id="packCrashed" label="Останов линии — эскалация в ERP" role="PRODUCTION" icon="AlertCircle" elementId="Task_ERP_CriticalAlert" variables="packOutcome=crash" />
      </bpmn:extensionElements>
      <bpmn:documentation>ТИ-01.8: фасовка, маркировка партии и даты, передача на склад ГП.</bpmn:documentation>
      <bpmn:incoming>SF_T8_Yes</bpmn:incoming>
      <bpmn:outgoing>SF_T10</bpmn:outgoing>
      <bpmn:potentialOwner name="PRODUCTION" />
    </bpmn:userTask>

    <bpmn:exclusiveGateway id="Gateway_PackOutcome" name="Итог упаковки?" default="SF_T_Err2">
      <bpmn:incoming>SF_T10</bpmn:incoming>
      <bpmn:outgoing>SF18_ToWarehouse</bpmn:outgoing>
      <bpmn:outgoing>SF_T_Esc1</bpmn:outgoing>
      <bpmn:outgoing>SF_T_Err2</bpmn:outgoing>
    </bpmn:exclusiveGateway>

    <!-- Производство, ряд «коррекция»: брак и деградация линии. -->
    <bpmn:userTask id="Tech_Rework" name="Переработка партии">
      <bpmn:extensionElements>
        <act:userAction id="rework" label="Оформить брак и остановить партию" role="TECHNOLOGIST" icon="AlertCircle" elementId="End_TechDefect" />
      </bpmn:extensionElements>
      <bpmn:documentation>ТИ-01.9: партия не соответствует ТУ, передача на переработку или списание.</bpmn:documentation>
      <bpmn:incoming>SF_T8_No</bpmn:incoming>
      <bpmn:outgoing>SF_T9_Reject</bpmn:outgoing>
      <bpmn:potentialOwner name="TECHNOLOGIST" />
    </bpmn:userTask>

    <bpmn:endEvent id="End_TechDefect" name="Партия отправлена на переработку">
      <bpmn:incoming>SF_T9_Reject</bpmn:incoming>
    </bpmn:endEvent>

    <bpmn:userTask id="Tech_LogDegradation" name="Зафиксировать деградацию линии">
      <bpmn:extensionElements>
        <act:userAction id="logDegradation" label="Зарегистрировать отклонение в MES" role="PRODUCTION" icon="FileText" elementId="Task_ERP_HandleDeviation" />
      </bpmn:extensionElements>
      <bpmn:documentation>ТИ-01.10: регистрация отклонения (OEE, простои, параметры) для анализа в ERP.</bpmn:documentation>
      <bpmn:incoming>SF_T_Esc1</bpmn:incoming>
      <bpmn:outgoing>SF_T_Esc2</bpmn:outgoing>
      <bpmn:potentialOwner name="PRODUCTION" />
    </bpmn:userTask>

    <bpmn:userTask id="Task_ERP_HandleDeviation" name="Обработать отклонение в ERP">
      <bpmn:extensionElements>
        <act:userAction id="applyDeviation" label="Скорректировать мощность и завести заявку ТОиР" role="MAINTENANCE" icon="Wrench" elementId="End_ERP_DeviationLogged" />
      </bpmn:extensionElements>
      <bpmn:documentation>ERP-L4: корректировка производственного заказа, заявка ТОиР, пересчёт себестоимости партии.</bpmn:documentation>
      <bpmn:incoming>SF_T_Esc2</bpmn:incoming>
      <bpmn:outgoing>SF_T_Esc3</bpmn:outgoing>
      <bpmn:potentialOwner name="MAINTENANCE" />
    </bpmn:userTask>

    <bpmn:endEvent id="End_ERP_DeviationLogged" name="Отклонение закрыто в ERP">
      <bpmn:incoming>SF_T_Esc3</bpmn:incoming>
    </bpmn:endEvent>

    <!-- Производство, ряд «авария»: критический отказ требует остановки заказов. -->
    <bpmn:userTask id="Task_ERP_CriticalAlert" name="Критическая авария в ERP">
      <bpmn:extensionElements>
        <act:userAction id="escalateCritical" label="Остановить линию и заказы, уведомить директора" role="DIRECTOR" icon="AlertCircle" elementId="End_ERP_Aborted" />
      </bpmn:extensionElements>
      <bpmn:documentation>ERP-L4 / ДИ-РУК-02: остановка заказов, уведомление директора, план восстановления.</bpmn:documentation>
      <bpmn:incoming>SF_T_Err2</bpmn:incoming>
      <bpmn:incoming>SF_T5_No</bpmn:incoming>
      <bpmn:outgoing>SF_T_Err3</bpmn:outgoing>
      <bpmn:potentialOwner name="DIRECTOR" />
    </bpmn:userTask>

    <bpmn:endEvent id="End_ERP_Aborted" name="Производство остановлено">
      <bpmn:incoming>SF_T_Err3</bpmn:incoming>
    </bpmn:endEvent>

    <!-- Логистика: холодовая цепь и закрывающие документы. -->
    <bpmn:userTask id="Task_Ship" name="Отгрузить готовую продукцию">
      <bpmn:extensionElements>
        <act:userAction id="shipGoods" label="Скомплектовать, оформить УПД и ТТН" role="LOGISTICS" icon="Truck" elementId="End_Main" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-14: комплектация по заказу, холодовая цепь, УПД/ТТН, передача перевозчику.</bpmn:documentation>
      <bpmn:incoming>SF6</bpmn:incoming>
      <bpmn:incoming>SF19</bpmn:incoming>
      <bpmn:outgoing>SF20_Ship</bpmn:outgoing>
      <bpmn:potentialOwner name="LOGISTICS" />
    </bpmn:userTask>

    <bpmn:endEvent id="End_Main" name="Заказ выполнен">
      <bpmn:incoming>SF20_Ship</bpmn:incoming>
    </bpmn:endEvent>

    <!-- Связи. Ветки шлюзов названы по условию: имя читается на схеме. -->
    <bpmn:sequenceFlow id="SF1" sourceRef="Start_Dairy" targetRef="Task_ReceiveOrder" />
    <bpmn:sequenceFlow id="SF2" sourceRef="Task_ReceiveOrder" targetRef="Task_ProcessOrder" />
    <bpmn:sequenceFlow id="SF3" sourceRef="Task_ProcessOrder" targetRef="Task_CheckStock" />
    <bpmn:sequenceFlow id="SF4" sourceRef="Task_CheckStock" targetRef="Gateway_Stock" />
    <bpmn:sequenceFlow id="SF5" name="Нет" sourceRef="Gateway_Stock" targetRef="Task_CreatePO" />
    <bpmn:sequenceFlow id="SF6" name="Да" sourceRef="Gateway_Stock" targetRef="Task_Ship">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${stockSufficient == 'true'}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="SF7" sourceRef="Task_CreatePO" targetRef="Task_ApprovePO" />
    <bpmn:sequenceFlow id="SF8" sourceRef="Task_ApprovePO" targetRef="Task_SendPO" />
    <bpmn:sequenceFlow id="SF9" sourceRef="Task_SendPO" targetRef="Task_WaitPOConfirmed" />
    <bpmn:sequenceFlow id="SF10" sourceRef="Task_WaitPOConfirmed" targetRef="Task_ReceiveMilk" />
    <bpmn:sequenceFlow id="SF11" sourceRef="Task_ReceiveMilk" targetRef="Task_AcceptMilk" />
    <bpmn:sequenceFlow id="SF12" sourceRef="Task_AcceptMilk" targetRef="Task_AnalyzeMilk" />
    <bpmn:sequenceFlow id="SF13" sourceRef="Task_AnalyzeMilk" targetRef="Gateway_Quality" />
    <bpmn:sequenceFlow id="SF14" name="Да" sourceRef="Gateway_Quality" targetRef="Task_StoreMilk">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${labPassed == 'true'}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="SF15" name="Нет" sourceRef="Gateway_Quality" targetRef="Task_ReturnMilk" />
    <bpmn:sequenceFlow id="SF16" sourceRef="Task_ReturnMilk" targetRef="End_Reject" />
    <bpmn:sequenceFlow id="SF17" sourceRef="Task_StoreMilk" targetRef="Tech_CleanCool" />
    <bpmn:sequenceFlow id="SF18_ToWarehouse" name="Годная" sourceRef="Gateway_PackOutcome" targetRef="Task_StoreFG">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${packOutcome == 'good'}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="SF19" sourceRef="Task_StoreFG" targetRef="Task_Ship" />
    <bpmn:sequenceFlow id="SF20_Clean" sourceRef="Tech_CleanCool" targetRef="Tech_Normalize" />
    <bpmn:sequenceFlow id="SF21_Norm" sourceRef="Tech_Normalize" targetRef="Tech_Homogenize" />
    <bpmn:sequenceFlow id="SF22_Homog" sourceRef="Tech_Homogenize" targetRef="Tech_Pasteurize" />
    <bpmn:sequenceFlow id="SF23_Past" sourceRef="Tech_Pasteurize" targetRef="Gateway_PasteurizeOK" />
    <bpmn:sequenceFlow id="SF_T5" name="Да" sourceRef="Gateway_PasteurizeOK" targetRef="Tech_Ferment">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${pasteurizeOk == 'true'}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="SF_T5_No" name="Нет" sourceRef="Gateway_PasteurizeOK" targetRef="Task_ERP_CriticalAlert" />
    <bpmn:sequenceFlow id="SF_T6" sourceRef="Tech_Ferment" targetRef="Tech_CoolCheck" />
    <bpmn:sequenceFlow id="SF_T7" sourceRef="Tech_CoolCheck" targetRef="Gateway_TechQC" />
    <bpmn:sequenceFlow id="SF_T8_Yes" name="Да" sourceRef="Gateway_TechQC" targetRef="Tech_Pack">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${techQcPassed == 'true'}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="SF_T8_No" name="Нет" sourceRef="Gateway_TechQC" targetRef="Tech_Rework" />
    <bpmn:sequenceFlow id="SF_T9_Reject" sourceRef="Tech_Rework" targetRef="End_TechDefect" />
    <bpmn:sequenceFlow id="SF_T10" sourceRef="Tech_Pack" targetRef="Gateway_PackOutcome" />
    <bpmn:sequenceFlow id="SF_T_Esc1" name="Деградация" sourceRef="Gateway_PackOutcome" targetRef="Tech_LogDegradation">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${packOutcome == 'degraded'}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="SF_T_Err2" name="Авария" sourceRef="Gateway_PackOutcome" targetRef="Task_ERP_CriticalAlert" />
    <bpmn:sequenceFlow id="SF_T_Esc2" sourceRef="Tech_LogDegradation" targetRef="Task_ERP_HandleDeviation" />
    <bpmn:sequenceFlow id="SF_T_Esc3" sourceRef="Task_ERP_HandleDeviation" targetRef="End_ERP_DeviationLogged" />
    <bpmn:sequenceFlow id="SF_T_Err3" sourceRef="Task_ERP_CriticalAlert" targetRef="End_ERP_Aborted" />
    <bpmn:sequenceFlow id="SF20_Ship" sourceRef="Task_Ship" targetRef="End_Main" />
  </bpmn:process>

  <bpmndi:BPMNDiagram id="BPMNDiagram_Dairy">
    <bpmndi:BPMNPlane id="BPMNPlane_Dairy" bpmnElement="Process_Dairy">
      <bpmndi:BPMNShape id="Lane_Sales_di" bpmnElement="Lane_Sales" isHorizontal="true">
        <dc:Bounds x="90" y="20" width="3460" height="170" />
        <bpmndi:BPMNLabel />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Purchase_di" bpmnElement="Lane_Purchase" isHorizontal="true">
        <dc:Bounds x="90" y="190" width="3460" height="150" />
        <bpmndi:BPMNLabel />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_QC_di" bpmnElement="Lane_QC" isHorizontal="true">
        <dc:Bounds x="90" y="340" width="3460" height="150" />
        <bpmndi:BPMNLabel />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Warehouse_di" bpmnElement="Lane_Warehouse" isHorizontal="true">
        <dc:Bounds x="90" y="490" width="3460" height="150" />
        <bpmndi:BPMNLabel />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Prod_di" bpmnElement="Lane_Prod" isHorizontal="true">
        <dc:Bounds x="90" y="640" width="3460" height="420" />
        <bpmndi:BPMNLabel />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Logistics_di" bpmnElement="Lane_Logistics" isHorizontal="true">
        <dc:Bounds x="90" y="1060" width="3460" height="150" />
        <bpmndi:BPMNLabel />
      </bpmndi:BPMNShape>

      <bpmndi:BPMNShape id="Start_Dairy_di" bpmnElement="Start_Dairy">
        <dc:Bounds x="150" y="82" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="129" y="125" width="78" height="27" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ReceiveOrder_di" bpmnElement="Task_ReceiveOrder">
        <dc:Bounds x="230" y="60" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ProcessOrder_di" bpmnElement="Task_ProcessOrder">
        <dc:Bounds x="380" y="60" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_CheckStock_di" bpmnElement="Task_CheckStock">
        <dc:Bounds x="530" y="60" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Stock_di" bpmnElement="Gateway_Stock" isMarkerVisible="true">
        <dc:Bounds x="680" y="80" width="40" height="40" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="662" y="127" width="77" height="27" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>

      <bpmndi:BPMNShape id="Task_CreatePO_di" bpmnElement="Task_CreatePO">
        <dc:Bounds x="760" y="220" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ApprovePO_di" bpmnElement="Task_ApprovePO">
        <dc:Bounds x="910" y="220" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_SendPO_di" bpmnElement="Task_SendPO">
        <dc:Bounds x="1060" y="220" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_WaitPOConfirmed_di" bpmnElement="Task_WaitPOConfirmed">
        <dc:Bounds x="1210" y="220" width="140" height="80" />
      </bpmndi:BPMNShape>

      <bpmndi:BPMNShape id="Task_ReceiveMilk_di" bpmnElement="Task_ReceiveMilk">
        <dc:Bounds x="1360" y="370" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_AcceptMilk_di" bpmnElement="Task_AcceptMilk">
        <dc:Bounds x="1510" y="370" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_AnalyzeMilk_di" bpmnElement="Task_AnalyzeMilk">
        <dc:Bounds x="1660" y="370" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Quality_di" bpmnElement="Gateway_Quality" isMarkerVisible="true">
        <dc:Bounds x="1810" y="390" width="40" height="40" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="1806" y="437" width="49" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ReturnMilk_di" bpmnElement="Task_ReturnMilk">
        <dc:Bounds x="1900" y="370" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Reject_di" bpmnElement="End_Reject">
        <dc:Bounds x="2060" y="392" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="2038" y="435" width="81" height="27" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>

      <bpmndi:BPMNShape id="Task_StoreMilk_di" bpmnElement="Task_StoreMilk">
        <dc:Bounds x="1800" y="520" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_StoreFG_di" bpmnElement="Task_StoreFG">
        <dc:Bounds x="2300" y="520" width="140" height="80" />
      </bpmndi:BPMNShape>

      <bpmndi:BPMNShape id="Tech_CleanCool_di" bpmnElement="Tech_CleanCool">
        <dc:Bounds x="1800" y="670" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Tech_Normalize_di" bpmnElement="Tech_Normalize">
        <dc:Bounds x="1950" y="670" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Tech_Homogenize_di" bpmnElement="Tech_Homogenize">
        <dc:Bounds x="2100" y="670" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Tech_Pasteurize_di" bpmnElement="Tech_Pasteurize">
        <dc:Bounds x="2250" y="670" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_PasteurizeOK_di" bpmnElement="Gateway_PasteurizeOK" isMarkerVisible="true">
        <dc:Bounds x="2400" y="690" width="40" height="40" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="2371" y="737" width="98" height="27" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Tech_Ferment_di" bpmnElement="Tech_Ferment">
        <dc:Bounds x="2490" y="670" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Tech_CoolCheck_di" bpmnElement="Tech_CoolCheck">
        <dc:Bounds x="2640" y="670" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_TechQC_di" bpmnElement="Gateway_TechQC" isMarkerVisible="true">
        <dc:Bounds x="2790" y="690" width="40" height="40" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="2761" y="737" width="98" height="27" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Tech_Pack_di" bpmnElement="Tech_Pack">
        <dc:Bounds x="2880" y="670" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_PackOutcome_di" bpmnElement="Gateway_PackOutcome" isMarkerVisible="true">
        <dc:Bounds x="3040" y="690" width="40" height="40" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="3011" y="737" width="98" height="27" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>

      <bpmndi:BPMNShape id="Tech_Rework_di" bpmnElement="Tech_Rework">
        <dc:Bounds x="2700" y="860" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_TechDefect_di" bpmnElement="End_TechDefect">
        <dc:Bounds x="2860" y="882" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="2823" y="925" width="111" height="27" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Tech_LogDegradation_di" bpmnElement="Tech_LogDegradation">
        <dc:Bounds x="2940" y="860" width="140" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ERP_HandleDeviation_di" bpmnElement="Task_ERP_HandleDeviation">
        <dc:Bounds x="3120" y="860" width="180" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_ERP_DeviationLogged_di" bpmnElement="End_ERP_DeviationLogged">
        <dc:Bounds x="3340" y="882" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="3302" y="925" width="113" height="27" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>

      <bpmndi:BPMNShape id="Task_ERP_CriticalAlert_di" bpmnElement="Task_ERP_CriticalAlert">
        <dc:Bounds x="3120" y="960" width="180" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_ERP_Aborted_di" bpmnElement="End_ERP_Aborted">
        <dc:Bounds x="3340" y="982" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="3317" y="1025" width="83" height="27" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>

      <bpmndi:BPMNShape id="Task_Ship_di" bpmnElement="Task_Ship">
        <dc:Bounds x="2980" y="1090" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Main_di" bpmnElement="End_Main">
        <dc:Bounds x="3140" y="1112" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="3128" y="1155" width="61" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>

      <bpmndi:BPMNEdge id="SF1_di" bpmnElement="SF1">
        <di:waypoint x="186" y="100" />
        <di:waypoint x="230" y="100" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF2_di" bpmnElement="SF2">
        <di:waypoint x="340" y="100" />
        <di:waypoint x="380" y="100" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF3_di" bpmnElement="SF3">
        <di:waypoint x="490" y="100" />
        <di:waypoint x="530" y="100" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF4_di" bpmnElement="SF4">
        <di:waypoint x="640" y="100" />
        <di:waypoint x="680" y="100" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF5_di" bpmnElement="SF5">
        <di:waypoint x="700" y="120" />
        <di:waypoint x="700" y="260" />
        <di:waypoint x="760" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF6_di" bpmnElement="SF6">
        <di:waypoint x="720" y="100" />
        <di:waypoint x="3420" y="100" />
        <di:waypoint x="3420" y="1050" />
        <di:waypoint x="3035" y="1050" />
        <di:waypoint x="3035" y="1090" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF7_di" bpmnElement="SF7">
        <di:waypoint x="870" y="260" />
        <di:waypoint x="910" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF8_di" bpmnElement="SF8">
        <di:waypoint x="1020" y="260" />
        <di:waypoint x="1060" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF9_di" bpmnElement="SF9">
        <di:waypoint x="1170" y="260" />
        <di:waypoint x="1210" y="260" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF10_di" bpmnElement="SF10">
        <di:waypoint x="1350" y="260" />
        <di:waypoint x="1385" y="260" />
        <di:waypoint x="1385" y="370" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF11_di" bpmnElement="SF11">
        <di:waypoint x="1470" y="410" />
        <di:waypoint x="1510" y="410" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF12_di" bpmnElement="SF12">
        <di:waypoint x="1620" y="410" />
        <di:waypoint x="1660" y="410" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF13_di" bpmnElement="SF13">
        <di:waypoint x="1770" y="410" />
        <di:waypoint x="1810" y="410" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF14_di" bpmnElement="SF14">
        <di:waypoint x="1830" y="430" />
        <di:waypoint x="1830" y="520" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF15_di" bpmnElement="SF15">
        <di:waypoint x="1850" y="410" />
        <di:waypoint x="1900" y="410" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF16_di" bpmnElement="SF16">
        <di:waypoint x="2010" y="410" />
        <di:waypoint x="2060" y="410" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF17_di" bpmnElement="SF17">
        <di:waypoint x="1855" y="600" />
        <di:waypoint x="1855" y="670" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF18_ToWarehouse_di" bpmnElement="SF18_ToWarehouse">
        <di:waypoint x="3060" y="690" />
        <di:waypoint x="3060" y="620" />
        <di:waypoint x="2440" y="620" />
        <di:waypoint x="2440" y="560" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF19_di" bpmnElement="SF19">
        <di:waypoint x="2370" y="600" />
        <di:waypoint x="2370" y="650" />
        <di:waypoint x="3520" y="650" />
        <di:waypoint x="3520" y="1130" />
        <di:waypoint x="3090" y="1130" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF20_Clean_di" bpmnElement="SF20_Clean">
        <di:waypoint x="1910" y="710" />
        <di:waypoint x="1950" y="710" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF21_Norm_di" bpmnElement="SF21_Norm">
        <di:waypoint x="2060" y="710" />
        <di:waypoint x="2100" y="710" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF22_Homog_di" bpmnElement="SF22_Homog">
        <di:waypoint x="2210" y="710" />
        <di:waypoint x="2250" y="710" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF23_Past_di" bpmnElement="SF23_Past">
        <di:waypoint x="2360" y="710" />
        <di:waypoint x="2400" y="710" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T5_di" bpmnElement="SF_T5">
        <di:waypoint x="2440" y="710" />
        <di:waypoint x="2490" y="710" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T5_No_di" bpmnElement="SF_T5_No">
        <di:waypoint x="2420" y="730" />
        <di:waypoint x="2420" y="1000" />
        <di:waypoint x="3120" y="1000" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T6_di" bpmnElement="SF_T6">
        <di:waypoint x="2600" y="710" />
        <di:waypoint x="2640" y="710" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T7_di" bpmnElement="SF_T7">
        <di:waypoint x="2750" y="710" />
        <di:waypoint x="2790" y="710" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T8_Yes_di" bpmnElement="SF_T8_Yes">
        <di:waypoint x="2830" y="710" />
        <di:waypoint x="2880" y="710" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T8_No_di" bpmnElement="SF_T8_No">
        <di:waypoint x="2810" y="730" />
        <di:waypoint x="2810" y="800" />
        <di:waypoint x="2755" y="800" />
        <di:waypoint x="2755" y="860" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T9_Reject_di" bpmnElement="SF_T9_Reject">
        <di:waypoint x="2810" y="900" />
        <di:waypoint x="2860" y="900" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T10_di" bpmnElement="SF_T10">
        <di:waypoint x="2990" y="710" />
        <di:waypoint x="3040" y="710" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T_Esc1_di" bpmnElement="SF_T_Esc1">
        <di:waypoint x="3060" y="730" />
        <di:waypoint x="3060" y="800" />
        <di:waypoint x="3010" y="800" />
        <di:waypoint x="3010" y="860" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T_Err2_di" bpmnElement="SF_T_Err2">
        <di:waypoint x="3080" y="710" />
        <di:waypoint x="3400" y="710" />
        <di:waypoint x="3400" y="1000" />
        <di:waypoint x="3300" y="1000" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T_Esc2_di" bpmnElement="SF_T_Esc2">
        <di:waypoint x="3080" y="900" />
        <di:waypoint x="3120" y="900" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T_Esc3_di" bpmnElement="SF_T_Esc3">
        <di:waypoint x="3300" y="900" />
        <di:waypoint x="3340" y="900" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_T_Err3_di" bpmnElement="SF_T_Err3">
        <di:waypoint x="3300" y="1000" />
        <di:waypoint x="3340" y="1000" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF20_Ship_di" bpmnElement="SF20_Ship">
        <di:waypoint x="3090" y="1130" />
        <di:waypoint x="3140" y="1130" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/**
 * Процесс поставщика сырья: подтверждение заказа и отгрузка по ТТН.
 *
 * Ролей три — каталог поставщика читается кабинетом как второй контур
 * (`CONTOUR_ORDER`): `role:catalog` даёт карточки входа, а исполнители шагов
 * назначены `bpmn:potentialOwner`.
 *
 * Отгрузка объявляет `counterpartEvent="milkShipped"`: событие уходит в
 * экземпляр завода и активирует у него `Task_ReceiveMilk` — так в проекте
 * выражен `bpmn:messageFlow` исходной схемы (`Task_ShipMilk` → `Task_ReceiveMilk`),
 * который движок не исполняет.
 */
export const DAIRY_SUPPLIER_PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:act="http://erp.mes/schema/bpmn/action"
                  xmlns:role="http://erp.mes/schema/bpmn/roles"
                  id="Definitions_DairySupplier"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Supplier" name="Поставщик сырья: подтверждение и отгрузка" isExecutable="true">
    <bpmn:extensionElements>
      <role:catalog id="RoleCatalog_DairySupplier">
        <role:businessRole code="SUPPLIER_DIRECTOR" title="Руководитель поставщика" kind="EXECUTIVE" icon="Crown" />
        <role:businessRole code="SUPPLIER_MANAGER" title="Менеджер по продажам сырья" icon="Briefcase" />
        <role:businessRole code="SUPPLIER_DISPATCHER" title="Отгрузка сырья" icon="Truck" />
      </role:catalog>
    </bpmn:extensionElements>

    <bpmn:startEvent id="Start_Supplier" name="Заказ завода получен">
      <bpmn:extensionElements>
        <act:userAction id="startSupplierProcess" label="Принять заказ на сырьё" role="SUPPLIER_MANAGER" icon="PlusCircle" elementId="Task_ConfirmPO" />
      </bpmn:extensionElements>
      <bpmn:outgoing>SF_S1</bpmn:outgoing>
    </bpmn:startEvent>

    <bpmn:userTask id="Task_ConfirmPO" name="Подтвердить заказ и оформить документы">
      <bpmn:extensionElements>
        <act:userAction id="confirmSupplierOrder" label="Подтвердить объём и сроки, оформить ТТН/УПД" role="SUPPLIER_MANAGER" icon="FileText" elementId="Task_ShipMilk" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-П-01: сверка объёмов, сроков и цены; оформление ТТН и УПД на партию.</bpmn:documentation>
      <bpmn:incoming>SF_S1</bpmn:incoming>
      <bpmn:outgoing>SF_S2</bpmn:outgoing>
      <bpmn:potentialOwner name="SUPPLIER_MANAGER" />
    </bpmn:userTask>

    <bpmn:userTask id="Task_ShipMilk" name="Отгрузить молоко">
      <bpmn:extensionElements>
        <act:userAction id="shipMilk" label="Погрузить и передать перевозчику" role="SUPPLIER_DISPATCHER" icon="Truck" elementId="End_Supplier" counterpartEvent="milkShipped" counterpartElementId="Task_ReceiveMilk" />
      </bpmn:extensionElements>
      <bpmn:documentation>СОП-П-02: погрузка, пломбирование, холодовая цепь; событие отгрузки уходит заводу.</bpmn:documentation>
      <bpmn:incoming>SF_S2</bpmn:incoming>
      <bpmn:outgoing>SF_S3</bpmn:outgoing>
      <bpmn:potentialOwner name="SUPPLIER_DISPATCHER" />
    </bpmn:userTask>

    <bpmn:endEvent id="End_Supplier" name="Заказ отгружен">
      <bpmn:incoming>SF_S3</bpmn:incoming>
    </bpmn:endEvent>

    <bpmn:sequenceFlow id="SF_S1" sourceRef="Start_Supplier" targetRef="Task_ConfirmPO" />
    <bpmn:sequenceFlow id="SF_S2" sourceRef="Task_ConfirmPO" targetRef="Task_ShipMilk" />
    <bpmn:sequenceFlow id="SF_S3" sourceRef="Task_ShipMilk" targetRef="End_Supplier" />
  </bpmn:process>

  <bpmndi:BPMNDiagram id="BPMNDiagram_DairySupplier">
    <bpmndi:BPMNPlane id="BPMNPlane_DairySupplier" bpmnElement="Process_Supplier">
      <bpmndi:BPMNShape id="Start_Supplier_di" bpmnElement="Start_Supplier">
        <dc:Bounds x="150" y="82" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="129" y="125" width="78" height="27" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ConfirmPO_di" bpmnElement="Task_ConfirmPO">
        <dc:Bounds x="230" y="60" width="140" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ShipMilk_di" bpmnElement="Task_ShipMilk">
        <dc:Bounds x="420" y="60" width="110" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Supplier_di" bpmnElement="End_Supplier">
        <dc:Bounds x="580" y="82" width="36" height="36" />
        <bpmndi:BPMNLabel>
          <dc:Bounds x="562" y="125" width="72" height="14" />
        </bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>

      <bpmndi:BPMNEdge id="SF_S1_di" bpmnElement="SF_S1">
        <di:waypoint x="186" y="100" />
        <di:waypoint x="230" y="100" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_S2_di" bpmnElement="SF_S2">
        <di:waypoint x="370" y="100" />
        <di:waypoint x="420" y="100" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="SF_S3_di" bpmnElement="SF_S3">
        <di:waypoint x="530" y="100" />
        <di:waypoint x="580" y="100" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/**
 * Вертикальный отступ второго пула проекта.
 *
 * Схема завода занимает 0..1270 px вместе с пулом, поэтому поставщик начинается
 * с 1400: пулы не перекрываются, а стрелки завода остаются внутри своего пула.
 */
export const DAIRY_PROJECT_ROW_OFFSET = 1400;

/** Имя дорожки завода в проекте (`bpmn:participant/@name`). */
export const DAIRY_PLANT_PARTICIPANT_NAME = 'Молочный завод';

/** Имя дорожки поставщика в проекте. */
export const DAIRY_SUPPLIER_PARTICIPANT_NAME = 'Поставщик сырья';

/**
 * Проект целиком: кооперация двух процессов, подписи участников и общий холст.
 *
 * Собирается тем же `buildProjectXml`, что и демо-проект закупки молока:
 * участники, их DI-рамки и сдвиг второго пула — забота сборщика, а не схем.
 */
export const DAIRY_PLANT_PROJECT_XML = buildProjectXml(
  [
    {
      xml: DAIRY_PLANT_PROCESS_XML,
      participantName: DAIRY_PLANT_PARTICIPANT_NAME,
    },
    {
      xml: DAIRY_SUPPLIER_PROCESS_XML,
      participantName: DAIRY_SUPPLIER_PARTICIPANT_NAME,
    },
  ],
  { name: DAIRY_PLANT_PROJECT_NAME, rowOffset: DAIRY_PROJECT_ROW_OFFSET }
);
