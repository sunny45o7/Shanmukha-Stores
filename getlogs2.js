fetch('https://api.github.com/repos/sunny45o7/Shanmukha-Stores/actions/runs')
  .then(r=>r.json())
  .then(d => {
    d.workflow_runs.slice(0, 3).forEach(run => {
      console.log('Run ID:', run.id, '| Status:', run.status, '| Conclusion:', run.conclusion, '| Message:', run.head_commit.message.slice(0, 50));
    });
  });
