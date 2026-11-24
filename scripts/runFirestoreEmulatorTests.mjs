#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repeatable Cross-Platform (Windows & Linux) Firestore Emulator Integration & Rules Test Runner.
 *
 * Guarantees:
 * - Uses ONLY an isolated demo project (`demo-mizanex-test`) and local Firestore Emulator.
 * - NEVER falls back to production Firestore or user credentials.
 * - Loads the repository's `firebase.json`, `firestore.rules`, and `firestore.indexes.json`.
 * - Resolves Firebase CLI safely on both Windows and Linux (including paths containing spaces):
 *   1) Prefers executing the resolved Node.js entrypoint (`firebase-tools/lib/bin/firebase.js`)
 *      directly via `process.execPath` with `shell: false`.
 *   2) Falls back cleanly to a native binary (`shell: false`) or safely quoted `cmd.exe`
 *      invocation for Windows `.cmd`/`.bat` shims if no JS entrypoint can be resolved.
 * - Fails loudly (non-zero exit code) if the emulator cannot be started or reached;
 *   NEVER reports skipped/missing emulator runs as success.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEMO_PROJECT_ID = 'demo-mizanex-test';
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SUITE_FILES = {
  all: [
    'tests/emulator/sectorLinkage.emulator.test.ts',
    'tests/emulator/cleanupLegacyDpsCurrent.emulator.test.ts',
    'tests/emulator/firestoreRules.emulator.test.ts',
    'tests/emulator/macroParamConcurrency.emulator.test.ts',
    'tests/emulator/reportedEpsWriteConsistency.emulator.test.ts',
    'tests/emulator/realEstateDisclosureWrite.emulator.test.ts',
  ],
  sector: ['tests/emulator/sectorLinkage.emulator.test.ts'],
  cleanup: ['tests/emulator/cleanupLegacyDpsCurrent.emulator.test.ts'],
  rules: ['tests/emulator/firestoreRules.emulator.test.ts'],
  macro_params: ['tests/emulator/macroParamConcurrency.emulator.test.ts'],
  reported_eps: ['tests/emulator/reportedEpsWriteConsistency.emulator.test.ts'],
  real_estate: ['tests/emulator/realEstateDisclosureWrite.emulator.test.ts'],
};

/**
 * Quotes a single command-line argument safely for POSIX `/bin/sh` or Windows `cmd.exe`.
 */
export function quoteShellArg(arg, platform = process.platform) {
  const str = String(arg);
  if (platform === 'win32') {
    if (str.length > 0 && !/[\s"&|<>^()]/.test(str)) return str;
    return `"${str.replace(/"/g, '""')}"`;
  }
  if (str.length > 0 && !/[\s"'\\$`!&|;<>()*?[\]{}]/.test(str)) return str;
  return `"${str.replace(/(["\\$`])/g, '\\$1')}"`;
}

/**
 * Builds the inner test command string passed to `firebase emulators:exec <command>`.
 * Handles Node paths and test file paths containing spaces safely on Windows & POSIX.
 */
export function buildEmulatorInnerTestCommand(
  targetFiles,
  nodeExecPath = process.execPath,
  platform = process.platform
) {
  const parts = [
    quoteShellArg(nodeExecPath, platform),
    '--import',
    'tsx',
    '--test',
    ...targetFiles.map((f) => quoteShellArg(f, platform)),
  ];
  return parts.join(' ');
}

/**
 * Parses an npm-generated Windows `.cmd` shim (e.g. `firebase.cmd`) to extract its
 * underlying Node.js `.js` entrypoint path, preserving spaces in `%dp0%` / directory names.
 */
