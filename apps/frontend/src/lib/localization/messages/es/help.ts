export const helpMessages = {
    title: "Centro de ayuda",
    description: "Preguntas frecuentes y guías",
    quickLinks: {
        emailSupport: {
            title: "Soporte por correo",
            subtitle: 'support@erp71.com',
        },
        contact: {
            title: "Contáctenos",
            subtitle: "Enviar un mensaje",
        },
        status: {
            title: "Estado del sistema",
            subtitle: "Administrador de la plataforma: panel de estado en vivo",
        },
    },
    footerPrefix: "¿No encuentra lo que busca?",
    footerLink: "Contacte con nuestro equipo de soporte",
    sections: {
        gettingStarted: {
            title: "Primeros pasos",
            icon: '🚀',
            faqs: [
                {
                    q: "¿Cómo añado mi primer producto?",
                    a: "Vaya a Inventario → Productos y pulse «Nuevo producto». Solo son obligatorios el nombre y el precio de venta; SKU, categoría, marca, nivel de reposición y existencias iniciales son opcionales. Para cargar muchos de una vez use «Importar CSV»: las columnas de la plantilla son name, sku, barcode, selling_price, cost_price, stock_quantity, reorder_point, unit. Las filas cuyo SKU ya existe se omiten, de modo que la importación añade productos nuevos en lugar de actualizar los existentes.",
                },
                {
                    q: "¿Cómo empiezo a vender?",
                    a: "Abra Ventas → Punto de venta, toque los productos para formar el carrito, asocie un cliente si lo desea, cobre (efectivo, bKash o tarjeta; puede repartir el importe entre los tres) y confirme. Configure antes su tienda y sus almacenes, en Ajustes e Inventario, para que las existencias se controlen en el lugar correcto.",
                },
                {
                    q: "¿Cómo invito a mi personal y controlo lo que puede hacer?",
                    a: "Vaya a Equipo (Ajustes → Equipo) e invite a una persona por correo electrónico; se incorpora mediante un enlace de invitación. Asigne un rol —OWNER, MANAGER, CASHIER o ACCOUNTANT, o un rol personalizado que usted defina— para determinar qué módulos y acciones puede usar. Invitar a miembros requiere la cuenta del propietario o el permiso «Manage Users».",
                },
                {
                    q: "¿Qué planes de suscripción existen?",
                    a: "Los planes de pago de autoservicio son BASIC, ACCOUNTING y STANDARD; PREMIUM —que desbloquea CRM, Fabricación y el asistente de IA— aparece como «próximamente». El antiguo plan Free ya no se ofrece a nuevos registros. Compare y cambie de plan cuando quiera en Facturación.",
                },
            ],
        },
        pos: {
            title: "Punto de venta (POS)",
            icon: '🛒',
            faqs: [
                {
                    q: "¿Cómo funciona el POS sin conexión?",
                    a: "El punto de venta sigue funcionando cuando cae Internet. Aparece un aviso amarillo, los productos ya cargados siguen consultándose y cada venta se guarda en su dispositivo en lugar de en el servidor. Al recuperar la conexión, pulse «Sincronizar ahora» (o simplemente espere) y las ventas pendientes se suben automáticamente.",
                },
                {
                    q: "¿Puedo aceptar más de un método de pago en una misma venta?",
                    a: "Sí. El diálogo de cobro tiene campos independientes para efectivo, bKash y tarjeta de crédito y los suma, por lo que una venta puede repartirse entre los tres. (Nagad y la transferencia bancaria los reconoce el motor contable, pero no son botones de cobro en la pantalla del POS.)",
                },
                {
                    q: "¿Cómo funcionan los descuentos en caja?",
                    a: "El POS aplica descuentos de dos formas: introducir un código de descuento válido y pulsar Aplicar, o canjear los puntos de fidelidad de un cliente contra el total. En el propio POS no hay un campo libre de porcentaje o importe fijo: cree los códigos en Ajustes → Códigos de descuento.",
                },
                {
                    q: "¿Qué se imprime en el recibo?",
                    a: "Tras una venta puede imprimir un recibo térmico de 80 mm con el nombre de su tienda, el número de factura, la fecha, las líneas de artículos, el subtotal, los impuestos, el total, los pagos recibidos, el cambio o el saldo pendiente y un código QR para verificar la factura. Tenga en cuenta que los recibos del POS no imprimen por ahora el BIN ni el desglose de IVA.",
                },
            ],
        },
        sales: {
            title: "Ventas, devoluciones y clientes",
            icon: '🧾',
            faqs: [
                {
                    q: "¿Dónde veo y busco ventas anteriores?",
                    a: "Vaya a Ventas → Ventas para la lista completa. La paginación se hace en el servidor, así que sigue siendo rápida incluso con miles de facturas. Busque por número de serie, cliente o referencia, filtre por estado (Borrador, Completada, Reembolsada, Reembolso parcial) y abra cualquier fila para verla, editarla o eliminarla.",
                },
                {
                    q: "¿Cómo registro una devolución o un reembolso de cliente?",
                    a: "Abra Ventas → Devoluciones de venta → «Procesar devolución», escriba el número de serie de la venta original (p. ej. S-00001) y pulse Buscar; después elija los artículos y las cantidades a devolver. El reembolso se valora según la venta original y no puede superar lo vendido, las existencias devueltas vuelven al inventario y el reembolso sigue la forma de pago del cliente: efectivo si la venta estaba pagada, o reducción del saldo pendiente si fue a crédito.",
                },
                {
                    q: "¿Cómo vendo a crédito y controlo lo que me deben?",
                    a: "Añada clientes en Ventas → Clientes. Para vender a crédito, el cliente debe tener un límite de crédito definido; de lo contrario la venta se bloquea, y también se rechaza una venta a crédito que superaría el límite. La ficha de cada cliente muestra su saldo pendiente y un libro de crédito donde registrar los cobros.",
                },
                {
                    q: "¿Dónde gestiono los cobros de clientes y los saldos vencidos?",
                    a: "Use Ventas → Cobros de clientes para registrar el dinero recibido contra los saldos, Ventas → Libro mayor de clientes para un extracto continuo por cliente y el informe de antigüedad de deuda (en Ventas → Clientes) para ver quién debe cuánto y desde cuándo.",
                },
            ],
        },
        inventory: {
            title: "Gestión de inventario",
            icon: '📦',
            faqs: [
                {
                    q: "¿Cómo controlo las existencias en varios almacenes?",
                    a: "Cree almacenes en la configuración de inventario y elija los valores por defecto de cada flujo en Inventario → Ajustes de inventario. Las existencias se llevan por almacén; muévalas con Inventario → Traslados, un flujo en dos pasos de envío y recepción en el que el envío reduce el origen, la recepción aumenta el destino y se admiten recepciones parciales.",
                },
                {
                    q: "¿Cómo funcionan los avisos de existencias bajas?",
                    a: "Fije un nivel de reposición en cada producto (o uno por defecto en los Ajustes de inventario). Cada mañana a las 07:00 el sistema revisa las cantidades disponibles y, para todo lo que esté en su nivel de reposición o por debajo, envía un correo al titular de la cuenta, genera un aviso en la aplicación y —si están activados los SMS de existencias bajas— le manda un mensaje. Inventario → Informe de reposición enumera bajo demanda todo lo que está por debajo de su nivel.",
                },
                {
                    q: "¿Cómo importo muchos productos a la vez?",
                    a: "Vaya a Inventario → Productos → «Importar CSV» y suba la plantilla (columnas: name, sku, barcode, selling_price, cost_price, stock_quantity, reorder_point, unit). El precio de venta es obligatorio en cada fila, una cantidad de existencias iniciales crea un movimiento de existencias de apertura y las filas cuyo SKU ya existe se omiten, así que use la importación para añadir productos nuevos, no para actualizar los existentes.",
                },
                {
                    q: "¿Qué es un recuento de existencias y cuándo necesita aprobación?",
                    a: "Un recuento (Inventario → Recuentos) compara las existencias físicas con el sistema. Al iniciar una sesión se fija la cantidad esperada de cada producto del almacén elegido; usted introduce las cantidades contadas y se calcula cada diferencia. Si la mayor diferencia supera el umbral de discrepancia (25 por defecto, configurable en los Ajustes de inventario), la sesión debe revisarse antes de contabilizarse, y al contabilizar se ajustan las existencias y se registra un asiento contable.",
                },
            ],
        },
        purchases: {
            title: "Compras y proveedores",
            icon: '🚚',
            faqs: [
                {
                    q: "¿Cómo registro una compra a un proveedor?",
                    a: "Vaya a Compra → Compras y cree una: elija la tienda o almacén y el proveedor (o añádalo sobre la marcha) y agregue líneas de producto con cantidad y coste unitario, más impuestos, descuento y portes opcionales. Al guardar la compra la mercancía se recibe de inmediato (las existencias suben) y el importe total se contabiliza como deuda a proveedor: no hay campo de efectivo, así que registre cualquier pago aparte como Pago a proveedor.",
                },
                {
                    q: "¿Qué diferencia hay entre un pedido de compra y una compra?",
                    a: "Un pedido de compra (Compra → Pedidos de compra) es un compromiso que no mueve existencias. Cuando lo marca como Recibido, entonces aumenta las existencias y contabiliza la deuda, igual que una compra directa. Use pedidos cuando encargue por adelantado, y una compra directa cuando la mercancía llegue al mismo tiempo.",
                },
                {
                    q: "¿Cómo devuelvo mercancía a un proveedor?",
                    a: "Use Compra → Devoluciones de compra. Una devolución puede estar vinculada a una compra o ser independiente; reduce las existencias, baja el saldo pendiente con el proveedor (con el límite de lo que le debe actualmente) y registra el asiento contable correspondiente.",
                },
                {
                    q: "¿Cómo pago a los proveedores y veo lo que debo?",
                    a: "Registre los pagos en Compra → Pago a proveedor: puede pagar o recibir, imputar un pago a facturas concretas y dejar el resto como anticipo para imputarlo más adelante. Compra → Libro mayor de proveedores muestra el saldo continuo de cada proveedor, y cada proveedor cuenta además con un resumen de facturación y un libro de crédito.",
                },
            ],
        },
        accounting: {
            title: "Contabilidad",
            icon: '📊',
            faqs: [
                {
                    q: "¿Tengo que registrar yo los asientos de diario?",
                    a: "No: el sistema lleva la contabilidad por partida doble automáticamente. Las reglas de contabilización (Contabilidad → Reglas de contabilización) asocian cada suceso operativo (venta, compra, devolución, traslado, salario, ajuste) con las cuentas a cargar y abonar, y los asientos se generan a medida que ocurren esos sucesos. Solo hace asientos manuales para lo que las reglas no cubren.",
                },
                {
                    q: "¿Qué es el plan de cuentas?",
                    a: "El plan de cuentas (Contabilidad → Plan de cuentas) es la lista maestra de sus cuentas contables —activo, pasivo, patrimonio, ingresos y gastos— organizada en grupos y subgrupos. Cada línea de asiento se imputa a una de estas cuentas, por lo que sustenta todos sus informes.",
                },
                {
                    q: "¿Puedo hacer asientos manuales y qué informes hay?",
                    a: "Sí: Contabilidad → Registro de asientos permite registrar a mano asientos de caja, banco, traspaso y diario, y las pantallas Asientos, Diario y Libro mayor permiten revisarlos. Entre los informes están el balance de sumas y saldos, la cuenta de resultados, el balance de situación, el libro de caja, el libro de bancos, la antigüedad de saldos a cobrar y a pagar, y un informe de IVA; los ejercicios contables permiten bloquear los meses cerrados para impedir asientos con fecha anterior.",
                },
                {
                    q: "¿Cómo exporto a Tally o QuickBooks?",
                    a: "En la página general de contabilidad pulse «Exportar», elija Tally XML o QuickBooks IIF, seleccione un rango de fechas y descargue. El archivo se importa directamente en ese programa contable.",
                },
            ],
        },
        crm: {
            title: "CRM y oportunidades",
            icon: '🤝',
            faqs: [
                {
                    q: "¿Qué incluye el módulo de CRM y quién puede usarlo?",
                    a: "El CRM abarca oportunidades, conversaciones, seguimientos, campañas y clientes, además de los ajustes de fuentes y categorías de oportunidades y campos personalizados, todo accesible desde el panel general de CRM. La mayor parte es una función del plan Premium: en los demás planes conserva los clientes, pero las herramientas de embudo quedan ocultas.",
                },
                {
                    q: "¿Cómo creo y trabajo una oportunidad?",
                    a: "Vaya a CRM → Oportunidades → «Nueva oportunidad» e introduzca al menos un nombre (móvil, correo, fuente, categoría, prioridad, estado, redes sociales y siguiente paso son opcionales). Una oportunidad recorre etapas fijas —Nueva, Contactada, Cualificada, Perdida, Convertida— y se asigna mediante la persona indicada en «Siguiente paso asignado a»; la lista también admite asignación y cambio de estado en bloque. Cuando llegue el momento, «Convertir en cliente» crea o vincula el cliente en Ventas.",
                },
                {
                    q: "¿De dónde salen las listas de fuente y categoría?",
                    a: "Son sus propios datos maestros: gestiónelos en CRM → Fuentes y categorías. Cada fuente lleva además un peso de puntuación (0–25) que alimenta la puntuación automática de la oportunidad. Puede añadir, editar, ocultar o eliminar valores; al eliminar uno en uso se le pedirá trasladar esas oportunidades a un sustituto, y los valores integrados se ocultan en lugar de eliminarse.",
                },
                {
                    q: "¿Cómo funcionan los seguimientos y las conversaciones?",
                    a: "Los seguimientos (CRM → Seguimientos) son una única cola de recordatorios —General, Cobro, Cumpleaños o Reposición— creados desde la ficha de un cliente o de una oportunidad, y los de cumpleaños y reposición se generan además automáticamente. Conversaciones (CRM → Conversaciones) es un registro filtrable y de solo lectura de cada contacto (llamada, SMS, WhatsApp, visita, etc.) anotado sobre las oportunidades por todo su equipo; los nuevos se registran desde la ficha de la oportunidad.",
                },
            ],
        },
        manufacturing: {
            title: "Fabricación",
            icon: '🏭',
            faqs: [
                {
                    q: "¿Cómo defino una receta de producto (lista de materiales)?",
                    a: "En la página de Fabricación, abra la pestaña Lista de materiales y pulse «Nueva lista». Una receta indica el producto resultante, cuántas unidades produce cada lote y sus componentes con cantidades. Los componentes se introducen por identificador de producto, y el producto resultante de una receta no puede cambiarse una vez creada. Fabricación es una función Premium o complementaria.",
                },
                {
                    q: "¿Cómo afecta una orden de producción a las existencias?",
                    a: "En la pestaña Órdenes de producción, cree una orden a partir de una lista de materiales y una cantidad; empieza como borrador. Al iniciarla se vuelve a comprobar que haya componentes en existencias, y al completarla se consumen los componentes (más la merma que indique) y los productos terminados se añaden al inventario. La fabricación solo mueve inventario: no genera asientos en el libro mayor.",
                },
                {
                    q: "¿Cómo se calculan el coste de la orden y el precio de venta?",
                    a: "Al completarla, el coste de material se toma del último coste de cada componente, y puede añadir más líneas de coste (mano de obra, impresión, transporte, gastos generales, etc.), opcionalmente tomadas de una factura de compra de servicios. La orden muestra entonces un coste total y un coste por unidad, y para las órdenes completadas un panel de precios sugiere un precio de venta con margen sobre coste que puede aplicar al producto.",
                },
            ],
        },
        hr: {
            title: "RR. HH. y nóminas",
            icon: '👥',
            faqs: [
                {
                    q: "¿Cómo añado empleados?",
                    a: "Vaya a RR. HH. → Empleados → «Nuevo empleado» e introduzca al menos nombre y teléfono (correo, fecha de alta, documento de identidad, departamento, puesto y salario base son opcionales), o añada varios con el diálogo de importación. El código de empleado se genera automáticamente, y puede vincular a un empleado con un acceso al sistema para que pueda iniciar sesión.",
                },
                {
                    q: "¿Cómo se gestionan la asistencia y las ausencias?",
                    a: "RR. HH. → Asistencia registra una entrada por empleado y día —Presente, Ausente, Media jornada o Festivo, con horas de entrada y salida opcionales— introducida manualmente, ya que no hay dispositivo de fichaje. RR. HH. → Ausencias tiene dos pestañas: Solicitudes (enviar y después aprobar o rechazar) y Tipos (definir un tipo de ausencia y sus días al año).",
                },
                {
                    q: "¿Cómo pago los salarios?",
                    a: "Use RR. HH. → Pagos de salario → «Pagar salario», elija el empleado y el periodo, y registre el importe (precargado desde su salario base) y el método. Cada pago genera un asiento contable (debe: Salarios a pagar; haber: la cuenta de pago). Los pagos son importes únicos y fijos: todavía no hay nóminas ni desglose de complementos y deducciones.",
                },
            ],
        },
        aiAssistant: {
            title: "Asistente de IA",
            icon: '🤖',
            faqs: [
                {
                    q: "¿Qué es el asistente de negocio de IA y cómo lo abro?",
                    a: "Es un panel de chat —el icono de robot «Preguntar al asistente de negocio»— que responde preguntas sobre sus propios datos: ventas, existencias, clientes, cobros pendientes y más. Es estrictamente de solo lectura: puede consultar y explicar, pero no puede cambiar nada. El asistente es una función del plan Premium, así que el icono solo aparece si su plan lo incluye.",
                },
                {
                    q: "¿Qué puede ver realmente y puedo fiarme de sus respuestas?",
                    a: "Pregúntele «¿qué puedes hacer?» y le indicará sus sucursales, hasta dónde se remontan sus registros y qué herramientas puede usar, de modo que una respuesta vacía significa un periodo vacío, no una consulta rota. Cada respuesta enumera sus fuentes (los informes y rangos de fechas exactos que utilizó) para que pueda verificarla. También puede pedirle que busque operaciones inusuales —ventas por debajo del coste, facturas duplicadas, precios muy atípicos— y le avisará si alguna comprobación no pudo completarse en lugar de dar a entender que todo está correcto.",
                },
                {
                    q: "¿Qué son los créditos de IA y cómo consigo más?",
                    a: "Los créditos de IA son una asignación mensual incluida en su plan (1 crédito = 1.000 tokens) que consumen el asistente y otras funciones de IA; puede verlos en Créditos de IA. Se reinician en cada periodo de facturación y no pueden comprarse por separado: para obtener una asignación mayor hay que cambiar de plan (BASIC incluye 100 al mes; STANDARD, 500). Son distintos de los créditos SMS, que son de prepago y sí se pueden comprar.",
                },
                {
                    q: "¿Puedo dictar una pregunta en vez de escribirla?",
                    a: "Sí: si su navegador lo admite (Chrome, Edge o Safari en HTTPS), aparece un micrófono junto a Enviar. Tóquelo, formule su pregunta, edite el texto si hace falta y envíelo. El asistente todavía no lee las respuestas en voz alta.",
                },
            ],
        },
        billing: {
            title: "Facturación y suscripción",
            icon: '💳',
            faqs: [
                {
                    q: "¿Cómo cambio a un plan superior?",
                    a: "Vaya a Facturación, elija una tarjeta de plan y Mensual o Anual, y continúe hasta el pago con SSL Wireless (que acepta tarjeta, bKash y Nagad). Pagar anualmente cuesta el equivalente a diez meses: en la práctica, dos meses gratis, en torno a un 17 % de ahorro. Solo el propietario o un rol con permiso de facturación puede cambiar la suscripción.",
                },
                {
                    q: "¿Puedo cancelar mi suscripción?",
                    a: "Sí: en Facturación elija «Cancelar al final del periodo». Su acceso continúa hasta el final del periodo pagado en curso y no se elimina nada. Consulte la política de reembolso en /refund para más detalles.",
                },
                {
                    q: "¿Qué ocurre si falla mi pago o vence el plan?",
                    a: "La suscripción pasa primero a impagada y recibirá correos de recordatorio durante un breve periodo de gracia (unos 7 días). Si sigue sin pagarse, la cuenta se rebaja al plan Free en lugar de eliminarse: sus datos se conservan siempre y, al volver a pagar, se restablecen todas las funciones.",
                },
                {
                    q: "¿Qué diferencia hay entre los créditos de IA y los créditos SMS?",
                    a: "Los créditos de IA son una asignación mensual del plan para funciones de IA y se reinician cada periodo. Los créditos SMS son un saldo de prepago que recarga en Créditos SMS: se consumen cuando el sistema envía mensajes (recibos de venta, avisos de existencias bajas, campañas de CRM), un crédito por segmento de mensaje y destinatario, y un saldo bajo le avisa antes de que los envíos empiecen a fallar.",
                },
            ],
        },
        storefront: {
            title: "Tienda en línea",
            icon: '🌐',
            faqs: [
                {
                    q: "¿Cómo activo mi tienda en línea?",
                    a: "Vaya a Tienda → Tienda (ajustes), actívela y defina un slug de URL (minúsculas, números y guiones). Su tienda pública estará entonces en /store/su-slug, y podrá añadir un banner, un titular principal y una imagen.",
                },
                {
                    q: "¿Cómo hacen los pedidos los clientes?",
                    a: "Los clientes abren la dirección de su tienda, navegan por los productos disponibles y hacen un pedido con sus datos de contacto. Los pedidos llegan a Tienda → Pedidos en línea como Pendientes, donde puede marcarlos como Confirmados o Cancelados.",
                },
                {
                    q: "¿Los pedidos de la tienda descuentan existencias automáticamente?",
                    a: "Todavía no. Un pedido de la tienda comprueba que haya existencias, pero no las descuenta, y confirmar un pedido solo cambia su estado: la preparación y el ajuste de inventario los hace usted. El descuento automático de inventario para pedidos en línea está en nuestra hoja de ruta para una versión futura.",
                },
            ],
        },
        security: {
            title: "Seguridad y cuenta",
            icon: '🔒',
            faqs: [
                {
                    q: "¿Cómo activo la autenticación en dos pasos (2FA)?",
                    a: "Abra su perfil desde el menú de cuenta y vaya a la pestaña 2FA. Pulse Generar QR, escanéelo con una aplicación de autenticación (Google Authenticator, Authy, etc.), introduzca el código de 6 dígitos y active. A partir de entonces, al iniciar sesión se le pedirá un código de su teléfono.",
                },
                {
                    q: "¿Y si olvido mi contraseña?",
                    a: "En la página de acceso pulse «Olvidé mi contraseña» e introduzca su correo para recibir un enlace de restablecimiento. También puede cambiar la contraseña cuando quiera en Perfil → Contraseña (la nueva debe tener al menos 8 caracteres).",
                },
                {
                    q: "¿Cómo exporto o elimino mis datos?",
                    a: "Vaya a Perfil → Datos y privacidad. «Descargar mis datos» genera una exportación JSON de su cuenta, y «Solicitar eliminación de datos» inicia una solicitud que se tramita en un plazo de 30 días.",
                },
                {
                    q: "¿Cómo funcionan los roles y el acceso del equipo?",
                    a: "Gestione a las personas en Equipo. Los roles integrados son OWNER, MANAGER, CASHIER y ACCOUNTANT, y puede crear roles personalizados; cada rol concede un conjunto concreto de permisos de módulo y de acción. Solo el propietario o un usuario con «Manage Users» puede invitar a miembros o cambiar roles.",
                },
            ],
        },
    },
} as const;
