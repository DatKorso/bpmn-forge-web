import { isFrame } from './annotation-layout.js';
import { descendantOf } from './alignment-state.js';

export function alignmentSelection(diagram, elements) {
  const byElement = new Map(diagram.figures.map((figure) => [figure.element, figure]));
  const selected = [...new Set(elements.map((element) => element.labelTarget ?? element))];
  const figures = selected.map((element) => byElement.get(element));
  if (!figures.length) return { reason: 'Выберите пул, дорожку, раскрытый подпроцесс или несколько фигур.' };
  const pools = figures.filter((figure) => figure?.kind === 'pool');
  if (pools.length && pools.length !== figures.length) {
    return { reason: 'Выберите только пулы или фигуры одного процесса' };
  }
  if (pools.length > 1) return { pools: new Set(pools) };
  if (figures.some((figure) => !figure)) return { reason: 'Выделение должно состоять из фигур.' };
  if (figures.some((figure) => figure.host && !figures.includes(figure.host))) {
    return { reason: 'Выберите фигуру, к которой прикреплено граничное событие.' };
  }

  const members = figures.filter((figure) => !figure.host);
  const [first] = members;
  if (members.length === 1 && isFrame(first)) {
    const scope = first.kind === 'lane' ? first.scope : first;
    const contents = diagram.figures.filter((figure) => figure.kind === 'node' && figure.scope === scope &&
      (first.kind !== 'lane' || figure.lane && (figure.lane === first || descendantOf(figure.lane, first))));
    return contents.length ? { scope, members: contents, container: first } : { reason: 'В выбранной области нет фигур для выравнивания.' };
  }
  if (members.some(isFrame)) return { reason: 'Выберите один контейнер или несколько отдельных фигур.' };
  if (members.length < 2) return { reason: 'Выберите хотя бы две фигуры.' };
  if (members.some((figure) => figure.scope !== first.scope)) {
    return { reason: 'Фигуры должны принадлежать одному процессу или подпроцессу.' };
  }
  return { scope: first.scope, members };
}
