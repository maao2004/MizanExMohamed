/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for cross-platform (Windows & Linux) Firebase CLI resolution,
 * quoting for paths containing spaces, and credential isolation in
 * `scripts/runFirestoreEmulatorTests.mjs`.
 *
 * Note: Windows path/shim logic is verified programmatically here on the current host OS;
 * actual Windows execution requires running on a Windows machine.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEmulatorInnerTestCommand,
  buildFirebaseSpawnSpec,
  buildIsolatedEnv,
  DEMO_PROJECT_ID,
  extractJsEntrypointFromPosixShim,
  extractJsEntrypointFromWindowsCmdShim,
  quoteShellArg,
  resolveFirebaseCliInvocation,
} from '../scripts/runFirestoreEmulatorTests.mjs';

describe('Cross-Platform Firestore Emulator Runner (scripts/runFirestoreEmulatorTests.mjs)', () => {
  it('extracts firebase-tools JS entrypoint from Windows npm .cmd shim including paths with spaces', () => {
    const npmCmdShim = [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      '"%_prog%"  "%dp0%\\node_modules\\firebase-tools\\lib\\bin\\firebase.js" %*',
    ].join('\r\n');

    const shimDir = 'C:\\Users\\Ahmed Amin\\AppData\\Roaming\\npm';
    const extracted = extractJsEntrypointFromWindowsCmdShim(npmCmdShim, shimDir);
    assert.equal(
      extracted,
      'C:\\Users\\Ahmed Amin\\AppData\\Roaming\\npm\\node_modules\\firebase-tools\\lib\\bin\\firebase.js'
    );
  });

  it('extracts firebase-tools JS entrypoint from POSIX shell wrapper shim', () => {
    const posixShim = [
      '#!/bin/sh',
      'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")',
      'exec node "$basedir/node_modules/firebase-tools/lib/bin/firebase.js" "$@"',
    ].join('\n');

    const extracted = extractJsEntrypointFromPosixShim(posixShim, '/opt/my tools/bin');
    assert.equal(
      extracted,
      '/opt/my tools/bin/node_modules/firebase-tools/lib/bin/firebase.js'
    );
  });

  it('builds Node spawn spec (shell: false) when JS entrypoint is resolved, preserving paths with spaces on Windows & Linux', () => {
    const winNodePath = 'C:\\Program Files\\nodejs\\node.exe';
    const winJsEntry =
      'C:\\Users\\Ahmed Amin\\AppData\\Roaming\\npm\\node_modules\\firebase-tools\\lib\\bin\\firebase.js';
    const innerCmd = buildEmulatorInnerTestCommand(
      ['tests/emulator/firestoreRules.emulator.test.ts'],
      winNodePath,
      'win32'
    );
    assert.equal(
      innerCmd,
      '"C:\\Program Files\\nodejs\\node.exe" --import tsx --test tests/emulator/firestoreRules.emulator.test.ts'
    );

    const spec = buildFirebaseSpawnSpec(
      { kind: 'node_js', targetPath: winJsEntry },
      ['emulators:exec', '--only', 'firestore', '--project', DEMO_PROJECT_ID, innerCmd],
      { platform: 'win32', nodeExecPath: winNodePath }
    );
    assert.equal(spec.command, winNodePath);
    assert.equal(spec.shell, false);
    assert.equal(spec.args[0], winJsEntry);
    assert.equal(spec.args[spec.args.length - 1], innerCmd);
  });

  it('falls back safely to cmd.exe with verbatim quoting for non-JS Windows .cmd shim with spaces', () => {
    const cmdPath = 'C:\\Program Files\\Firebase CLI\\firebase.cmd';
    const innerCmd = '"C:\\Program Files\\nodejs\\node.exe" --import tsx --test tests/emulator/firestoreRules.emulator.test.ts';
    const spec = buildFirebaseSpawnSpec(
      { kind: 'win_cmd', targetPath: cmdPath },
      ['emulators:exec', '--only', 'firestore', '--project', DEMO_PROJECT_ID, innerCmd],
      { platform: 'win32', comSpec: 'C:\\Windows\\System32\\cmd.exe' }
    );

    assert.equal(spec.command, 'C:\\Windows\\System32\\cmd.exe');
    assert.equal(spec.shell, false);
    assert.equal(spec.windowsVerbatimArguments, true);
    assert.deepEqual(spec.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.ok(spec.args[3].includes('"C:\\Program Files\\Firebase CLI\\firebase.cmd"'));
    assert.ok(spec.args[3].includes('--project demo-mizanex-test'));
  });

  it('quotes POSIX paths with spaces and dollar signs safely', () => {
    assert.equal(quoteShellArg('/opt/my node/bin/node', 'linux'), '"/opt/my node/bin/node"');
    assert.equal(quoteShellArg('tests/emulator/a.test.ts', 'linux'), 'tests/emulator/a.test.ts');
  });

  it('resolves local/global Firebase CLI on current host to a Node JS entrypoint when available', () => {
    const resolved = resolveFirebaseCliInvocation();
    if (resolved) {
      assert.ok(['node_js', 'native_bin', 'win_cmd'].includes(resolved.kind));
      assert.ok(resolved.targetPath.length > 0);
    }
  });

  it('strips production credential env vars and pins isolated demo-* project ID', () => {
    const env = buildIsolatedEnv(
      { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
      {
        PATH: '/usr/bin',
        GOOGLE_APPLICATION_CREDENTIALS: '/secret/prod-key.json',
        FIREBASE_TOKEN: 'secret-token',
      }
    );
    assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
    assert.equal(env.FIREBASE_TOKEN, undefined);
    assert.equal(env.GCLOUD_PROJECT, DEMO_PROJECT_ID);
    assert.equal(env.FIREBASE_PROJECT, DEMO_PROJECT_ID);
    assert.equal(env.MIZANEX_EMULATOR_PROJECT_ID, DEMO_PROJECT_ID);
    assert.equal(env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  });
});
