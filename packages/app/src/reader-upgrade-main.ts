import { runReaderUpgrade } from '@silo/worker';

// No API server or normal enrichment worker: only the explicit Reader upgrade runs.
// Use --refresh after changing the sanitizer to replace existing Reader HTML safely.
runReaderUpgrade((id, outcome) => console.log(`${id}\t${outcome}`), {
  refreshHtml: process.argv.includes('--refresh'),
})
  .then((counts) => {
    console.log(JSON.stringify(counts));
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Reader upgrade failed; rerun to resume:', error);
    process.exit(1);
  });
