import { program } from 'commander';
import { runConvert } from './convert';
import { runAdoptionStatus } from './adoption-status';

program
  .name('connect-to-forge')
  .description('Tools to help migrate Atlassian Connect apps to Forge');

// convert subcommand (the original functionality)
program
  .command('convert')
  .description('Convert an Atlassian Connect descriptor to a Forge manifest')
  .requiredOption('-u, --url <url>', 'Atlassian Connect descriptor URL')
  .option('-t, --type <type>', 'App type (jira or confluence)')
  .option('-o, --output <path>', 'Output file path', 'manifest.yml')
  .usage('--type <jira|confluence> --url https://website.com/path/to/descriptor.json')
  .action(async (opts) => {
    await runConvert(opts);
  });

// adoption-status subcommand
program
  .command('adoption-status')
  .description('Report the Forge adoption status of a manifest — checks for remaining Atlassian Connect modules, scopes, and artefacts')
  .option('-m, --manifest <path>', 'Path to the Forge manifest file to check', 'manifest.yml')
  .option('-s, --strict', 'Exit with code 1 if any Connect remnants are found (useful in CI pipelines)', false)
  .option('--json', 'Output results as JSON instead of human-readable text', false)
  .action(async (opts) => {
    await runAdoptionStatus(opts);
  });

program.parse(process.argv);
