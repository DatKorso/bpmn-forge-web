import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { formatVersion, readBuildMetadata } from '../scripts/build-metadata.js';

function repository(t) {
  const directory = mkdtempSync(join(tmpdir(), 'bpmn-forge-git-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'repo');
  mkdirSync(cwd);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'BPMN Forge Tests');
  git('config', 'user.email', 'test@example.org');
  git('config', 'commit.gpgsign', 'false');
  const commit = (...message) => git('commit', '--quiet', '--allow-empty', '-m', message[0], ...message.slice(1).flatMap((body) => ['-m', body]));
  function addGenerator() {
    mkdirSync(join(cwd, 'scripts'));
    writeFileSync(join(cwd, 'scripts/build-metadata.js'), '');
    git('add', 'scripts/build-metadata.js');
    commit('feat: add generator');
  }
  const metadata = () => readBuildMetadata({ cwd, strict: true });
  return { directory, cwd, git, commit, addGenerator, metadata };
}

test('starts at the generator commit and bumps all three version components', (t) => {
  const { commit, addGenerator, metadata } = repository(t);
  commit('feat!: pre-existing change');
  addGenerator();
  assert.equal(metadata().version, '0.01.0');
  commit('Update editor controls');
  assert.equal(metadata().version, '0.01.1');
  commit('feat(footer): add history');
  assert.equal(metadata().version, '0.02.0');
  commit('fix: document BREAKING CHANGE: as an example');
  assert.equal(metadata().version, '0.02.1');
  commit('fix!: change the export format');
  assert.equal(metadata().version, '1.00.0');
  commit('feat: add an option');
  commit('fix(editor)!: change the option');
  assert.equal(metadata().version, '2.00.0');
  commit('Replace the option', 'Details.\n\nBREAKING CHANGE: old values are invalid');
  assert.equal(metadata().version, '3.00.0');
});

test('counts a merge once using the largest change from its message and newly reachable commits', (t) => {
  const { git, commit, addGenerator, metadata } = repository(t);
  commit('Initial commit');
  git('switch', '-qc', 'generator');
  addGenerator();
  commit('feat!: another change before the baseline');
  git('switch', '-q', 'main');
  git('merge', '--quiet', '--no-ff', 'generator', '-m', 'Merge generator');
  assert.equal(metadata().version, '0.01.0');

  git('switch', '-qc', 'topic');
  commit('feat: add a panel');
  commit('fix: adjust spacing');
  commit('feat!: replace the layout');
  git('switch', '-q', 'main');
  git('merge', '--quiet', '--no-ff', 'topic', '-m', 'Merge topic');
  assert.equal(metadata().version, '1.00.0');

  git('switch', '-q', 'topic');
  commit('Fix spacing again');
  git('switch', '-q', 'main');
  git('merge', '--quiet', '--no-ff', 'topic', '-m', 'feat: update spacing options');
  assert.equal(metadata().version, '1.01.0');
});

test('uses the squash commit subject and body for a single bump', (t) => {
  const { cwd, git, commit, addGenerator, metadata } = repository(t);
  addGenerator();
  git('switch', '-qc', 'topic');
  writeFileSync(join(cwd, 'feature.txt'), 'new feature');
  git('add', 'feature.txt');
  commit('feat!: unpublished change');
  git('switch', '-q', 'main');
  git('merge', '--quiet', '--squash', 'topic');
  commit('feat(editor): ship feature');
  assert.equal(metadata().version, '0.02.0');

  git('switch', '-qc', 'replacement');
  writeFileSync(join(cwd, 'feature.txt'), 'replacement');
  git('add', 'feature.txt');
  commit('Revise feature');
  git('switch', '-q', 'main');
  git('merge', '--quiet', '--squash', 'replacement');
  commit('Revise feature', 'BREAKING CHANGE: the original feature is gone');
  assert.equal(metadata().version, '1.00.0');
});

test('formats the minor version with at least two digits', () => {
  assert.equal(formatVersion([0, 9, 4]), '0.09.4');
  assert.equal(formatVersion([0, 10, 0]), '0.10.0');
  assert.equal(formatVersion([0, 100, 0]), '0.100.0');
});

test('embeds the latest twenty commits reachable from the built revision, including detached HEAD', (t) => {
  const { git, commit, addGenerator, metadata } = repository(t);
  addGenerator();
  for (let change = 1; change <= 20; change++) commit(`Change ${change}`);
  const revision = git('rev-parse', 'HEAD');
  const date = git('show', '-s', '--format=%cI', revision);
  const baseUrl = 'https://github.com/DatKorso/bpmn-forge-web';
  const build = metadata();
  assert.equal(build.repositoryUrl, baseUrl);
  assert.equal(build.commits.length, 20);
  assert.deepEqual(build.commits[0], { title: 'Change 20', date, url: `${baseUrl}/commit/${revision}` });
  assert.equal(build.historyUrl, `${baseUrl}/commits/${revision}`);
  commit('Newer commit');
  git('switch', '--quiet', '--detach', revision);
  assert.deepEqual(metadata(), build);
});

test('falls back locally and fails in CI if history or the baseline is missing', (t) => {
  const { directory, cwd, git, commit, addGenerator } = repository(t);
  const fallback = {
    version: '0.01.0',
    commits: [],
    repositoryUrl: 'https://github.com/DatKorso/bpmn-forge-web',
    historyUrl: null
  };
  commit('Initial commit');
  assert.deepEqual(readBuildMetadata({ cwd, strict: false }), fallback);
  assert.throws(() => readBuildMetadata({ cwd, strict: true }), /baseline/);
  addGenerator();
  const shallow = join(directory, 'shallow');
  git('clone', '--quiet', '--depth=1', pathToFileURL(cwd).href, shallow);
  assert.deepEqual(readBuildMetadata({ cwd: shallow, strict: false }), fallback);
  assert.throws(() => readBuildMetadata({ cwd: shallow, strict: true }), /complete Git history/);
});
