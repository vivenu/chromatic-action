import { getInput, error, setFailed, setOutput, info } from '@actions/core';
import { GitHub, context } from "@actions/github";
import { runTest } from 'storybook-chromatic/bin/tester/index';
import { verifyOptions } from 'storybook-chromatic/bin/lib/verify-option';

const maybe = (a) => {
  if(!a) {
    return undefined;
  }

  try {
    return JSON.parse(a);
  } catch(e){
    return a;
  }
}

const getCommit = (event: typeof context) => {
  switch (event.eventName) {
    case 'pull_request': {
      return {
        // @ts-ignore
        owner: event.payload.repository.owner.login, 
        // @ts-ignore
        repo: event.payload.repository.name,
        // @ts-ignore
        branch: event.payload.pull_request.head.ref,
        // @ts-ignore
        ref: event.ref || event.payload.pull_request.head.ref,
        // @ts-ignore
        sha: event.payload.pull_request.head.sha,
      };
    }
    case 'push': {
      info(JSON.stringify(event, null, 2))
      return {
        // @ts-ignore
        owner: event.payload.repository.owner.login, 
        // @ts-ignore
        repo: event.payload.repository.name,
        branch: event.payload.ref.replace('refs/heads/', ''),
        ref: event.payload.ref,
        sha: event.payload.after,
      };
    }
    default: {
      setFailed(event.eventName + ' event is not supported in this action');

      return null;
    };
  }
}

interface Output {
  url: string;
  code: number;
}
async function runChromatic(options): Promise<Output> {
  const { exitCode, url } = await runTest(await verifyOptions(options));  

  return {
    url,
    code: exitCode,
  };
}

const getApi = () => {
  try {
    const token = getInput('token');
    return new GitHub(token);
  } catch (e){
    setFailed(e.message);

    return null;
  }
}

async function run() {
  let deployment_id: number = NaN;
  const api = getApi();
  const commit = getCommit(context);
  
  if (!api || !commit){
    return;
  }

  const { branch, repo, owner, sha } = commit;

  try {
    const appCode = getInput('appCode');
    const buildScriptName = getInput('buildScriptName');
    const scriptName = getInput('scriptName');
    const exec = getInput('exec');
    const doNotStart = getInput('doNotStart');
    const storybookPort = getInput('storybookPort');
    const storybookUrl = getInput('storybookUrl');
    const storybookBuildDir = getInput('storybookBuildDir');
    const storybookHttps = getInput('storybookHttps');
    const storybookCert = getInput('storybookCert');
    const storybookKey = getInput('storybookKey');
    const storybookCa = getInput('storybookCa');

    process.env.CHROMATIC_SHA = sha;
    process.env.CHROMATIC_BRANCH = branch;

    const deployment = api.repos.createDeployment({
      repo,
      owner,
      ref: branch,
      environment: 'chromatic',
      required_contexts: [],
    }).then(deployment => {
      deployment_id = deployment.data.id;

      return api.repos.createDeploymentStatus({
        repo,
        owner,
        deployment_id,
        state: 'pending',
      });
    }).catch(e => {
      deployment_id = NaN;
      console.log('adding deployment to GitHub failed, You are likely on a forked repo and do not have write access.');
    });

    const chromatic = runChromatic({
      appCode,
      fromCI: true,
      interactive: false,
      exitZeroOnChanges: true,
      buildScriptName: maybe(buildScriptName),
      scriptName: maybe(scriptName),
      exec: maybe(exec),
      doNotStart: maybe(doNotStart),
      storybookPort: maybe(storybookPort),
      storybookUrl: maybe(storybookUrl),
      storybookBuildDir: maybe(storybookBuildDir),
      storybookHttps: maybe(storybookHttps),
      storybookCert: maybe(storybookCert),
      storybookKey: maybe(storybookKey),
      storybookCa: maybe(storybookCa),
    });

    const [{ url, code }] = await Promise.all([
      chromatic,
      deployment,
    ]);

    if (typeof deployment_id === 'number' && !isNaN(deployment_id)) {
      try {
        await api.repos.createDeploymentStatus({
          repo,
          owner,
          deployment_id,
          state: 'success',
          environment_url: url
        });
      } catch (e){
        //
      }
    }

    setOutput('url', url);
    setOutput('code', code.toString());
  } catch (e) {
    e.message && error(e.message);
    e.stack && error(e.stack);
    e.description && error(e.description);

    if (typeof deployment_id === 'number' && !isNaN(deployment_id)) {
      try {
        await api.repos.createDeploymentStatus({
          repo,
          owner,
          deployment_id,
          state: 'failure',
        });
      } catch (e){
        //
      }
    }

    setFailed(e.message);
  }
}
run();
