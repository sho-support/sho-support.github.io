// Netlify uses exit 0 to skip a Git-triggered build and exit 1 to build.
// Infrastructure changes on this branch are validated in GitHub Actions.
if (process.env.BRANCH === 'architecture/customer-hosting-v2') {
  console.log('Skip Netlify deployment for the customer-hosting development branch');
  process.exit(0);
}
process.exit(1);
