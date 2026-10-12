// Базовая схема Заказчика (Молочный Завод).
//
// Кнопки кабинета объявлены в самих блоках (`act:userAction`): надпись, иконка,
// роль участника и кросс-процессные эффекты (`startsProcess`,
// `counterpartEvent`). Событие и узел, на который встаёт токен, здесь не
// записаны: их выводит схема — «шаг выполнен» (`CompleteBlock`) и следующий блок
// по единственной исходящей связи узла этой кнопки. Короткая кнопка читается как
// «нажатие завершает шаг и переводит токен дальше», а нестандартный переход
// по-прежнему пишут явными `event`/`elementId`. Клиент рисует ровно то, что
// объявлено в схеме.
export const DEFAULT_CUSTOMER_BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:act="http://erp.mes/schema/bpmn/action"
                  id="Definitions_CustomerProcess"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_MilkCustomer_v1" name="Закупка и приемка сырого молока" isExecutable="true">
    <bpmn:startEvent id="StartEvent_Customer" name="Заявка производства на 100 л молока">
      <bpmn:extensionElements>
        <act:userAction id="createOrder" label="Создать внутренний заказ на 100 л" role="PRODUCTION" icon="PlusCircle" />
      </bpmn:extensionElements>
      <bpmn:outgoing>Flow_C1</bpmn:outgoing>
    </bpmn:startEvent>
    
    <bpmn:sequenceFlow id="Flow_C1" sourceRef="StartEvent_Customer" targetRef="Task_CreatePurchaseOrder" />
    <bpmn:userTask id="Task_CreatePurchaseOrder" name="Сформировать заказ у поставщика">
      <bpmn:extensionElements>
        <act:userAction id="sendToSupplier" label="Сформировать и отправить заказ Поставщику" icon="Send" startsProcess="Process_SupplierSupply_v1" />
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_C1</bpmn:incoming>
      <bpmn:outgoing>Flow_C2</bpmn:outgoing>
      <bpmn:potentialOwner name="MANAGER" />
    </bpmn:userTask>
    
    <bpmn:sequenceFlow id="Flow_C2" sourceRef="Task_CreatePurchaseOrder" targetRef="Task_WaitForSupplierShipment" />
    <bpmn:userTask id="Task_WaitForSupplierShipment" name="Ожидание отгрузки поставщиком">
      <bpmn:incoming>Flow_C2</bpmn:incoming>
      <bpmn:outgoing>Flow_C3</bpmn:outgoing>
      <bpmn:potentialOwner name="MANAGER" />
    </bpmn:userTask>
    
    <bpmn:sequenceFlow id="Flow_C3" sourceRef="Task_WaitForSupplierShipment" targetRef="Task_ReceiveDocsAndIssuePass" />
    <bpmn:userTask id="Task_ReceiveDocsAndIssuePass" name="Принять документы и выписать пропуск">
      <bpmn:extensionElements>
        <act:userAction id="issuePass" label="Выписать пропуск на КПП" icon="KeyRound" />
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_C3</bpmn:incoming>
      <bpmn:outgoing>Flow_C4</bpmn:outgoing>
      <bpmn:potentialOwner name="MANAGER" />
    </bpmn:userTask>
    
    <bpmn:sequenceFlow id="Flow_C4" sourceRef="Task_ReceiveDocsAndIssuePass" targetRef="Task_SecurityCheck" />
    <bpmn:userTask id="Task_SecurityCheck" name="Проверка пропуска на КПП">
      <bpmn:extensionElements>
        <act:userAction id="securityPass" label="Проверить пропуск и открыть ворота" icon="ShieldCheck" />
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_C4</bpmn:incoming>
      <bpmn:outgoing>Flow_C5</bpmn:outgoing>
      <bpmn:potentialOwner name="SECURITY" />
    </bpmn:userTask>
    
    <bpmn:sequenceFlow id="Flow_C5" sourceRef="Task_SecurityCheck" targetRef="Task_QualityControl" />
    <bpmn:userTask id="Task_QualityControl" name="Контроль качества ОТК">
      <bpmn:extensionElements>
        <act:userAction id="qualityApprove" label="Подтвердить качество и передать в Производство" icon="ClipboardCheck" />
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_C5</bpmn:incoming>
      <bpmn:outgoing>Flow_C6</bpmn:outgoing>
      <bpmn:potentialOwner name="QUALITY" />
    </bpmn:userTask>
    
    <bpmn:sequenceFlow id="Flow_C6" sourceRef="Task_QualityControl" targetRef="EndEvent_Customer" />
    <bpmn:endEvent id="EndEvent_Customer" name="Молоко сдано в производство">
      <bpmn:incoming>Flow_C6</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>

  <bpmndi:BPMNDiagram id="BPMNDiagram_Customer">
    <bpmndi:BPMNPlane id="BPMNPlane_Customer" bpmnElement="Process_MilkCustomer_v1">
      <bpmndi:BPMNShape id="StartEvent_Customer_di" bpmnElement="StartEvent_Customer">
        <dc:Bounds x="160" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_CreatePurchaseOrder_di" bpmnElement="Task_CreatePurchaseOrder">
        <dc:Bounds x="250" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_WaitForSupplierShipment_di" bpmnElement="Task_WaitForSupplierShipment">
        <dc:Bounds x="400" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_ReceiveDocsAndIssuePass_di" bpmnElement="Task_ReceiveDocsAndIssuePass">
        <dc:Bounds x="550" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_SecurityCheck_di" bpmnElement="Task_SecurityCheck">
        <dc:Bounds x="700" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_QualityControl_di" bpmnElement="Task_QualityControl">
        <dc:Bounds x="850" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_Customer_di" bpmnElement="EndEvent_Customer">
        <dc:Bounds x="1000" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_C1_di" bpmnElement="Flow_C1"><di:waypoint x="196" y="118" /><di:waypoint x="250" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_C2_di" bpmnElement="Flow_C2"><di:waypoint x="350" y="118" /><di:waypoint x="400" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_C3_di" bpmnElement="Flow_C3"><di:waypoint x="500" y="118" /><di:waypoint x="550" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_C4_di" bpmnElement="Flow_C4"><di:waypoint x="650" y="118" /><di:waypoint x="700" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_C5_di" bpmnElement="Flow_C5"><di:waypoint x="800" y="118" /><di:waypoint x="850" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_C6_di" bpmnElement="Flow_C6"><di:waypoint x="950" y="118" /><di:waypoint x="1000" y="118" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

