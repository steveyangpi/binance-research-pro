import { spawnSync } from 'node:child_process';

const candidates =
  process.platform === 'win32'
    ? [
        ['py', ['-3']],
        ['python', []],
      ]
    : [
        ['python3', []],
        ['python', []],
      ];

for (const [command, prefix] of candidates) {
  const result = spawnSync(command, [...prefix, 'scripts/validate.py'], { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') continue;
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

throw new Error('Python 3 was not found. Install Python 3 to validate the plugin package.');
