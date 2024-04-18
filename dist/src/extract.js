"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractResult = void 0;
/* eslint-disable @typescript-eslint/naming-convention */
const fs_1 = require("fs");
const github = __importStar(require("@actions/github"));
function getCommitFromPullRequestPayload(pr) {
    // On pull_request hook, head_commit is not available
    const id = pr.head.sha;
    const username = pr.head.user.login;
    const user = {
        name: username,
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
async function getCommitFromGitHubAPIRequest(githubToken, ref) {
    var _a, _b, _c, _d, _e, _f, _g;
    const octocat = github.getOctokit(githubToken);
    const { status, data } = await octocat.rest.repos.getCommit({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        ref: ref !== null && ref !== void 0 ? ref : github.context.ref,
    });
    if (!(status === 200 || status === 304)) {
        throw new Error(`Could not fetch the head commit. Received code: ${status}`);
    }
    const { commit } = data;
    return {
        author: {
            name: (_a = commit.author) === null || _a === void 0 ? void 0 : _a.name,
            username: (_b = data.author) === null || _b === void 0 ? void 0 : _b.login,
            email: (_c = commit.author) === null || _c === void 0 ? void 0 : _c.email,
        },
        committer: {
            name: (_d = commit.committer) === null || _d === void 0 ? void 0 : _d.name,
            username: (_e = data.committer) === null || _e === void 0 ? void 0 : _e.login,
            email: (_f = commit.committer) === null || _f === void 0 ? void 0 : _f.email,
        },
        id: data.sha,
        message: commit.message,
        timestamp: (_g = commit.author) === null || _g === void 0 ? void 0 : _g.date,
        url: data.html_url,
    };
}
async function getCommit(githubToken, ref) {
    if (github.context.payload.head_commit) {
        return github.context.payload.head_commit;
    }
    const pr = github.context.payload.pull_request;
    if (pr) {
        return getCommitFromPullRequestPayload(pr);
    }
    if (!githubToken) {
        throw new Error(`No commit information is found in payload: ${JSON.stringify(github.context.payload, null, 2)}. Also, no 'github-token' provided, could not fallback to GitHub API Request.`);
    }
    return getCommitFromGitHubAPIRequest(githubToken, ref);
}
function extractCatch2Result(output) {
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
    const ret = [];
    while (lines.length > 0) {
        const line = lines.shift();
        if (!line)
            continue;
        if (reTestCaseStart.test(line)) {
            while (lines.length > 0) {
                const benchmarkLine = lines.shift();
                if (!benchmarkLine)
                    continue;
                if (reSeparator.test(benchmarkLine))
                    break; // End of current benchmark section
                if (reBenchmarkStart.test(benchmarkLine)) {
                    const name = benchmarkLine.replace(reBenchmarkStart, '').trim();
                    const meanLine = lines.shift();
                    const stdDevLine = lines.shift();
                    if (!meanLine || !stdDevLine)
                        continue;
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
                            extra: sampleIterationMatches
                                ? `samples: ${sampleIterationMatches[1]}, iterations: ${sampleIterationMatches[2]}`
                                : 'No sample/iteration data',
                        });
                    }
                }
            }
        }
    }
    return ret;
}
async function extractResult(config) {
    const output = await fs_1.promises.readFile(config.outputFilePath, 'utf8');
    const { tool, githubToken, ref } = config;
    let benches;
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
exports.extractResult = extractResult;
//# sourceMappingURL=extract.js.map