# Сторонние компоненты

Лицензия MIT из файла [LICENSE](LICENSE) распространяется только на собственный код BPMN Forge. Сторонние библиотеки распространяются на условиях своих лицензий и принадлежат их авторам.

Полные тексты лицензий всех библиотек, попавших в сборку, Vite собирает в файл `third-party-licenses.md` при выполнении `npm run build`. На сайте он доступен по адресу [bpmn.korso.cc/third-party-licenses.md](https://bpmn.korso.cc/third-party-licenses.md).

## Основные библиотеки

| Библиотека | Правообладатель | Лицензия | Назначение |
| --- | --- | --- | --- |
| [bpmn-js](https://github.com/bpmn-io/bpmn-js) | Camunda Services GmbH | [bpmn.io License](https://github.com/bpmn-io/bpmn-js/blob/develop/LICENSE) | Отрисовка и редактирование BPMN |
| [diagram-js](https://github.com/bpmn-io/diagram-js), [bpmn-moddle](https://github.com/bpmn-io/bpmn-moddle) и другие модули bpmn.io | Camunda Services GmbH | MIT | Ядро редактора, чтение и запись BPMN 2.0 XML |
| [bpmn-js-color-picker](https://github.com/bpmn-io/bpmn-js-color-picker) | Camunda Services GmbH | MIT | Выбор цвета элементов |
| [elkjs](https://github.com/kieler/elkjs) | Kiel University и участники проекта Eclipse Layout Kernel | EPL-2.0 или GPL-3.0-or-later | Расчёт раскладки графа |
| [preact](https://github.com/preactjs/preact) | Jason Miller | MIT | Компоненты интерфейса bpmn-js |
| [htm](https://github.com/developit/htm) | Google Inc. | Apache-2.0 | Шаблоны интерфейса bpmn-js |

## bpmn-js и водяной знак bpmn.io

Лицензия bpmn-js в остальном совпадает с MIT, но добавляет обязательное условие. Код, который показывает водяной знак bpmn.io со ссылкой на https://bpmn.io, нельзя удалять или изменять. На сайте или в приложении водяной знак должен оставаться полностью видимым, и другие элементы не должны его перекрывать. BPMN Forge сохраняет водяной знак в правом нижнем углу полотна. Это условие действует и для производных версий редактора.

## elkjs

BPMN Forge использует elkjs без изменений, на условиях Eclipse Public License 2.0. Исходный код доступен в репозитории [kieler/elkjs](https://github.com/kieler/elkjs) и на странице [Eclipse Layout Kernel](https://eclipse.dev/elk/). Лицензия MIT проекта BPMN Forge на elkjs не распространяется.

## Инструменты разработки

Vite и Playwright используются только для сборки и тестирования и в собранный сайт не входят.
