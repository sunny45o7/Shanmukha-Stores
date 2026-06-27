fetch('https://api.github.com/repos/sunny45o7/Shanmukha-Stores/actions/runs')
  .then(r=>r.json())
  .then(async d => {
    const run = d.workflow_runs[0];
    console.log('Latest Run ID:', run.id, 'Conclusion:', run.conclusion);
    const jobs = await fetch('https://api.github.com/repos/sunny45o7/Shanmukha-Stores/actions/runs/' + run.id + '/jobs').then(r=>r.json());
    const failedJob = jobs.jobs.find(j => j.conclusion !== 'success' && j.conclusion !== 'skipped');
    if (!failedJob) {
      console.log('No failed job found.');
      return;
    }
    console.log('Failed Job ID:', failedJob.id);
    const logs = await fetch('https://api.github.com/repos/sunny45o7/Shanmukha-Stores/actions/jobs/' + failedJob.id + '/logs').then(r=>r.text());
    console.log('--- LOGS END ---');
    console.log(logs.slice(-2000));
  });
