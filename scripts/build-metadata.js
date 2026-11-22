import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json' with { type: 'json' };

const root = fileURLToPath(new URL('..', import.meta.url));
const generatorPath = 'scripts/build-metadata.js';
const repository = 'https://github.com/DatKorso/bpmn-forge-web';
const historyLimit = 20;

export function formatVersion([major, minor, patch]) {
  return `${major}.${String(minor).padStart(2, '0')}.${patch}`;
}

function changeSize(subject, body) {
  if (/^[\w-]+(?:\([^)]+\))?!:/.test(subject) || /^BREAKING CHANGE:/m.test(body)) return 2;
  if (/^feat(?:\([^)]+\))?:/.test(subject)) return 1;
  return 0;
}

export function readBuildMetadata({ cwd = root, strict = Boolean(process.env.CI) } = {}) {
  const git = (...args) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const version = packageInfo.version.split('.').map(Number);

  try {
    if (git('rev-parse', '--is-shallow-repository').trim() !== 'false') {
      throw new Error('A complete Git history is required.');
    }

    const revision = git('rev-parse', 'HEAD').trim();
    // Diff merges against their first parent so the baseline is where the generator entered main.
    const baseline = git('log', '--first-parent', '--diff-merges=first-parent',
      '--diff-filter=A', '--reverse', '--format=%H', revision, '--', generatorPath).split('\n')[0];
    if (!baseline) throw new Error(`No first-parent baseline adds ${generatorPath}.`);

    const log = (format, ...args) => {
      const fields = git('log', '-z', `--format=${format}`, ...args).split('\0');
      fields.pop();
      return fields;
    };

    const changes = log('%P%x00%s%x00%b', '--first-parent', '--reverse', `${baseline}..${revision}`);
    for (let i = 0; i < changes.length; i += 3) {
      const [parents, subject, body] = changes.slice(i, i + 3);
      const [firstParent, ...mergedParents] = parents.split(' ');
      let size = changeSize(subject, body);

      if (mergedParents.length && size < 2) {
        const merged = log('%s%x00%b', ...mergedParents, `^${firstParent}`);
        for (let j = 0; j < merged.length && size < 2; j += 2) {
          size = Math.max(size, changeSize(merged[j], merged[j + 1]));
        }
      }

      const index = 2 - size;
      version[index]++;
      version.fill(0, index + 1);
    }

    const history = log('%H%x00%s%x00%cI', '--date-order', `-${historyLimit}`, revision);
    const commits = [];
    for (let i = 0; i < history.length; i += 3) {
      const [hash, title, date] = history.slice(i, i + 3);
      commits.push({ title, date, url: `${repository}/commit/${hash}` });
    }

    return {
      version: formatVersion(version),
      commits,
      repositoryUrl: repository,
      historyUrl: `${repository}/commits/${revision}`
    };
  } catch (error) {
    if (strict) throw new Error(`Cannot build BPMN Forge metadata: ${error.message}`, { cause: error });
    return {
      version: formatVersion(packageInfo.version.split('.').map(Number)),
      commits: [],
      repositoryUrl: repository,
      historyUrl: null
    };
  }
}
