// Bot commits from workflow scripts: stage specific files, commit once, push
// with a rebase-retry loop. Each workflow owns a disjoint set of data files,
// so rebases never content-conflict.
//
// Commit messages must never contain GitHub closing keywords ("closes #N") —
// the processor closes tracker issues itself, in order.
import { execFileSync } from 'node:child_process';

const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

/**
 * @returns {boolean} true if a commit was created and pushed.
 */
export function commitAndPush({ files, message, dryRun = false }) {
  git('add', '--', ...files);
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim();
  if (!staged) {
    console.log('commit: no changes to commit');
    return false;
  }
  if (dryRun) {
    console.log(`commit (dry run): would commit ${staged.split('\n').join(', ')}`);
    git('reset', '--', ...files);
    return false;
  }
  git('-c', `user.name=${BOT_NAME}`, '-c', `user.email=${BOT_EMAIL}`, 'commit', '-m', message);
  for (let attempt = 1; ; attempt++) {
    try {
      git('push');
      console.log(`commit: pushed "${message.split('\n')[0]}"`);
      return true;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`push failed (attempt ${attempt}), rebasing and retrying...`);
      git('pull', '--rebase');
    }
  }
}
