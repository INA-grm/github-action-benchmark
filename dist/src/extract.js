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
    const reTestCaseStart = /^benchmark name +samples +iterations +(estimated|est run time)/;
    const reBenchmarkStart = /(\d+) +(\d+) +(?:\d+(\.\d+)?) (?:ns|ms|us|s)\s*$/;
    const reBenchmarkValues = /^ +(\d+(?:\.\d+)?) (ns|us|ms|s) +(?:\d+(?:\.\d+)?) (?:ns|us|ms|s) +(?:\d+(?:\.\d+)?) (?:ns|us|ms|s)/;
    const reEmptyLine = /^\s*$/;
    const reSeparator = /^-+$/;
    const lines = output.split(/\r?\n/g);
    lines.reverse();
    let lnum = 0;
    function nextLine() {
        var _a;
        return [(_a = lines.pop()) !== null && _a !== void 0 ? _a : null, ++lnum];
    }
    function extractBench() {
        const startLine = nextLine()[0];
        if (startLine === null) {
            return null;
        }
        const start = startLine.match(reBenchmarkStart);
        if (start === null) {
            return null; // No more benchmark found. Go to next benchmark suite
        }
        const extra = `${start[1]} samples\n${start[2]} iterations`;
        const name = startLine.slice(0, start.index).trim();
        const [meanLine, meanLineNum] = nextLine();
        const mean = meanLine === null || meanLine === void 0 ? void 0 : meanLine.match(reBenchmarkValues);
        if (!mean) {
            throw new Error(`Mean values cannot be retrieved for benchmark '${name}' on parsing input '${meanLine !== null && meanLine !== void 0 ? meanLine : 'EOF'}' at line ${meanLineNum}`);
        }
        const value = parseFloat(mean[1]);
        const valueUnit = mean[2];
        const [stdDevLine, stdDevLineNum] = nextLine();
        const stdDev = stdDevLine === null || stdDevLine === void 0 ? void 0 : stdDevLine.match(reBenchmarkValues);
        if (!stdDev) {
            throw new Error(`Std-dev values cannot be retrieved for benchmark '${name}' on parsing '${stdDevLine !== null && stdDevLine !== void 0 ? stdDevLine : 'EOF'}' at line ${stdDevLineNum}`);
        }
        const range = parseFloat(stdDev[1]);
        const rangeUnit = stdDev[2];
        // Skip empty line
        const [emptyLine, emptyLineNum] = nextLine();
        if (emptyLine === null || !reEmptyLine.test(emptyLine)) {
            throw new Error(`Empty line is not following after 'std dev' line of benchmark '${name}' at line ${emptyLineNum}`);
        }
        return { name, value, valueUnit, range, rangeUnit, extra };
    }
    const ret = [];
    while (lines.length > 0) {
        // Search header of benchmark section
        const line = nextLine()[0];
        if (line === null) {
            break; // All lines were eaten
        }
        if (!reTestCaseStart.test(line)) {
            continue;
        }
        // Eat until a separator line appears
        for (;;) {
            const [line, num] = nextLine();
            if (line === null) {
                throw new Error(`Separator '------' does not appear after benchmark suite at line ${num}`);
            }
            if (reSeparator.test(line)) {
                break;
            }
        }
        let benchFound = false;
        for (;;) {
            const res = extractBench();
            if (res === null) {
                break;
            }
            ret.push(res);
            benchFound = true;
        }
        if (!benchFound) {
            throw new Error(`No benchmark found for bench suite. Possibly mangled output from Catch2:\n\n${output}`);
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