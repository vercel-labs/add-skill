import { defineBuildConfig } from 'obuild/config';

// https://github.com/unjs/obuild
export default defineBuildConfig({
  entries: [{ type: 'bundle', input: './src/cli.ts' }],
});
