#!/usr/bin/env node
/**
 * Generates ThirdPartyNoticeText.txt for bundled dependencies.
 * Run during build to ensure license compliance.
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Dependencies that get bundled into the CLI
const BUNDLED_PACKAGES = [
  '@clack/prompts',
  '@clack/core',
  'picocolors',
  'gray-matter',
  'simple-git',
  'xdg-basedir',
  'sisteransi',
  'is-unicode-supported',
];

interface LicenseInfo {
  licenses: string;
  repository?: string;
  publisher?: string;
  licenseFile?: string;
}

function getLicenseText(pkgPath: string): string {
  const possibleFiles = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'];
  for (const file of possibleFiles) {
    const filePath = join(pkgPath, file);
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8').trim();
    }
  }
  return '';
}

function main() {
  console.log('Generating ThirdPartyNoticeText.txt...');

  // Get license info from license-checker
  const output = execSync('npx license-checker --json', { encoding: 'utf-8' });
  const allLicenses: Record<string, LicenseInfo> = JSON.parse(output);

  const lines: string[] = [
    '/*!----------------- Skills CLI ThirdPartyNotices -------------------------------------------------------',
    '',
    'The Skills CLI incorporates third party material from the projects listed below.',
    'The original copyright notice and the license under which this material was received',
    'are set forth below. These licenses and notices are provided for informational purposes only.',
    '',
    '---------------------------------------------',
    'Third Party Code Components',
    '--------------------------------------------',
    '',
  ];

  for (const [pkgNameVersion, info] of Object.entries(allLicenses)) {
    // Extract package name (remove version)
    const pkgName = pkgNameVersion.replace(/@[\d.]+(-.*)?$/, '').replace(/^(.+)@.*$/, '$1');

    // Check if this is a bundled package
    const isBundled = BUNDLED_PACKAGES.some(
      (bundled) => pkgName === bundled || pkgNameVersion.startsWith(bundled + '@')
    );

    if (!isBundled) continue;

    // Get the actual license text from the package
    const pkgPath = join(process.cwd(), 'node_modules', pkgName);
    const licenseText = getLicenseText(pkgPath);

    lines.push('='.repeat(80));
    lines.push(`Package: ${pkgNameVersion}`);
    lines.push(`License: ${info.licenses}`);
    if (info.repository) {
      lines.push(`Repository: ${info.repository}`);
    }
    lines.push('-'.repeat(80));
    lines.push('');
    if (licenseText) {
      lines.push(licenseText);
    } else {
      // Fallback to generic MIT/ISC text
      if (info.licenses === 'MIT') {
        lines.push('MIT License');
        lines.push('');
        lines.push('Permission is hereby granted, free of charge, to any person obtaining a copy');
        lines.push('of this software and associated documentation files (the "Software"), to deal');
        lines.push('in the Software without restriction, including without limitation the rights');
        lines.push('to use, copy, modify, merge, publish, distribute, sublicense, and/or sell');
        lines.push('copies of the Software, and to permit persons to whom the Software is');
        lines.push('furnished to do so, subject to the following conditions:');
        lines.push('');
        lines.push(
          'The above copyright notice and this permission notice shall be included in all'
        );
        lines.push('copies or substantial portions of the Software.');
        lines.push('');
        lines.push('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR');
        lines.push('IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,');
        lines.push('FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE');
        lines.push('AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER');
        lines.push('LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,');
        lines.push('OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE');
        lines.push('SOFTWARE.');
      } else if (info.licenses === 'ISC') {
        lines.push('ISC License');
        lines.push('');
        lines.push('Permission to use, copy, modify, and/or distribute this software for any');
        lines.push('purpose with or without fee is hereby granted, provided that the above');
        lines.push('copyright notice and this permission notice appear in all copies.');
        lines.push('');
        lines.push('THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES');
        lines.push('WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF');
        lines.push('MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR');
        lines.push('ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES');
        lines.push('WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN');
        lines.push('ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF');
        lines.push('OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.');
      }
    }
    lines.push('');
    lines.push('');
  }

  lines.push('='.repeat(80));
  lines.push('*/');

  const content = lines.join('\n');
  writeFileSync('ThirdPartyNoticeText.txt', content);
  console.log('Generated ThirdPartyNoticeText.txt');
}

main();