// Базовая схема Поставщика (ООО «Альпийские Луга»).
//
// Кнопки объявлены на блоках так же, как у Заказчика. Кнопка отгрузки описывает
// оба события нажатия: своё (`Shipment` на `EndEvent_Supplier`) и сигнал
// Заказчику (`counterpartEvent` — узел `Task_ReceiveDocsAndIssuePass` в его
// экземпляре процесса).
export const DEFAULT_SUPPLIER_BPMN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:act="http://erp.mes/schema/bpmn/action"
                  id="Definitions_SupplierProcess"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_SupplierSupply_v1" name="Внутренняя отгрузка поставщика" isExecutable="true">
    <bpmn:startEvent id="StartEvent_Supplier" name="Получен заказ от Заказчика">
      <bpmn:extensionElements>
        <act:userAction id="startSupplierProcess" label="Запустить обработку заказа" icon="PackageCheck" />
      </bpmn:extensionElements>
      <bpmn:outgoing>Flow_S1</bpmn:outgoing>
    </bpmn:startEvent>
    
    <bpmn:sequenceFlow id="Flow_S1" sourceRef="StartEvent_Supplier" targetRef="Task_SupplierCreateDocs" />
    <bpmn:userTask id="Task_SupplierCreateDocs" name="Сформировать документы (УПД/ТТН)">
      <bpmn:extensionElements>
        <act:userAction id="createDocs" label="Сформировать ТТН и УПД" icon="FileText" />
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_S1</bpmn:incoming>
      <bpmn:outgoing>Flow_S2</bpmn:outgoing>
      <bpmn:potentialOwner name="SUPPLIER_MANAGER" />
    </bpmn:userTask>
    
    <bpmn:sequenceFlow id="Flow_S2" sourceRef="Task_SupplierCreateDocs" targetRef="Task_SupplierShipment" />
    <bpmn:userTask id="Task_SupplierShipment" name="Отгрузить и отправить автоцистерну">
      <bpmn:extensionElements>
        <act:userAction id="shipment" label="Подтвердить отгрузку" icon="Truck" counterpartEvent="SupplierShippedSignal" counterpartElementId="Task_ReceiveDocsAndIssuePass" />
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_S2</bpmn:incoming>
      <bpmn:outgoing>Flow_S3</bpmn:outgoing>
      <bpmn:potentialOwner name="SUPPLIER_MANAGER" />
    </bpmn:userTask>
    
    <bpmn:sequenceFlow id="Flow_S3" sourceRef="Task_SupplierShipment" targetRef="EndEvent_Supplier" />
    <bpmn:endEvent id="EndEvent_Supplier" name="Отгрузка выполнена">
      <bpmn:incoming>Flow_S3</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>

  <bpmndi:BPMNDiagram id="BPMNDiagram_Supplier">
    <bpmndi:BPMNPlane id="BPMNPlane_Supplier" bpmnElement="Process_SupplierSupply_v1">
      <bpmndi:BPMNShape id="StartEvent_Supplier_di" bpmnElement="StartEvent_Supplier">
        <dc:Bounds x="160" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_SupplierCreateDocs_di" bpmnElement="Task_SupplierCreateDocs">
        <dc:Bounds x="250" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_SupplierShipment_di" bpmnElement="Task_SupplierShipment">
        <dc:Bounds x="400" y="78" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_Supplier_di" bpmnElement="EndEvent_Supplier">
        <dc:Bounds x="550" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_S1_di" bpmnElement="Flow_S1"><di:waypoint x="196" y="118" /><di:waypoint x="250" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_S2_di" bpmnElement="Flow_S2"><di:waypoint x="350" y="118" /><di:waypoint x="400" y="118" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_S3_di" bpmnElement="Flow_S3"><di:waypoint x="500" y="118" /><di:waypoint x="550" y="118" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;