export function extractJsEntrypointFromWindowsCmdShim(shimContent, shimDir) {
  if (!shimContent || typeof shimContent !== 'string') return null;

  // Typical npm shim line:
  //   "%_prog%"  "%dp0%\node_modules\firebase-tools\lib\bin\firebase.js" %*
  //   "%~dp0\node_modules\firebase-tools\lib\bin\firebase.js" %*
  const quotedPattern = /"((?:%dp0%|%~dp0|[^"\r\n])*?\.c?m?js)"/gi;
  let match;
  while ((match = quotedPattern.exec(shimContent)) !== null) {
    const rawTarget = match[1].trim();
    if (!rawTarget) continue;
    const expanded = rawTarget
      .replace(/^%dp0%[\\/]?/i, '')
      .replace(/^%~dp0[\\/]?/i, '');
    const candidate =
      expanded !== rawTarget ? path.win32.resolve(shimDir, expanded) : rawTarget;
    if (/firebase-tools/i.test(candidate) || /firebase\.c?m?js$/i.test(candidate)) {
      return candidate;
    }
  }

  const unquotedPattern = /(%dp0%|%~dp0)([^\s"\r\n]*?\.c?m?js)/gi;
  while ((match = unquotedPattern.exec(shimContent)) !== null) {
    const rel = match[2].replace(/^[\\/]+/, '');
    const candidate = path.win32.resolve(shimDir, rel);
    if (/firebase-tools/i.test(candidate) || /firebase\.c?m?js$/i.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Parses a POSIX shell wrapper script (e.g. npm/nvm/volta shim) to locate a Node `.js` entrypoint.
 */
export function extractJsEntrypointFromPosixShim(scriptContent, shimDir) {
  if (!scriptContent || typeof scriptContent !== 'string') return null;
  if (/^#!.*\bnode\b/m.test(scriptContent.split('\n')[0] || '')) {
    return null; // The script itself is already a Node JS script
  }
  const match = scriptContent.match(/["']?(\$basedir\/[^"'\s]+\.c?m?js|\/[^"'\s]+firebase-tools[^"'\s]+\.c?m?js)["']?/);
  if (!match) return null;
  const raw = match[1];
  if (raw.startsWith('$basedir/')) {
    return path.posix.resolve(shimDir, raw.slice('$basedir/'.length));
  }
  return raw;
}

/**
 * Builds the `spawnSync` invocation spec for a resolved Firebase CLI target.
 * Always prefers `process.execPath` + `[jsEntrypoint, ...args]` (`shell: false`).
 */
export function buildFirebaseSpawnSpec(
  resolvedCli,
  cliArgs,
  options = {}
) {
  const platform = options.platform ?? process.platform;
  const nodeExecPath = options.nodeExecPath ?? process.execPath;
  const comSpec = options.comSpec ?? (process.env.ComSpec || 'cmd.exe');

  if (resolvedCli.kind === 'node_js') {
    return {
      command: nodeExecPath,
      args: [resolvedCli.targetPath, ...cliArgs],
      shell: false,
    };
  }

  if (resolvedCli.kind === 'win_cmd' && platform === 'win32') {
    const cmdLine = [
      quoteShellArg(resolvedCli.targetPath, 'win32'),
      ...cliArgs.map((a) => quoteShellArg(a, 'win32')),
    ].join(' ');
    return {
      command: comSpec,
      args: ['/d', '/s', '/c', `"${cmdLine}"`],
      shell: false,
      windowsVerbatimArguments: true,
    };
  }

  return {
    command: resolvedCli.targetPath,
    args: cliArgs,
    shell: false,
  };
}

function isJsNodeScript(filePath) {
  if (/\.(mjs|cjs|js)$/i.test(filePath)) return true;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(128);
    const bytes = fs.readSync(fd, buf, 0, 128, 0);
    fs.closeSync(fd);
    const firstLine = buf.toString('utf8', 0, bytes).split(/\r?\n/)[0] || '';
    return /^#!.*\bnode\b/.test(firstLine);
  } catch {
    return false;
  }
}

function findExecutablesOnPath(commandName, platform = process.platform, env = process.env) {
  const pathVar = env.PATH || env.Path || '';
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  const extensions =
    platform === 'win32'
      ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .map((e) => e.trim())
          .filter(Boolean)
      : [''];

  const found = [];
  for (const dir of dirs) {
    const cleanDir = dir.replace(/^"|"$/g, '');
    if (!cleanDir) continue;
    for (const ext of extensions) {
      const candidate = path.join(cleanDir, `${commandName}${ext}`);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          found.push(candidate);
        }
      } catch {
        // Ignore inaccessible PATH directories
      }
    }
  }
  return found;
}

/**
 * Resolves Firebase CLI reliably across Linux, macOS, and Windows:
 * 1) Local workspace `node_modules/firebase-tools/lib/bin/firebase.js`
 * 2) Executable found on PATH:
 *    - On POSIX: follow symlinks (`realpathSync`), run directly via Node if JS entrypoint,
 *      or parse wrapper script, or run native binary directly.
 *    - On Windows: prefer `.cmd`/`.bat` shim's underlying `firebase.js` via Node (`shell: false`),
 *      or `.exe` directly (`shell: false`), or fall back to safe `cmd.exe` shim execution.
 */
export function resolveFirebaseCliInvocation(options = {}) {
  const platform = options.platform ?? process.platform;
  const rootDir = options.rootDir ?? ROOT_DIR;
  const env = options.env ?? process.env;

  const localJs = path.join(rootDir, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
  if (fs.existsSync(localJs)) {
    return { kind: 'node_js', targetPath: localJs, source: 'local_node_modules' };
  }

  const candidates = findExecutablesOnPath('firebase', platform, env);

  // On Windows, prefer resolving `.cmd` -> Node JS entrypoint or `.exe` over extensionless POSIX shell shims
  const orderedCandidates =
    platform === 'win32'
      ? [
          ...candidates.filter((c) => /\.(cmd|bat)$/i.test(c)),
          ...candidates.filter((c) => /\.exe$/i.test(c)),
          ...candidates.filter((c) => !/\.(cmd|bat|exe)$/i.test(c)),
        ]
      : candidates;

  for (const candidate of orderedCandidates) {
    let realPath = candidate;
    try {
      realPath = fs.realpathSync(candidate);
    } catch {
      realPath = candidate;
    }

    if (platform === 'win32' && /\.(cmd|bat)$/i.test(realPath)) {
      try {
        const content = fs.readFileSync(realPath, 'utf8');
        const jsEntry = extractJsEntrypointFromWindowsCmdShim(content, path.dirname(realPath));
        if (jsEntry && fs.existsSync(jsEntry)) {
          return { kind: 'node_js', targetPath: jsEntry, source: `windows_cmd_shim:${realPath}` };
        }
      } catch {
        // Fall through to safe cmd.exe wrapper
      }
      return { kind: 'win_cmd', targetPath: realPath, source: 'path_win_cmd' };
    }

    if (isJsNodeScript(realPath)) {
      return { kind: 'node_js', targetPath: realPath, source: 'path_node_entrypoint' };
    }

    if (platform !== 'win32') {
      try {
        const content = fs.readFileSync(realPath, 'utf8');
        const jsEntry = extractJsEntrypointFromPosixShim(content, path.dirname(realPath));
        if (jsEntry && fs.existsSync(jsEntry)) {
          return { kind: 'node_js', targetPath: jsEntry, source: `posix_shim:${realPath}` };
        }
      } catch {
        // Binary executable, not a text script
      }
    }

    return { kind: 'native_bin', targetPath: realPath, source: 'path_binary' };
  }

  return null;
}

export function resolveJavaBinary(platform = process.platform, env = process.env) {
  const exeName = platform === 'win32' ? 'java.exe' : 'java';
  if (env.JAVA_HOME) {
    const fromHome = path.join(env.JAVA_HOME, 'bin', exeName);
    if (fs.existsSync(fromHome)) {
      return fromHome;
    }
  }
  const onPath = findExecutablesOnPath('java', platform, env);
  if (onPath.length > 0) {
    return onPath[0];
  }
  return exeName;
}

function checkFirebaseCli() {
  const resolved = resolveFirebaseCliInvocation();
  if (!resolved) {
    return { ok: false, resolved: null, output: 'firebase CLI not found on PATH or local node_modules' };
  }
  const spec = buildFirebaseSpawnSpec(resolved, ['--version']);
  const res = spawnSync(spec.command, spec.args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: spec.shell,
    ...(spec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  });
  if (res.error || res.status !== 0) {
    return {
      ok: false,
      resolved,
      output: (res.stderr || res.stdout || res.error?.message || '').trim(),
    };
  }
  return {
    ok: true,
    resolved,
    output: (res.stdout || res.stderr || '').trim().split(/\r?\n/)[0] || '',
  };
}

function checkJavaRuntime() {
  const javaBin = resolveJavaBinary();
  const res = spawnSync(javaBin, ['-version'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (res.error || res.status !== 0) {
    return { ok: false, output: (res.stderr || res.stdout || res.error?.message || '').trim() };
  }
  return {
    ok: true,
    output: (res.stderr || res.stdout || '').trim().split(/\r?\n/)[0] || '',
  };
}

function checkTcpReachable(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export function buildIsolatedEnv(extra = {}, baseEnv = process.env) {
  const cleanEnv = { ...baseEnv };
  // Never leak production credential paths into emulator tests
  delete cleanEnv.GOOGLE_APPLICATION_CREDENTIALS;
  delete cleanEnv.FIREBASE_TOKEN;
  return {
    ...cleanEnv,
    GCLOUD_PROJECT: DEMO_PROJECT_ID,
    FIREBASE_PROJECT: DEMO_PROJECT_ID,
    MIZANEX_EMULATOR_PROJECT_ID: DEMO_PROJECT_ID,
    ...extra,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const suiteArg = args.find((a) => a.startsWith('--suite='))?.slice('--suite='.length) || 'all';
  const targetFiles = SUITE_FILES[suiteArg];
  if (!targetFiles) {
    console.error(
      `[test:emulator] Unknown --suite=${suiteArg}. Expected one of: ${Object.keys(SUITE_FILES).join(', ')}`
    );
    process.exit(1);
  }

  for (const relFile of targetFiles) {
    if (!fs.existsSync(path.join(ROOT_DIR, relFile))) {
      console.error(`[test:emulator] Missing emulator test file: ${relFile}`);
      process.exit(1);
    }
  }

  const existingEmulatorHost = (process.env.FIRESTORE_EMULATOR_HOST || '').trim();

  if (existingEmulatorHost) {
    const lastColon = existingEmulatorHost.lastIndexOf(':');
    const host = lastColon > 0 ? existingEmulatorHost.slice(0, lastColon).trim() : '';
    const port = lastColon > 0 ? Number(existingEmulatorHost.slice(lastColon + 1).trim()) : NaN;
    if (!host || !Number.isInteger(port) || port <= 0) {
      console.error(
        `[test:emulator] BLOCKER: Invalid FIRESTORE_EMULATOR_HOST="${existingEmulatorHost}". Expected "host:port" (e.g. "127.0.0.1:8080").`
      );
      process.exit(1);
    }
    const reachable = await checkTcpReachable(host, port);
    if (!reachable) {
      console.error(
        `[test:emulator] BLOCKER: FIRESTORE_EMULATOR_HOST="${existingEmulatorHost}" is set, but no Firestore Emulator is listening on ${host}:${port}.`
      );
      process.exit(1);
    }

    console.log(
      `[test:emulator] Connecting to running Firestore Emulator at ${existingEmulatorHost} (project: ${DEMO_PROJECT_ID})...`
    );
    const run = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--test', ...targetFiles],
      {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        shell: false,
        env: buildIsolatedEnv({ FIRESTORE_EMULATOR_HOST: existingEmulatorHost }),
      }
    );
    process.exit(run.status ?? 1);
  }

  // No external emulator running -> verify prerequisites to boot local Firestore Emulator via Firebase CLI
  const firebaseCheck = checkFirebaseCli();
  const javaCheck = checkJavaRuntime();

  if (!firebaseCheck.ok || !javaCheck.ok) {
    console.error('====================================================================');
    console.error('[test:emulator] BLOCKER: Cannot start local Firestore Emulator.');
    console.error(
      `  - firebase CLI : ${
        firebaseCheck.ok
          ? `OK (${firebaseCheck.output}) via ${firebaseCheck.resolved?.kind} [${firebaseCheck.resolved?.targetPath}]`
          : `MISSING (${firebaseCheck.output || 'firebase not found'})`
      }`
    );
    console.error(
      `  - Java Runtime : ${
        javaCheck.ok ? `OK (${javaCheck.output})` : `MISSING (${javaCheck.output || 'java not found'})`
      }`
    );
    console.error('');
    console.error('Firestore Emulator requires Java Runtime (JRE/JDK 17+) and firebase-tools.');
    console.error('This runner refuses to fall back to production or mark unexecuted tests as passing.');
    console.error(
      'Install Java (e.g., OpenJDK 21) or start a local Firestore Emulator and set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080.'
    );
    console.error('====================================================================');
    process.exit(1);
  }

  const testCmd = buildEmulatorInnerTestCommand(targetFiles, process.execPath, process.platform);
  const execSpec = buildFirebaseSpawnSpec(firebaseCheck.resolved, [
    'emulators:exec',
    '--only',
    'firestore',
    '--project',
    DEMO_PROJECT_ID,
    testCmd,
  ]);

  console.log(
    `[test:emulator] Booting Firestore Emulator (firebase.json + firestore.rules + firestore.indexes.json, project=${DEMO_PROJECT_ID}, cli=${firebaseCheck.resolved.kind})...`
  );
  const execRes = spawnSync(execSpec.command, execSpec.args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: execSpec.shell,
    ...(execSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    env: buildIsolatedEnv(),
  });
  if (execRes.error) {
    console.error('[test:emulator] Failed to launch Firebase CLI:', execRes.error.message);
    process.exit(1);
  }
  process.exit(execRes.status ?? 1);
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main().catch((err) => {
    console.error('[test:emulator] Unexpected error:', err);
    process.exit(1);
  });
}
