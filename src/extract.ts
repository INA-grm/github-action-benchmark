/* eslint-disable @typescript-eslint/naming-convention */
import { promises as fs } from 'fs';
import * as github from '@actions/github';
import { Config, ToolType } from './config';

export interface BenchmarkResult {
    name: string;
    value: number;
    valueUnit: string;
    range: number;
    rangeUnit: string;
    extra: string;
}

interface GitHubUser {
    email?: string;
    name?: string;
    username?: string;
}

interface Commit {
    author: GitHubUser;
    committer: GitHubUser;
    distinct?: unknown; // Unused
    id: string;
    message: string;
    timestamp?: string;
    tree_id?: unknown; // Unused
    url: string;
}

interface PullRequest {
    [key: string]: any;
    number: number;
    html_url?: string;
    body?: string;
}

export interface Benchmark {
    commit: Commit;
    date: number;
    tool: ToolType;
    benches: BenchmarkResult[];
}

function getCommitFromPullRequestPayload(pr: PullRequest): Commit {
    // On pull_request hook, head_commit is not available
    const id: string = pr.head.sha;
    const username: string = pr.head.user.login;
    const user = {
        name: username, // XXX: Fallback, not correct
        username,
    };

    return {
        author: user,
        committer: user,
        id,
        message: pr.title,
        timestamp: pr.head.repo.updated_at,
        url: `${pr.html_url}/commits/${id}`,
    };
}

async function getCommitFromGitHubAPIRequest(githubToken: string, ref?: string): Promise<Commit> {
    const octocat = github.getOctokit(githubToken);

    const { status, data } = await octocat.rest.repos.getCommit({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        ref: ref ?? github.context.ref,
    });

    if (!(status === 200 || status === 304)) {
        throw new Error(`Could not fetch the head commit. Received code: ${status}`);
    }

    const { commit } = data;

    return {
        author: {
            name: commit.author?.name,
            username: data.author?.login,
            email: commit.author?.email,
        },
        committer: {
            name: commit.committer?.name,
            username: data.committer?.login,
            email: commit.committer?.email,
        },
        id: data.sha,
        message: commit.message,
        timestamp: commit.author?.date,
        url: data.html_url,
    };
}

async function getCommit(githubToken?: string, ref?: string): Promise<Commit> {
    if (github.context.payload.head_commit) {
        return github.context.payload.head_commit;
    }

    const pr = github.context.payload.pull_request;

    if (pr) {
        return getCommitFromPullRequestPayload(pr);
    }

    if (!githubToken) {
        throw new Error(
            `No commit information is found in payload: ${JSON.stringify(
                github.context.payload,
                null,
                2,
            )}. Also, no 'github-token' provided, could not fallback to GitHub API Request.`,
        );
    }

    return getCommitFromGitHubAPIRequest(githubToken, ref);
}

function extractCatch2Result(output: string): BenchmarkResult[] {
    // Example:
    
    // benchmark name samples       iterations    estimated <-- Start benchmark section
    //                mean          low mean      high mean <-- Ignored
    //                std dev       low std dev   high std dev <-- Ignored
    // ----------------------------------------------------- <-- Ignored
    // Fibonacci 20   100           2             8.4318 ms <-- Start actual benchmark
    //                43.186 us     41.402 us     46.246 us <-- Actual benchmark data
    //                11.719 us      7.847 us     17.747 us <-- Ignored
    const reTestCaseStart = /^benchmark name +samples +iterations +estimated/;
    const reBenchmarkStart = /(\d+) +(\d+) +(?:\d+(\.\d+)?) (?:ns|ms|us|s)\s*$/;
    const reBenchmarkValues = /^ +(\d+(?:\.\d+)?) (ns|us|ms|s) +(?:\d+(?:\.\d+)?) (?:ns|us|ms|s) +(?:\d+(?:\.\d+)?) (?:ns|us|ms|s)/;
    const reSeparator = /^-+$/;

    const lines = output.split(/\r?\n/g);
    let ret: BenchmarkResult[] = [];

    while (lines.length > 0) {
        const line = lines.shift();
        if (!line) continue;
        if (reTestCaseStart.test(line)) {
            while (lines.length > 0) {
                const benchmarkLine = lines.shift();
                if (!benchmarkLine) continue;
                if (reSeparator.test(benchmarkLine)) break; // End of current benchmark section

                if (reBenchmarkStart.test(benchmarkLine)) {
                    const name = benchmarkLine.replace(reBenchmarkStart, '').trim();
                    const meanLine = lines.shift();
                    const stdDevLine = lines.shift();
                    if (!meanLine || !stdDevLine) continue;

                    const meanMatch = meanLine.match(reBenchmarkValues);
                    const stdDevMatch = stdDevLine.match(reBenchmarkValues);
                    if (meanMatch && stdDevMatch) {
                        const sampleIterationMatches = benchmarkLine.match(reBenchmarkStart);
                        ret.push({
                            name,
                            value: parseFloat(meanMatch[1]),
                            valueUnit: meanMatch[2],
                            range: parseFloat(stdDevMatch[1]),
                            rangeUnit: stdDevMatch[2],
                            extra: sampleIterationMatches ? `samples: ${sampleIterationMatches[1]}, iterations: ${sampleIterationMatches[2]}` : 'No sample/iteration data'
                        });
                    }
                }
            }
        }
    }
    return ret;
}

export async function extractResult(config: Config): Promise<Benchmark> {
    const output = await fs.readFile(config.outputFilePath, 'utf8');
    const { tool, githubToken, ref } = config;
    let benches: BenchmarkResult[];

    switch (tool) {
        case 'catch2':
            benches = extractCatch2Result(output);
            break;
        default:
            throw new Error(`FATAL: Unexpected tool: '${tool}'`);
    }

    if (benches.length === 0) {
        throw new Error(`No benchmark result was found in ${config.outputFilePath}. Benchmark output was '${output}'`);
    }

    const commit = await getCommit(githubToken, ref);

    return {
        commit,
        date: Date.now(),
        tool,
        benches,
    };
}
